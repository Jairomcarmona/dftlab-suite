import {validate,validateApi} from '../sdk/contracts.js';

// Explicit export seam. The application injects createDraft; no transport
// imports, operation submission or mutation of learning data.
export async function promoteStructure({structure,projectId,learningDatasetId,title,key,intent=null,createDraft}){
  validate('structure-revision',structure);
  const content=structuredClone(structure.payload);
  delete content.structure_id;delete content.revision;delete content.parent_revision;
  const request=validateApi('createDraft','request',{
    idempotency_key:key,title,
    origin:{kind:'LEARNING_PROMOTION',learning_dataset_id:learningDatasetId,exported_kind:intent===null?'STRUCTURE':'TEMPLATE',source_artifact:null},
    purpose:'EXPLORATORY',structure:content,intent:structuredClone(intent),
  });
  return createDraft(projectId,request);
}
