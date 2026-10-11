import * as validators from './validators.generated.js';
import vocabulary from '../../../../../contracts/vocabularies/native-status-projection.json' with {type:'json'};

export class ContractError extends Error {
  constructor(issues){super('Document does not satisfy the platform contract');this.issues=issues;}
}
function jsonTree(value,depth=0,seen=new Set()){
  if(depth>64)throw new Error('JSON nesting limit');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Nonfinite JSON');return;}
  if(typeof value==='string'){
    for(const char of value){const cp=char.codePointAt(0);if(cp>=0xd800&&cp<=0xdfff)throw new Error('Invalid Unicode');}return;
  }
  if(typeof value!=='object'||seen.has(value))throw new Error('Not JSON');
  const keys=Reflect.ownKeys(value);
  if(Array.isArray(value)){
    if(keys.length!==value.length+1||Array.from({length:value.length},(_,i)=>String(i)).some(k=>!Object.hasOwn(value,k)))throw new Error('Invalid JSON array');
  }else if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw new Error('Not JSON object');
  seen.add(value);
  for(const key of keys){
    if(typeof key!=='string'||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'))throw new Error('Invalid JSON property');
    jsonTree(key,depth+1,seen);jsonTree(value[key],depth+1,seen);
  }seen.delete(value);
}
export function canonical(value){
  jsonTree(value);
  function encode(v){
    if(v===null||typeof v!=='object')return JSON.stringify(v);
    if(Array.isArray(v))return '['+v.map(encode).join(',')+']';
    return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}';
  }return encode(value);
}
export async function digest(value){
  const bytes=new TextEncoder().encode(canonical(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function validate(name,value){
  const key=name.replace('.schema.json','').replaceAll('-','_');
  const validator=validators[key];if(typeof validator!=='function')throw new Error('Unknown bundled schema');
  try{jsonTree(value);}catch{throw new ContractError([{pointer:'',code:'VALIDATION_FAILED',message:'Invalid JSON value'}]);}
  if(value&&Object.hasOwn(value,'schema_version')&&!/^0\.1\./.test(value.schema_version))throw new ContractError([{pointer:'/schema_version',code:'UNSUPPORTED_SCHEMA_VERSION',message:'Only platform minor 0.1 is supported'}]);
  if(!validator(value))throw new ContractError(validator.errors.slice(0,32).map(e=>({pointer:e.instancePath,code:'VALIDATION_FAILED',message:`Schema rule: ${e.keyword}`})));
  return value;
}
export async function verifyEnvelope(name,value){
  validate(name,value);
  if(value.integrity?.status==='VERIFIED'){
    const unsigned=Object.fromEntries(Object.entries(value).filter(([key])=>key!=='integrity'));
    if(await digest(unsigned)!==value.integrity.digest)throw new ContractError([{pointer:'/integrity/digest',code:'PRECONDITION_FAILED',message:'Envelope digest mismatch'}]);
  }return value;
}
export function consumerState(schema,value,valid=true){
  if(!valid)return {display_state:'UNKNOWN',is_pass:false,is_certified:false};
  const p=value.payload??value.body??{};
  if(schema.startsWith('submission-receipt'))return {resubmit_allowed:false};
  if(schema.startsWith('event-record'))return {ignored:!['operation.state_changed','run.projection_updated','run.attempt_created','run.output_segment','artifact.committed','assessment.recorded','stream.resync_required'].includes(value.type)};
  let state;
  if(schema.startsWith('run-projection')){state=p.dimensions.science.value;if(state==='UNKNOWN'||['execution','scheduler'].some(k=>p.dimensions[k].value==='UNKNOWN'))return {display_state:'UNKNOWN',is_failed:p.dimensions.execution.value==='FAILED'};}
  else{const native=p.native_status??p.plan_status??p.numerical_status;state=native?(vocabulary.vocabularies[native.vocabulary]?.projection?.[native.value]??vocabulary.default_projection):(p.passport_state??'NOT_ESTABLISHED');}
  return {display_state:state,is_pass:state==='PASS',is_certified:false};
}
