// Section registry: order here = order in the sidebar.
import * as bands from './bands.js';
import * as pseudo from './pseudo.js';
import * as xc from './xc.js';
import * as home from './home.js';
import * as scf from './scf.js';
import * as calc from './calc.js';
import * as ks from './ks.js';
import * as basis from './basis.js';
import * as post from './postproc.js';
import * as estr from './estructura.js';
import * as dftu from './dftu.js';
import * as solv from './solvers.js';
import * as dens from './density.js';
import * as pot from './potential.js';
import * as spin from './spin.js';
import * as lect from './lectura.js';
import * as phon from './phonons.js';
import * as forc from './forces.js';
import * as beyond from './beyond.js';

export const GROUPS=[{id:'start',title:'DFT Lab'},{id:'learn',title:'Aprender'},{id:'tools',title:'Herramientas'},{id:'post',title:'Postproceso'}];
export const VIEWS=[
  {id:'inicio', group:'start', num:'', title:'Inicio', render:home.mount},
  {id:'ks', group:'learn', num:'1', title:'Kohn–Sham', render:ks.mount, desc:'Las ecuaciones resueltas en vivo para cualquier átomo del H al Xe; ΔSCF frente a −ε_HOMO.'},
  {id:'pseudos', group:'learn', num:'2', title:'Pseudopotenciales', render:pseudo.mount},
  {id:'xc', group:'learn', num:'3', title:'Intercambio y correlación', render:xc.mount},
  {id:'base', group:'learn', num:'4', title:'Base, malla y puntos k', render:basis.mount, desc:'135 corridas de Si: orbitales PAO, EnergyShift, MeshCutoff con egg-box, malla k.'},
  {id:'scf', group:'learn', num:'5', title:'Ciclo autoconsistente', render:scf.mount, destroy:scf.destroy, desc:'Doce corridas reales: por qué un metal diverge con mezcla lineal y Pulay lo arregla.'},
  {id:'solvers', group:'learn', num:'6', title:'Diagonalización y orden N', render:solv.mount, desc:'Silicio de 8 a 1000 átomos con tres métodos: tiempo, escalado y error.'},
  {id:'bandas', group:'learn', num:'7', title:'Bandas, DOS y óptica', render:bands.mount, destroy:bands.destroy},
  {id:'dftu', group:'learn', num:'8', title:'DFT+U', render:dftu.mount, desc:'NiO antiferromagnético con U de 0 a 13.8 eV; U calculado por respuesta lineal en tres celdas.'},
  {id:'densidad', group:'learn', num:'9', title:'Densidad y cargas', render:dens.mount, destroy:dens.destroy, desc:'ρ y Δρ = ρ − Σρ átomos en Si, MgO y H₂O; cargas de Mulliken, Hirshfeld y Voronoi frente a la base; lector de .RHO/.DRHO.'},
  {id:'potencial', group:'learn', num:'10', title:'Potencial y función trabajo', render:pot.mount, destroy:pot.destroy, desc:'Promedio planar y macroscópico del potencial electrostático en láminas de Al y Mg; función trabajo frente a espesor, base y cara cristalina; lector de .VH/.VT.'},
  {id:'espin', group:'learn', num:'11', title:'Espín y magnetismo', render:spin.mount, desc:'Fe bcc ferromagnético frente a no magnético (bandas ↑↓, E(a), momento, Stoner) y NiO FM frente a AFM con U de 0 a 13.8 eV.'},
  {id:'lectura', group:'learn', num:'12', title:'Lectura anotada del .out', render:lect.mount, destroy:lect.destroy, desc:'Un .out real de SIESTA bloque por bloque: cada línea explicada, tolerancias comparadas con el propio archivo y un diagnóstico; acepta el tuyo.'},
  {id:'fonones', group:'learn', num:'13', title:'Fonones', render:phon.mount, destroy:phon.destroy, desc:'Si con desplazamientos finitos en una supercelda de 16 átomos: el .FC se diagonaliza aquí; dispersión, DOS y modo animado frente a neutrones; lector de tu .FC.'},
  {id:'fuerzas', group:'learn', num:'14', title:'Fuerzas, estrés y relajación', render:forc.mount, destroy:forc.destroy, desc:'Fuerza de SIESTA frente a −dE/dr (Hellmann–Feynman y Pulay), egg-box y tolerancia; H₂O con CG, Broyden y FIRE y la vacancia del Si en 3D; E(V) con estrés; lector de tu relajación.'},
  {id:'beyond', group:'learn', num:'15', title:'Más allá de DFT', render:beyond.mount, destroy:beyond.destroy, desc:'Escalera de Jacob y gaps de 15 sólidos con LSDA, meta-GGA, HSE, G₀W₀ y GW frente al experimento, con la fuente de cada cifra.'},
  {id:'estructura', group:'tools', num:'', title:'Estructura y entrada', render:estr.mount, destroy:estr.destroy, desc:'CIF/POSCAR/XYZ → simetría, Wyckoff, zona de Brillouin, camino k, .fdf completo y script SLURM/PBS.'},
  {id:'calc', group:'tools', num:'', title:'Calculadoras', render:calc.mount, desc:'Malla k y MeshCutoff desde la celda, Birch–Murnaghan, masa efectiva, smearing, unidades.'},
  {id:'post', group:'post', num:'', title:'Mis archivos de SIESTA', render:post.mount, destroy:post.destroy, desc:'Arrastra .out, .bands, .PDOS, .EIG, .EPSIMG, .XV… y exporta figuras, datos, geometría e informe.'},
];
