// Authoring preview only. Python persists revisions; QRAFT owns all gates.
import {siestaInput} from './fdfgen.js';
import {renderConstraints} from '../crystal/slabs.js';

export const PRESET_DEFAULTS = Object.freeze({xc:'PBE',basis:'DZP',energy_shift_meV:20,mesh_Ry:300,
  kgrid:Object.freeze([4,4,4]),kshift:Object.freeze([.5,.5,.5]),spin:'non-polarized',charge:0,
  max_force_eV_A:.02,steps:200,max_stress_GPa:.1,fc_displacement_A:.02});
const routes={'S-01':'molecule','S-02':'relaxation','S-03':'variable-cell','S-04':'relaxation',
  'S-05':'ground-state','S-06':'ground-state','S-07':'molecular-vibration','S-08':'magnetic-selection'};
export function presetRegistry(){
  return Object.fromEntries(Object.entries(routes).map(([id,route])=>[id,{protocol_id:`qraft.preset.${id.toLowerCase()}@1`,
    policy_id:'qraft.presets.policy@1',route,status:'CONTRACT_TESTED',
    defaults:structuredClone(PRESET_DEFAULTS)}]));
}
export function presetPreview(cell,id,{parameters={},fixed=[],mesh_sizes=null,initial_spin=null,electrons=null,hexagonal_axes=[]}={}){
  if(!routes[id])throw new Error('UNKNOWN_PRESET');
  const p={...structuredClone(PRESET_DEFAULTS),...parameters};
  if(['S-01','S-07'].includes(id)){p.kgrid=[1,1,1];p.kshift=[0,0,0];}
  if(id==='S-01' && electrons!==null && electrons%2)p.spin='polarized';
  for(const axis of hexagonal_axes)p.kshift[axis]=0;
  let fdf=siestaInput(cell,{label:'siesta',xc:p.xc,basis:p.basis,energyShift:p.energy_shift_meV,mesh:p.mesh_Ry,
    kmode:'grid',kgrid:p.kgrid,kshift:0,spin:p.spin,run:'single',bands:false,pdos:false,mulliken:false});
  fdf=fdf.replace(/^DM.UseSaveDM.*\n/m,'');
  const grid=p.kgrid.map((n,i)=>[...Array.from({length:3},(_,j)=>i===j?n:0),p.kshift[i]].join(' ')).join('\n');
  fdf=fdf.replace(/%block kgrid_Monkhorst_Pack[\s\S]*?%endblock kgrid_Monkhorst_Pack/,`%block kgrid.MonkhorstPack\n${grid}\n%endblock kgrid.MonkhorstPack`);
  const tail=[`NetCharge ${p.charge}`,'Charge.Mulliken end'];
  if(p.spin==='polarized'){
    if(!initial_spin || initial_spin.length!==cell.numbers.length)throw new Error('SPIN_CONFIGURATION_REQUIRED');
    tail.push('%block DM.InitSpin',...initial_spin.map((s,i)=>`${i+1} ${s}`),'%endblock DM.InitSpin');
  }
  if(['S-02','S-03','S-04'].includes(id)){
    tail.push('MD.TypeOfRun CG',`MD.Steps ${p.steps}`,`MD.MaxForceTol ${p.max_force_eV_A} eV/Ang`);
    if(id==='S-03'){
      if(!mesh_sizes || mesh_sizes.length!==3 || mesh_sizes.some(n=>!Number.isInteger(n)||n<1))throw new Error('MESH_SIZES_REQUIRED');
      tail.push('MD.VariableCell T','MD.TargetPressure 0 GPa',`MD.MaxStressTol ${p.max_stress_GPa} GPa`,`Mesh.Sizes [${mesh_sizes.join(' ')}]`);
    }
    if(fixed.length){const c=renderConstraints(cell.numbers.length,fixed);if(c.error)throw new Error(c.error);tail.push(c.text.trimEnd());}
  }else if(id==='S-07'){
    tail.push('MD.TypeOfRun FC',`FC.Displacement ${p.fc_displacement_A} Ang`,'FC.First 1',`FC.Last ${cell.numbers.length}`);
  }else tail.push('MD.TypeOfRun CG','MD.NumCGSteps 0');
  const required_files=id==='S-07'?['siesta.FC']:id==='S-06'?['siesta.RHO','siesta.VH','siesta.PLD','siesta.DIM','siesta.WFSX']:[];
  if(id==='S-06')tail.push('SaveRho T','SaveElectrostaticPotential T','WriteDenchar T','WriteWaveFunctions T');
  return {fdf:fdf+tail.join('\n')+'\n',defaults:structuredClone(PRESET_DEFAULTS),resolved_parameters:p,required_files};
}
