"""Consumers of QRAFT results; no physical calculation or acceptance action."""
from copy import deepcopy
import hashlib
import json

from .contracts import Contracts, canonical, loads, resource_json
from .domain import envelope, identifier, now, Problem, reseal
from .policy_refs import policy_reference


class ScientificResults:
    def __init__(self, engines, artifacts, *, limit=8*1024**2):
        self.engines,self.artifacts,self.limit=engines,artifacts,limit
        self.contracts=Contracts()
        # Only the installed public facade participates in this integration.
        for name in ('EosProtocol','ElectronicAnalysisProtocol','scientific_policy_document','scientific_policy_evidence'):
            if not hasattr(engines.qraft,name):
                raise Problem('ENGINE_UNAVAILABLE')

    def _read(self,owner,project,reference):
        self.contracts.validate('artifact-ref',reference)
        record=self.artifacts.metadata(owner,reference['artifact_id'])
        payload=record['payload']
        if record['project_id']!=project or payload['sha256']!=reference['sha256'] or payload['size_bytes']>self.limit or not self.artifacts.verify(owner,reference['artifact_id']):
            raise Problem('PRECONDITION_FAILED')
        data=b''.join(self.artifacts.stream(owner,reference['artifact_id']))
        if len(data)!=payload['size_bytes'] or hashlib.sha256(data).hexdigest()!=reference['sha256']:
            raise Problem('PRECONDITION_FAILED')
        return data

    def _store(self,owner,project,data,kind):
        if len(data)>self.limit:
            raise Problem('PAYLOAD_TOO_LARGE')
        staged=self.artifacts.stage(owner,{'project_id':project,'kind':kind,'media_type':'application/json',
            'size_bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'idempotency_key':identifier()})
        for start in range(0,len(data),65536):
            end=min(len(data),start+65536)
            self.artifacts.write(owner,staged['upload_id'],start,end-1,len(data),data[start:end])
        record=self.artifacts.commit(owner,staged['upload_id'])
        return {key:record['payload'][key] for key in ('artifact_id','sha256','media_type')}

    def _policy(self,owner,project,literal,*,rule_document=None):
        api=self.engines.qraft
        policy,document=policy_reference(api,literal,rule_document=rule_document)
        native=api.scientific_policy_evidence(literal,**({'rule_document':rule_document} if rule_document is not None else {}))
        native.verify()
        raw=native.to_dict()
        if raw['payload']['policy_id']!=literal or raw['payload']['policy_document']!=document:
            raise Problem('PRECONDITION_FAILED')
        data=(json.dumps(raw,sort_keys=True,ensure_ascii=False,indent=2)+'\n').encode()
        artifact=self._store(owner,project,data,'qraft.scientific-policy')
        pin=self.engines.lock['engines']['qraft']
        ref={'engine':'qraft','distribution':pin['distribution'],'version':pin['declared_version'],'commit':pin['commit'],
            'contract':str(native.contract),'digest':{'algorithm':'qraft.content-sha256-v1','value':native.content_sha256},
            'artifact':artifact,'verification':{'status':'VERIFIED','verified_at':now()}}
        self.contracts.validate('native-contract-ref',ref)
        return policy,ref

    def _save(self,owner,project,raw,source_refs,*,literal,kind,status,scope,subjects,rule_document=None):
        if not isinstance(status,str) or not status:
            raise Problem('PRECONDITION_FAILED')
        policy,native=self._policy(owner,project,literal,rule_document=rule_document)
        assessment_id=identifier()
        reasons=raw.get('reasons',raw.get('partition',{}).get('reasons',[]))
        # The existing projection table's default is used for these previously
        # unknown protocol vocabularies; numeric merit never grants PASS.
        projection=resource_json('vocabularies/native-status-projection.json')['default_projection']
        assessment=envelope('assessment-record',project,{'assessment_id':assessment_id,'subject_refs':list(subjects),
            'assessment_type':kind,'protocol':policy,'rule':literal,
            'native_status':{'authority':'qraft','vocabulary':policy['policy_id'],'value':status},
            'passport_state':projection,'reasons':deepcopy(reasons),'evidence':[native,*deepcopy(source_refs)],
            'scope':scope,'supersedes':None},record_id=assessment_id)
        assessment['native_contract_refs']=[native];reseal(assessment)
        self.contracts.validate('assessment-record',assessment)
        assessment_artifact=self._store(owner,project,canonical(assessment),'dftlab.assessment-record')
        analysis=envelope('analysis-result',project,{'analysis_id':identifier(),'observable_kind':kind,
            'model':kind,'input_refs':[native,*deepcopy(source_refs)],
            'algorithm':{'name':kind,'version':'1.0','policy':policy},'result_dataset_refs':[],
            'assessment_refs':[assessment_id],'limits':['CONTRACT_TESTED','PROVISIONAL',
                *(['HUMAN_ACCEPTANCE_PENDING'] if rule_document is not None else [])]})
        analysis['native_contract_refs']=[native];reseal(analysis)
        self.contracts.validate('analysis-result',analysis)
        analysis_artifact=self._store(owner,project,canonical(analysis),'dftlab.analysis-result')
        return {'analysis':analysis,'assessment':assessment,'analysis_artifact':analysis_artifact,
                'assessment_artifact':assessment_artifact,'source_refs':deepcopy(source_refs),
                'presentation':self.presentation(raw,scope=scope), 'state':'PROVISIONAL'}

    def store_eos(self,owner,project,source_ref,*,subject_refs):
        raw=loads(self._read(owner,project,source_ref))
        literal='qraft.eos.policy@1'
        if raw.get('policy_id')!=literal:
            raise Problem('PRECONDITION_FAILED')
        scope=json.dumps({'quantity':raw['quantity'],'n_atoms':raw['n_atoms'],
            'relaxation_modes':sorted({p['relaxation_mode'] for p in raw['points']})},sort_keys=True)
        return self._save(owner,project,raw,[source_ref],literal=literal,kind='qraft.eos',status=raw['status'],scope=scope,subjects=subject_refs)

    def store_electronic(self,owner,project,source_ref,*,subject_refs,scope):
        raw=loads(self._read(owner,project,source_ref))
        literal='qraft.electronic.policy@1'
        if raw.get('policy_id')!=literal or scope not in ('PATH','POINTS') or raw.get('gap',{}).get('scope',scope)!=scope:
            raise Problem('PRECONDITION_FAILED')
        status=raw.get('status',raw.get('gap',{}).get('status',raw.get('partition',{}).get('status')))
        return self._save(owner,project,raw,[source_ref],literal=literal,kind='qraft.electronic',status=status,scope=scope,subjects=subject_refs)

    def store_convergence(self,owner,project,rule_ref,report_ref,*,subject_refs):
        rule_bytes=self._read(owner,project,rule_ref)
        rule=loads(rule_bytes);report=loads(self._read(owner,project,report_ref))
        if report.get('rule_id')!=rule['rule_id'] or report.get('rule_sha256')!=hashlib.sha256(rule_bytes).hexdigest():
            raise Problem('PRECONDITION_FAILED')
        return self._save(owner,project,report,[rule_ref,report_ref],literal=rule['rule_id'],kind='qraft.convergence',
            status=report['status'],scope=rule['parameter'],subjects=subject_refs,rule_document=rule)

    @staticmethod
    def presentation(raw,*,scope):
        groups=deepcopy(raw.get('groups',[]))
        for group in groups:
            if group['size']!=len(group['bands']) or group['size']<1 or 'individual_weights' in group:
                raise ValueError('Only complete native group weights may be presented')
        return {'scope':scope,'native_status':raw.get('status',raw.get('gap',{}).get('status',raw.get('partition',{}).get('status'))),
            'authority':raw.get('authority','PROVISIONAL'),'origin':raw.get('origin'),
            'worker_environment_sha256':raw.get('worker_environment_sha256'),
            'gap':deepcopy(raw.get('gap')),'longitudinal':deepcopy(raw.get('longitudinal')),
            'transverse':deepcopy(raw.get('transverse',[])),'partition':deepcopy(raw.get('partition')),
            'groups':groups,'native_result':deepcopy(raw),'capability':'CONTRACT_TESTED'}
