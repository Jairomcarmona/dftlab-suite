"""Persist original artifacts and native status; no physical re-evaluation."""
from copy import deepcopy
import hashlib,json
from types import SimpleNamespace
import unittest
from dftlab_platform.contracts import Contracts,digest,loads
from dftlab_platform.domain import Problem
from dftlab_platform.policy_refs import policy_reference
from dftlab_platform.scientific_results import ScientificResults


class MemoryArtifacts:
    def __init__(self):self.files={};self.records={};self.staged={}
    def add(self,data,project='p',owner='owner',kind='qraft.raw-result'):
        key='art-'+str(len(self.files)+1);sha=hashlib.sha256(data).hexdigest()
        self.files[key]=data;self.records[key]={'project_id':project,'owner':owner,'payload':{
            'artifact_id':key,'sha256':sha,'media_type':'application/json','size_bytes':len(data),'kind':kind}}
        return {'artifact_id':key,'sha256':sha,'media_type':'application/json'}
    def metadata(self,owner,key):
        if owner!=self.records[key]['owner']:raise Problem('NOT_FOUND')
        return self.records[key]
    def verify(self,owner,key):return hashlib.sha256(self.files[key]).hexdigest()==self.metadata(owner,key)['payload']['sha256']
    def stream(self,owner,key):self.metadata(owner,key);return iter([self.files[key]])
    def stage(self,owner,request):
        key='upload-'+str(len(self.staged));self.staged[key]={'owner':owner,'request':request,'data':bytearray()};return {'upload_id':key}
    def write(self,owner,key,start,end,total,data):self.staged[key]['data'].extend(data)
    def commit(self,owner,key):
        row=self.staged[key];ref=self.add(bytes(row['data']),row['request']['project_id'],owner,row['request']['kind'])
        return self.records[ref['artifact_id']]


