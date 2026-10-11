import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {canonical,digest,validate,verifyEnvelope,consumerState,ContractError} from '../../dftlab/static/js/sdk/contracts.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'../../..');
const load=p=>JSON.parse(readFileSync(join(root,'contracts',p),'utf8'));
let count=0;
for(const entry of load('fixtures/manifest.json').fixtures){
  const value=load(entry.path);
  if(entry.expect==='valid')await verifyEnvelope(entry.schema,value);
  else assert.throws(()=>validate(entry.schema,value),ContractError,entry.path);
  if(entry.consumer){const state=consumerState(entry.schema,value,entry.expect==='valid');for(const [k,v] of Object.entries(entry.consumer))assert.equal(state[k],v,entry.path+':'+k);}
  count++;
}
const expected=load('fixtures/canonicalization/expected.json');
for(const example of load('fixtures/canonicalization/inputs.json')){
  assert.equal(canonical(example.input),expected[example.name].canonical);
  assert.equal(await digest(example.input),expected[example.name].sha256);
}
assert.equal(canonical({'\ue000':1,'😀':2}),'{"😀":2,"\ue000":1}');
for(const value of [NaN,Infinity,'\ud800',new Array(2),new Date(),{get secret(){throw new Error('must not execute getter');}}])assert.throws(()=>canonical(value));
const cyclic={};cyclic.self=cyclic;assert.throws(()=>canonical(cyclic));
const forged=load('fixtures/envelope/valid/verified-digest.json');forged.payload.forged=true;
await assert.rejects(()=>verifyEnvelope('envelope',forged),ContractError);
console.log(`Contracts JS: ${count} shared fixtures, consumer semantics, JCS and hostile JSON passed`);
