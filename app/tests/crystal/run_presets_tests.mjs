import assert from 'node:assert/strict';
import {presetRegistry,presetPreview,PRESET_DEFAULTS} from '../../dftlab/static/js/tools/presets.js';
const cell={lattice:[[0,2.715,2.715],[2.715,0,2.715],[2.715,2.715,0]],positions:[[0,0,0],[.25,.25,.25]],numbers:[14,14]};
for(const [id,preset] of Object.entries(presetRegistry())){
  assert.equal(preset.protocol_id,`qraft.preset.${id.toLowerCase()}@1`);
  assert.deepEqual(preset.defaults,PRESET_DEFAULTS);
  const preview=presetPreview(cell,id,{mesh_sizes:[30,30,30],fixed:id==='S-04'?[1]:[]});
  assert.match(preview.fdf,/Charge.Mulliken end/);
  assert.doesNotMatch(preview.fdf,/WriteMullikenPop|MD.FCDispl|Slab.DipoleCorrection/);
  if(['S-01','S-07'].includes(id))assert.match(preview.fdf,/1 0 0 0\n0 1 0 0\n0 0 1 0/);
  if(id==='S-07')assert.match(preview.fdf,/FC.Displacement 0.02 Ang\nFC.First 1\nFC.Last 2/);
  if(id==='S-05'){assert.match(preview.fdf,/MD.NumCGSteps 0/);assert.doesNotMatch(preview.fdf,/MD.Steps/);}
}
assert.throws(()=>presetPreview(cell,'S-03'),/MESH_SIZES_REQUIRED/);
assert.throws(()=>presetPreview(cell,'S-08',{parameters:{spin:'polarized'}}),/SPIN_CONFIGURATION_REQUIRED/);
assert.equal(presetRegistry()['S-03'].status,'DESIGNED');
console.log('Preset preview: eight authoring presets, Gamma, modern labels, files and explicit prerequisites passed.');
