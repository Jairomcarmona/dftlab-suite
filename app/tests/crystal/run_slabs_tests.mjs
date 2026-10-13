import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildSlab,slabInvariants,bottomPlaneAtoms,renderConstraints} from '../../dftlab/static/js/crystal/slabs.js';
const doc=JSON.parse(fs.readFileSync(new URL('../../../docs/scientific-protocols/vectors/slabs.cases.json',import.meta.url),'utf8'));
function near(a,e,abs){
 if(typeof e==='number'){assert.ok(Math.abs(a-e)<=abs+doc.arithmetic_tolerance.rel*Math.abs(e),`${a} != ${e}`);return;}
 if(e===null||typeof e!=='object'){assert.deepEqual(a,e);return;}
 assert.deepEqual(Object.keys(a),Object.keys(e));
 for(const k of Object.keys(e))near(a[k],e[k],abs);
}
for(const c of doc.cases){
 let got;let abs=doc.arithmetic_tolerance.abs_A;
 if(c.kind==='reference'){abs=doc.reference_tolerance_A;near(slabInvariants(c.reference),c.expect,abs);got=slabInvariants(buildSlab(c.bulk,c.spec));}
 else if(c.kind==='build')got=buildSlab(c.bulk,c.spec);
 else if(c.kind==='bottom_planes')got=bottomPlaneAtoms(buildSlab(c.bulk,c.spec),c.k);
 else if(c.kind==='constraints')got=renderConstraints(c.n_atoms,c.fixed);
 else if(c.kind==='invariants')got=slabInvariants(c.geometry);
 else throw Error(c.kind);
 near(got,c.expect,abs);
}
console.log(`Slab preview: ${doc.cases.length}/${doc.cases.length} accepted vectors`);