class ScientificConsumers(unittest.TestCase):
    def setUp(self):
        self.artifacts=MemoryArtifacts();self.calls=[]
        surface_policy={'potential':'VH','allow_vt':False,'window_A':1.0,'step_A':.25,
            'margin_A':4.0,'width_min_A':2.0,'slope_max_eV_per_A':.005,'range_max_meV':5.0,
            'stability_meV':3.0,'perpendicular_tol_deg':.01,'convergence_meV':10.0}
        def document(literal,*,rule_document=None):
            self.calls.append(literal)
            if rule_document is not None:return deepcopy(rule_document)
            return deepcopy(surface_policy if literal=='qraft.surface.policy@1' else {'fixture_policy':literal})
        def evidence(literal,**options):
            raw={'payload':{'policy_id':literal,'policy_document':document(literal,**options)}}
            return SimpleNamespace(verify=lambda:None,to_dict=lambda:raw,contract='qraft.scientific-artifact@1.0',content_sha256='a'*64)
        api=SimpleNamespace(EosProtocol=object,ElectronicAnalysisProtocol=object,SurfaceProtocol=object,
            scientific_policy_document=document,scientific_policy_evidence=evidence)
        engines=SimpleNamespace(qraft=api,lock={'engines':{'qraft':{'distribution':'qraft-hpc','declared_version':'0.2.0','commit':'b'*40}}})
        self.consumer=ScientificResults(engines,self.artifacts)

    def source(self,value):
        data=('  '+json.dumps(value,indent=2)+'\n').encode()
        return self.artifacts.add(data),data

    def surface_intent(self,dipole):
        policy,_=policy_reference(self.consumer.engines.qraft,'qraft.surface.policy@1')
        return {'dipole_correction':dipole,'policy_ref':policy}

    def test_eos_keeps_native_status_and_original_bytes_without_pass(self):
        ref,data=self.source({'policy_id':'qraft.eos.policy@1','status':'ESTABLISHED','reasons':[],
            'authority':'PROVISIONAL','quantity':'free_energy','n_atoms':2,'points':[{'relaxation_mode':'fixed-fractional'}],
            'fit':{'B0_GPa':80.0}})
        result=self.consumer.store_eos('owner','p',ref,subject_refs=['run-1'])
        self.assertEqual(self.artifacts.files[ref['artifact_id']],data)
        self.assertEqual(result['assessment']['payload']['native_status']['value'],'ESTABLISHED')
        self.assertEqual(result['assessment']['payload']['passport_state'],'NOT_ESTABLISHED')
        self.assertEqual(result['analysis']['payload']['result_dataset_refs'],[])
        self.assertEqual(result['analysis']['payload']['assessment_refs'],[result['assessment']['payload']['assessment_id']])
        saved=loads(self.artifacts.files[result['assessment_artifact']['artifact_id']]);self.assertEqual(saved,result['assessment'])
        Contracts().validate('analysis-result',result['analysis'])
        self.assertEqual(result['presentation']['capability'],'CONTRACT_TESTED')
        self.assertEqual(result['presentation']['native_result']['fit'],{'B0_GPa':80.0})

    def test_electronic_scope_lock_and_group_only_weights_are_preserved(self):
        raw={'policy_id':'qraft.electronic.policy@1','authority':'NUMERICAL_CANDIDATE',
            'origin':'PROVISIONAL_DIRECT_SCF','worker_environment_sha256':'c'*64,
            'gap':{'status':'GAP','scope':'PATH','gap_eV':.5562},
            'groups':[{'k_index':0,'spin':0,'bands':[2,3,4],'size':3,'weights':{'s':-.2,'p':3.2}}]}
        ref,data=self.source(raw)
        result=self.consumer.store_electronic('owner','p',ref,subject_refs=['run-1'],scope='PATH')
        self.assertEqual(result['presentation']['groups'],raw['groups'])
        self.assertEqual(result['presentation']['worker_environment_sha256'],'c'*64)
        self.assertEqual(result['presentation']['authority'],'NUMERICAL_CANDIDATE')
        self.assertEqual(result['assessment']['payload']['native_status']['value'],'GAP')
        self.assertEqual(result['assessment']['payload']['native_status']['vocabulary'],'qraft.electronic.policy')
        self.assertEqual(self.artifacts.files[ref['artifact_id']],data)
        with self.assertRaises(Problem):self.consumer.store_electronic('owner','p',ref,subject_refs=['run-1'],scope='POINTS')

    def test_convergence_keeps_rule_hash_and_human_acceptance_pending(self):
        rule={'rule_id':'operator.mesh.policy@1','parameter':'Mesh.Cutoff','fixture':'explicit rule seam'}
        rule_ref,rule_data=self.source(rule)
        report_ref,report_data=self.source({'rule_id':rule['rule_id'],'rule_sha256':hashlib.sha256(rule_data).hexdigest(),
            'status':'READY_FOR_HUMAN_REVIEW','reasons':[]})
        result=self.consumer.store_convergence('owner','p',rule_ref,report_ref,subject_refs=['run-1'])
        self.assertEqual(result['state'],'PROVISIONAL')
        self.assertIn('HUMAN_ACCEPTANCE_PENDING',result['analysis']['payload']['limits'])
        self.assertEqual(result['assessment']['payload']['native_status']['value'],'READY_FOR_HUMAN_REVIEW')
        self.assertEqual(self.artifacts.files[rule_ref['artifact_id']],rule_data)
        self.assertEqual(self.artifacts.files[report_ref['artifact_id']],report_data)
        bad,_=self.source({'rule_id':rule['rule_id'],'rule_sha256':'d'*64,'status':'READY_FOR_HUMAN_REVIEW'})
        with self.assertRaises(Problem):self.consumer.store_convergence('owner','p',rule_ref,bad,subject_refs=['run-1'])

    def test_mass_collection_authority_is_not_an_aggregate_verdict(self):
        raw={'policy_id':'qraft.electronic.policy@1','authority':'NUMERICAL_CANDIDATE',
            'longitudinal':{'status':'NUMERICAL_CANDIDATE','mass_me':.93},
            'transverse':[{'status':'NOT_ESTABLISHED','reasons':['DEGENERATE_EXTREMUM']}]}
        ref,_=self.source(raw)
        result=self.consumer.store_electronic('owner','p',ref,subject_refs=['run-1'],scope='POINTS')
        native=result['assessment']['payload']['native_status']
        self.assertEqual(native['vocabulary'],'qraft.electronic.authority')
        self.assertEqual(native['value'],'NUMERICAL_CANDIDATE')
        self.assertEqual(result['analysis']['payload']['observable_kind'],'qraft.electronic')
        self.assertEqual(result['presentation']['native_result'],raw)
        del raw['authority'];ref,_=self.source(raw)
        with self.assertRaises(Problem):self.consumer.store_electronic('owner','p',ref,subject_refs=['run-1'],scope='POINTS')
        raw['parent_electronic_state']={'authority':'PROVISIONAL'};ref,_=self.source(raw)
        result=self.consumer.store_electronic('owner','p',ref,subject_refs=['run-1'],scope='POINTS')
        self.assertEqual(result['assessment']['payload']['native_status']['vocabulary'],'qraft.electronic.parent.authority')
        self.assertEqual(result['presentation']['authority'],'PROVISIONAL')

    def test_unknown_native_status_never_grants_pass_and_owner_project_are_checked(self):
        ref,_=self.source({'policy_id':'qraft.eos.policy@1','status':'FUTURE_STATUS_V999','reasons':['native-code'],
            'quantity':'free_energy','n_atoms':2,'points':[{'relaxation_mode':'fixed-fractional'}]})
        result=self.consumer.store_eos('owner','p',ref,subject_refs=['run-1'])
        self.assertEqual(result['assessment']['payload']['native_status']['value'],'FUTURE_STATUS_V999')
        self.assertEqual(result['assessment']['payload']['reasons'],['native-code'])
        self.assertEqual(result['assessment']['payload']['passport_state'],'NOT_ESTABLISHED')
        with self.assertRaises(Problem):self.consumer.store_eos('other','p',ref,subject_refs=['run-1'])
        with self.assertRaises(Problem):self.consumer.store_eos('owner','other',ref,subject_refs=['run-1'])

    def test_surface_preserves_native_qraft_result_and_pinned_policy_and_intent_dipole_mode(self):
        # SurfaceProtocol.analyze's native shape does not repeat policy_id.
        raw={'verdict':'ESTABLISHED','reasons':[],
            'faces':[{'side':'+z','status':'ESTABLISHED','reason':None,'phi_eV':5.5863,
                'plateau':{'from_A':20.0,'to_A':22.0,'mean_eV':.7393}},
                {'side':'-z','status':'ESTABLISHED','reason':None,'phi_eV':3.9446,
                'plateau':{'from_A':2.0,'to_A':4.0,'mean_eV':-.8996}}]}
        ref,data=self.source(raw)
        result=self.consumer.store_surface('owner','p',ref,subject_refs=['run-1'],
            intent=self.surface_intent('VaCuUm'))
        self.assertEqual(self.artifacts.files[ref['artifact_id']],data)
        self.assertEqual(result['presentation']['native_result'],raw)
        self.assertEqual(result['presentation']['faces'],raw['faces'])
        self.assertEqual(result['presentation']['dipole_correction'],'VaCuUm')
        self.assertEqual(result['assessment']['payload']['native_status']['value'],'ESTABLISHED')
        self.assertEqual(result['assessment']['payload']['native_status']['vocabulary'],'qraft.surface.verdict')
        self.assertEqual(result['assessment']['payload']['passport_state'],'NOT_ESTABLISHED')
        self.assertEqual(result['analysis']['payload']['observable_kind'],'qraft.surface')
        policy=result['analysis']['payload']['algorithm']['policy']
        self.assertEqual(policy['policy_id'],'qraft.surface.policy')
        self.assertEqual(policy['version'],'1.0.0')
        self.assertEqual(policy['digest'],digest(self.consumer.engines.qraft.scientific_policy_document('qraft.surface.policy@1')))
        self.assertEqual(result['analysis']['payload']['limits'],['CONTRACT_TESTED','PROVISIONAL'])
        self.assertEqual(result['state'],'PROVISIONAL')

    def test_surface_requires_supported_intent_and_exact_pinned_policy_ref(self):
        ref,_=self.source({'policy_id':'qraft.surface.policy@1','verdict':'NOT_ESTABLISHED','reasons':[],
            'faces':[]})
        policy=policy_reference(self.consumer.engines.qraft,'qraft.surface.policy@1')[0]
        for intent in ({}, {'dipole_correction':'automatic','policy_ref':policy},
                       {'dipole_correction':True,'policy_ref':policy},
                       {'dipole_correction':None},
                       {'dipole_correction':None,'policy_ref':{**policy,'digest':'0'*64}}):
            with self.subTest(intent=intent), self.assertRaises(Problem):
                self.consumer.store_surface('owner','p',ref,subject_refs=['run-1'],intent=intent)

    def test_surface_rejects_a_conflicting_native_policy_id(self):
        ref,_=self.source({'policy_id':'qraft.surface.policy@2','verdict':'NOT_ESTABLISHED',
            'reasons':[],'faces':[]})
        with self.assertRaises(Problem):
            self.consumer.store_surface('owner','p',ref,subject_refs=['run-1'],
                intent=self.surface_intent(None))
