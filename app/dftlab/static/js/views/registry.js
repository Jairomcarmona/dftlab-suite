// Section registry: order here = order in the sidebar.

export const GROUPS=[{id:'start',title:'DFT Lab'},{id:'learn',title:'Aprender'},{id:'tools',title:'Herramientas'},{id:'post',title:'Postproceso'}];
export const VIEWS=[
  {id:'inicio', group:'start', num:'', title:'Inicio', load:()=>import('./home.js')},
  {id:'ks', group:'learn', num:'1', title:'Kohn–Sham', load:()=>import('./ks.js'), desc:'Las ecuaciones resueltas en vivo para cualquier átomo del H al Xe; ΔSCF frente a −ε_HOMO.'},
  {id:'pseudos', group:'learn', num:'2', title:'Pseudopotenciales', load:()=>import('./pseudo.js')},
  {id:'xc', group:'learn', num:'3', title:'Intercambio y correlación', load:()=>import('./xc.js')},
  {id:'base', group:'learn', num:'4', title:'Base, malla y puntos k', load:()=>import('./basis.js'), desc:'135 corridas de Si: orbitales PAO, EnergyShift, MeshCutoff con egg-box, malla k.'},
  {id:'scf', group:'learn', num:'5', title:'Ciclo autoconsistente', load:()=>import('./scf.js'), desc:'Doce corridas reales: por qué un metal diverge con mezcla lineal y Pulay lo arregla.'},
  {id:'solvers', group:'learn', num:'6', title:'Diagonalización y orden N', load:()=>import('./solvers.js'), desc:'Silicio de 8 a 1000 átomos con tres métodos: tiempo, escalado y error.'},
  {id:'bandas', group:'learn', num:'7', title:'Bandas, DOS y óptica', load:()=>import('./bands.js')},
  {id:'dftu', group:'learn', num:'8', title:'DFT+U', load:()=>import('./dftu.js'), desc:'NiO antiferromagnético con U de 0 a 13.8 eV; U calculado por respuesta lineal en tres celdas.'},
  {id:'densidad', group:'learn', num:'9', title:'Densidad y cargas', load:()=>import('./density.js'), desc:'ρ y Δρ = ρ − Σρ átomos en Si, MgO y H₂O; cargas de Mulliken, Hirshfeld y Voronoi frente a la base; lector de .RHO/.DRHO.'},
  {id:'potencial', group:'learn', num:'10', title:'Potencial y función trabajo', load:()=>import('./potential.js'), desc:'Promedio planar y macroscópico del potencial electrostático en láminas de Al y Mg; función trabajo frente a espesor, base y cara cristalina; lector de .VH/.VT.'},
  {id:'espin', group:'learn', num:'11', title:'Espín y magnetismo', load:()=>import('./spin.js'), desc:'Fe bcc ferromagnético frente a no magnético (bandas ↑↓, E(a), momento, Stoner) y NiO FM frente a AFM con U de 0 a 13.8 eV.'},
  {id:'lectura', group:'learn', num:'12', title:'Lectura anotada del .out', load:()=>import('./lectura.js'), desc:'Un .out real de SIESTA bloque por bloque: cada línea explicada, tolerancias comparadas con el propio archivo y un diagnóstico; acepta el tuyo.'},
  {id:'fonones', group:'learn', num:'13', title:'Fonones', load:()=>import('./phonons.js'), desc:'Si con desplazamientos finitos en una supercelda de 16 átomos: el .FC se diagonaliza aquí; dispersión, DOS y modo animado frente a neutrones; lector de tu .FC.'},
  {id:'fuerzas', group:'learn', num:'14', title:'Fuerzas, estrés y relajación', load:()=>import('./forces.js'), desc:'Fuerza de SIESTA frente a −dE/dr (Hellmann–Feynman y Pulay), egg-box y tolerancia; H₂O con CG, Broyden y FIRE y la vacancia del Si en 3D; E(V) con estrés; lector de tu relajación.'},
  {id:'beyond', group:'learn', num:'15', title:'Más allá de DFT', load:()=>import('./beyond.js'), desc:'Escalera de Jacob y gaps de 15 sólidos con LSDA, meta-GGA, HSE, G₀W₀ y GW frente al experimento, con la fuente de cada cifra.'},
  {id:'estructura', group:'tools', num:'', title:'Estructura y entrada', load:()=>import('./estructura.js'), desc:'CIF/POSCAR/XYZ → simetría, Wyckoff, zona de Brillouin, camino k, .fdf completo y script SLURM/PBS.'},
  {id:'calc', group:'tools', num:'', title:'Calculadoras', load:()=>import('./calc.js'), desc:'Malla k y MeshCutoff desde la celda, Birch–Murnaghan, masa efectiva, smearing, unidades.'},
  {id:'post', group:'post', num:'', title:'Mis archivos de SIESTA', load:()=>import('./postproc.js'), desc:'Arrastra .out, .bands, .PDOS, .EIG, .EPSIMG, .XV… y exporta figuras, datos, geometría e informe.'},
];
