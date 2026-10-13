"""Lossless native IDs and coherent RunIntent refs; gates remain QRAFT's."""
from copy import deepcopy
import hashlib,json
from types import SimpleNamespace
import unittest
from dftlab_platform.contracts import resource_json,digest,Contracts
from dftlab_platform.domain import envelope,reseal
from dftlab_platform.engines import engine_lock
from dftlab_platform.presets import build_preset_intent


class PresetIntent(unittest.TestCase):
    def setUp(self):
        structure=resource_json('fixtures/draft-create-request/valid/promote-template.json')['structure']
        self.structure=envelope('structure-revision','p-presets',{**structure,'structure_id':'s-presets','revision':1,'parent_revision':None})
        self.model=resource_json('fixtures/physical-model/valid/pbe.json');self.model['project_id']='p-presets'
        self.policy=resource_json('fixtures/numerical-policy/valid/scf.json');self.policy['project_id']='p-presets'
        document={'synthetic_policy':'test-only'}
        self.policy['payload']['policy']={'policy_id':'qraft.presets.policy','version':'1.0.0','digest':digest(document)}
        self.policy['payload']['basis']['energy_shift']={'value':20,'unit':'meV'}
        self.policy['payload']['kgrid'].update(divisions=[4]*3,shift=[.5]*3)
        self.policy['payload']['smearing']={'method':'FD','width':{'value':20,'unit':'meV'}}
        raw={'payload':{'policy_id':'qraft.presets.policy@1','protocol_ids':['qraft.preset.s-05@1'],
                        'policy_document':document},'fixture':'native dependency seam'}
        self.data=json.dumps(raw).encode()
        native=SimpleNamespace(verify=lambda:None,to_dict=lambda:deepcopy(raw),content_sha256='b'*64,
                               contract='qraft.scientific-artifact@1.0')
        self.api=SimpleNamespace(scientific_policy_document=lambda literal:deepcopy(document),
            scientific_policy_evidence=lambda literal:native,
            SiestaContextualValidator=lambda:SimpleNamespace(validate_path=lambda path:SimpleNamespace(status=SimpleNamespace(value='PASS'))))
        pin=engine_lock()['engines']['qraft']
        self.ref={'engine':'qraft','distribution':pin['distribution'],'version':pin['declared_version'],'commit':pin['commit'],
            'contract':str(native.contract),'digest':{'algorithm':'qraft.content-sha256-v1','value':native.content_sha256},
            'artifact':{'artifact_id':'art-policy','sha256':hashlib.sha256(self.data).hexdigest(),'media_type':'application/json'},
            'verification':{'status':'VERIFIED','verified_at':'2026-10-12T12:00:00Z'}}

    def build(self):
        return build_preset_intent(self.structure,'S-05',{'Si':14},draft_id='draft-presets',physical_model=self.model,
            numerical_policy=self.policy,operation='siesta.scf',qraft_api=self.api,native_policy_ref=self.ref,native_policy_bytes=self.data)

    def test_intent_uses_existing_schema_and_preserves_native_evidence(self):
        result=self.build();intent=result['intent']
        Contracts().validate('run-intent',intent)
        self.assertEqual(intent['payload']['purpose'],'EXPLORATORY')
        self.assertEqual(intent['payload']['protocol'],{'protocol_id':'qraft.preset.s-05','version':'1.0.0'})
        self.assertEqual(intent['payload']['numerical_policy_ref'],self.policy['record_id'])
        self.assertEqual(intent['native_contract_refs'],[self.ref])
        self.assertIn(b'qraft.preset.s-05@1',self.data)
        self.assertIn(b'qraft.presets.policy@1',self.data)
        self.assertIn('SolutionMethod diagon',result['plan']['fdf'])
        self.assertIn('OccupationFunction FD',result['plan']['fdf'])
        self.assertIn('ElectronicTemperature 20 meV',result['plan']['fdf'])
        self.assertIn('DM.Tolerance 0.0001',result['plan']['fdf'])

    def test_h_tolerance_uses_supported_scf_label(self):
        self.policy['payload']['tolerances']['h_tolerance']={'value':.001,'unit':'eV'}
        fdf=self.build()['plan']['fdf']
        self.assertIn('SCF.H.Tolerance 0.001 eV',fdf)
        self.assertNotIn('DM.H.Tolerance',fdf)

    def test_mismatched_digest_source_or_authoring_cannot_create_intent(self):
        for field in ('digest','bytes','pin','mesh','solver','smearing','tolerance'):
            with self.subTest(field=field):
                original=deepcopy((self.policy,self.ref,self.data))
                if field=='digest':self.policy['payload']['policy']['digest']='a'*64
                elif field=='bytes':self.data+=b' '
                elif field=='pin':self.ref['commit']='a'*40
                elif field=='mesh':self.policy['payload']['mesh_cutoff']['value']=500
                elif field=='solver':self.policy['payload']['solver']='unsupported'
                elif field=='smearing':self.policy['payload']['smearing']=None
                else:self.policy['payload']['tolerances']['dm_tolerance']['unit']='Ang'
                with self.assertRaises(ValueError):self.build()
                self.policy,self.ref,self.data=original

    def test_failed_qraft_validation_is_not_an_intent(self):
        self.api.SiestaContextualValidator=lambda:SimpleNamespace(validate_path=lambda path:SimpleNamespace(status=SimpleNamespace(value='FAIL')))
        with self.assertRaises(ValueError):self.build()

    def test_hubbard_and_noncollinear_models_cannot_use_scalar_renderer(self):
        for spin in ('NONCOLLINEAR','SPIN_ORBIT'):
            self.model['payload']['spin']=spin
            with self.assertRaisesRegex(ValueError,'non-Hubbard scalar'):
                build_preset_intent(self.structure,'S-05',{'Si':14},draft_id='draft-presets',physical_model=self.model,
                    numerical_policy=self.policy,operation='siesta.scf',qraft_api=self.api,native_policy_ref=self.ref,
                    native_policy_bytes=self.data,parameters={'spin':'polarized'},initial_spin=[0,0])
        self.model=resource_json('fixtures/physical-model/valid/hubbard-u-scalar-charge.json');self.model['project_id']='p-presets'
        with self.assertRaisesRegex(ValueError,'non-Hubbard scalar'):self.build()
