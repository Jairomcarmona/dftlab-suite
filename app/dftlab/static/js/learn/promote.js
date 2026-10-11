import {validate} from '../sdk/contracts.js';

// Explicit export seam. Pure data only: no SDK client, store mutation or job.
// Persistence of a draft awaits the missing C3 draft-create API contract.
export function promoteStructure({structure,projectId,learningDatasetId,physicalModelRef,numericalPolicyRef,now=new Date().toISOString(),id=()=>crypto.randomUUID()}){
  validate('structure-revision',structure);
  const draftId='drf-'+id(),structureId='str-'+id();
  const wrap=(schema,payload)=>({schema_id:'dftlab.'+schema,schema_version:'0.1.0',record_id:'rec-'+id(),project_id:projectId,producer:{package:'dftlab-client',version:'0.1.0',commit:null,algorithm:null},created_at:now,payload,native_contract_refs:[],integrity:{status:'UNVERIFIED',canonicalization:'jcs-rfc8785',algorithm:'sha-256',digest:null}});
  const revision=wrap('structure-revision',{...structuredClone(structure.payload),structure_id:structureId,revision:1,parent_revision:null});
  const intent=wrap('run-intent',{intent_id:'int-'+id(),draft_id:draftId,operation:'siesta.single-point',purpose:'EXPLORATORY',structure:{structure_id:structureId,revision:1},physical_model_ref:physicalModelRef,numerical_policy_ref:numericalPolicyRef,protocol:{protocol_id:'dftlab.single-point',version:'0.1.0'},promoted_from:{learning_dataset_id:learningDatasetId,exported_kind:'STRUCTURE'}});
  validate('structure-revision',revision);validate('run-intent',intent);
  return Object.freeze({structure:revision,intent});
}
