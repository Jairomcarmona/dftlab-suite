import assert from 'node:assert/strict';
import {nativeResultSummary,renderNativeResult} from '../../dftlab/static/js/siesta/native-results.js';
import {detectAndParse} from '../../dftlab/static/js/siesta/index.js';
const raw={policy_id:'qraft.electronic.policy@1',authority:'NUMERICAL_CANDIDATE',origin:'PROVISIONAL_DIRECT_SCF',worker_environment_sha256:'a'.repeat(64),
  gap:{scope:'PATH',status:'GAP',gap_eV:.5562},
  groups:[{k_index:0,spin:0,bands:[2,3,4],size:3,weights:{s:-.2,p:3.2}}]};
const summary=nativeResultSummary(raw);
assert.equal(summary.authority,'NUMERICAL_CANDIDATE');
assert.equal(summary.worker_environment_sha256,raw.worker_environment_sha256);
assert.deepEqual(summary.groups,raw.groups);
summary.groups[0].weights.s=9;assert.equal(raw.groups[0].weights.s,-.2);
assert.throws(()=>nativeResultSummary({...raw,groups:[{bands:[2,3],size:3}]}),/INVALID_NATIVE_GROUP_PRESENTATION/);
assert.throws(()=>nativeResultSummary({...raw,groups:[{bands:[2,3],size:2,individual_weights:[.5,.5]}]}),/INVALID_NATIVE_GROUP_PRESENTATION/);
const target={ownerDocument:{createElement:()=>({})},replaceChildren(node){this.node=node;}};
renderNativeResult(target,raw);assert.equal(JSON.parse(target.node.textContent).groups[0].weights.s,-.2);
const parsed=detectAndParse('electronic.json',JSON.stringify(raw));
assert.equal(parsed.kind,'qraft-native');assert.deepEqual(parsed.data,raw);
assert.equal(detectAndParse('electronic.json',JSON.stringify({...raw,groups:[{bands:[1,2],size:2,individual_weights:[1,1]}]})).data,null);
const eos={policy_id:'qraft.eos.policy@1',status:'ESTABLISHED',quantity:'FreeEnergy',natoms:2,points:[{volume:40,energy:-200}]};
assert.deepEqual(nativeResultSummary(detectAndParse('eos.json',JSON.stringify(eos)).data).native_result,eos);
assert.equal(detectAndParse('fat.json',JSON.stringify({groups:[],padding:'x'.repeat(5000),policy_id:raw.policy_id})).kind,'qraft-native');
console.log('Native result import and presentation: 12 assertions PASS');
