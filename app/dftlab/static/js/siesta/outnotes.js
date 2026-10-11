// Lectura anotada de un .out de SIESTA: segmenta el texto en bloques, anota líneas y diagnostica.
// Puro (sin DOM): lo usan views/lectura.js y tests/siesta/run_outnotes_tests.mjs.
// Las anotaciones describen el formato de SIESTA 4/5; las que dependen de números del propio archivo
// se calculan con esos números (tolerancias, conteos, sumas), nunca con valores fijos.
import { parseOut } from './out.js';

const num = s => parseFloat(String(s).replace(/D/i, 'e'));
const f = (x, n = 4) => (x === undefined || x === null || !isFinite(x)) ? '—' : (x < 0 ? '−' : '') + Math.abs(x).toFixed(n);
const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const g = x => { if (!isFinite(x)) return '—'; if (x < 0) return '−' + g(-x); if (x !== 0 && (x < 1e-3 || x >= 1e5)) { const [m, e] = x.toExponential(1).split('e'); return m + '×10' + String(+e).split('').map(c => SUP[c]).join(''); } return String(+x.toPrecision(5)); };

/* ───────────────────────── Bloques ───────────────────────── */
export const BLOCKS = {
  header: { title: 'Encabezado y versión', intro: 'Qué ejecutable corrió, con qué compilador y con qué funciones compiladas (MPI, NetCDF, Lua, DFT-D3). Es lo primero que hay que citar en un artículo y lo primero que se pide al reportar un error.',
    look: 'La versión (5.4.2 aquí) importa: SIESTA 5 cambió valores por defecto de la base. «Running in serial mode» o «Running on N nodes» confirma si el trabajo usó MPI como esperabas.' },
  fdf: { title: 'Lectura del fdf', intro: 'SIESTA anuncia qué archivo de entrada leyó y el prefijo (SystemLabel) con el que nombrará todos los demás archivos de salida. Si la entrada llega por stdin, aquí aparece también el eco del fdf.',
    look: 'Que el archivo sea el que crees. Un SystemLabel repetido entre corridas hace que se sobrescriban .DM, .EIG, .XV… en la misma carpeta (y que SIESTA reutilice un .DM viejo).' },
  pseudo: { title: 'Pseudopotencial', intro: 'Por cada especie, SIESTA lee el pseudopotencial (psf o psml), comprueba su funcional y su configuración de valencia, y decide cuántos proyectores de Kleinman–Bylander (KB) usar.',
    look: 'Que el funcional del pseudo coincida con XC.functional/authors; que los electrones de valencia sean los que esperas (¿semicore?); que no aparezca la palabra «ghost» (estado fantasma de un proyector KB mal condicionado).' },
  basis: { title: 'Base de orbitales atómicos', intro: 'SIESTA resuelve el átomo aislado con el pseudopotencial y construye los orbitales numéricos (PAO): radios de corte, desdoblamiento (split) para las ζ adicionales y orbitales de polarización.',
    look: 'Los radios de corte rc (Bohr) y el EnergyShift determinan el alcance de cada orbital; un rc muy grande dispara el costo, uno muy pequeño da una base rígida. El número total de orbitales debe ser mayor que la mitad de los electrones.' },
  geom: { title: 'Geometría inicial', intro: 'Coordenadas atómicas (Bohr) y especie de cada átomo tal como SIESTA las usará, el tipo de sistema y el conteo de átomos, orbitales y proyectores.',
    look: 'Que el número de átomos y de orbitales sea el esperado y que la lista de coordenadas coincida con tu estructura.' },
  params: { title: 'Parámetros de la simulación (redata)', intro: 'Cada línea «redata:» es un parámetro tal como SIESTA lo usará, con los valores por defecto ya aplicados. Es la verdad de la corrida, más que tu fdf: lo que no escribiste aparece aquí con su valor efectivo.',
    look: 'Spin, MeshCutoff, tolerancias del SCF, método de solución (diagonalización, OMM, orden N), temperatura electrónica y tipo de dinámica. Si un valor no es el que querías, el fdf tiene un error de escritura.' },
  kmesh: { title: 'Electrones, puntos k y solver', intro: 'Conteo de electrones y de carga iónica, malla de puntos k generada, supercelda auxiliar para los solapes y opciones del algoritmo de diagonalización.',
    look: 'Electrones = carga iónica si el sistema es neutro; número de puntos k (multiplica el costo de cada iteración); la supercelda auxiliar crece con el alcance de los orbitales.' },
  step: { title: 'Celda, malla de integración y energía inicial', intro: 'Con la celda y la base fijas, SIESTA arma la matriz de solapes, inicializa la matriz de densidad (DM) y define la malla de espacio real. La energía inicial sale de la densidad de átomos superpuestos y todavía no es autoconsistente.',
    look: '«Mesh cutoff (required, used)»: lo usado debe ser ≥ lo pedido. Si lees la DM de un archivo (.DM) el SCF suele necesitar menos iteraciones; «Failed» es normal en la primera corrida.' },
  scf: { title: 'Ciclo autoconsistente (SCF)', intro: 'Cada fila «scf:» es una iteración: se construye H desde la densidad, se diagonaliza, se mezcla la nueva densidad con la anterior y se mide cuánto cambió (dDmax, dHmax). El ciclo termina cuando ambos bajan de su tolerancia.',
    look: 'dDmax y dHmax deben caer de forma casi monótona hasta la tolerancia. Saltos hacia arriba o oscilaciones indican mezcla demasiado agresiva, smearing insuficiente en un metal o un momento magnético que no se decide.' },
  conv: { title: 'Criterio de convergencia', intro: 'SIESTA dice con qué criterio paró (DM, H o ambos) y los valores finales de dDmax y dHmax. Si el SCF falla, aquí aparece el aviso y, según SCF.MustConverge, la corrida se aborta.',
    look: '«SCF cycle converged after N iterations». Si dice «did NOT converge», no uses ninguna energía, fuerza ni estructura de ese paso.' },
  forces: { title: 'Energía, fuerzas y estrés', intro: 'Energía de Kohn–Sham final del paso, fuerzas sobre los átomos (Hellmann–Feynman más corrección de Pulay por la base), tensor de estrés y entalpía.',
    look: 'En una relajación, la fuerza máxima debe bajar de MD.MaxForceTol (0.04 eV/Å por defecto). En una celda sin relajar, la presión dice si la red está comprimida o expandida respecto a su equilibrio.' },
  pop: { title: 'Poblaciones y cargas', intro: 'Análisis de Mulliken (y Hirshfeld/Voronoi si se pidieron): cuántos electrones se asigna a cada átomo y a cada orbital, por espín y en total. Es un reparto, no una observable.',
    look: 'La suma de poblaciones debe dar el total de electrones. Poblaciones orbitales negativas son un artefacto del reparto de solapes con orbitales difusos. El valor de Mulliken depende de la base: compáralo solo con la misma base.' },
  eig: { title: 'Eigenvalores', intro: 'Energías de Kohn–Sham por punto k (y por espín), impresas con WriteEigenvalues. Normalmente es la parte más larga del archivo; el mismo dato va en el .EIG.',
    look: 'Para una banda de gap: último estado ocupado y primer vacío, siempre contando el punto k. Para eso es mejor leer el .EIG o el .bands (sección «Mis archivos de SIESTA»).' },
  efinal: { title: 'Descomposición final de la energía', intro: 'Energía de Fermi y descomposición de la energía total en sus términos: cinética, Hartree, intercambio-correlación, ion-electrón, ion-ion. Los términos sueltos no son comparables entre corridas; sí lo es la suma.',
    look: 'En SCF convergido, Eharris = Etot. La diferencia FreeEng − Etot es el término −TS del smearing electrónico (cero en aislantes con temperatura baja).' },
  stress: { title: 'Estrés, presión y entalpía', intro: 'Tensor de estrés estático y total, volumen de la celda, presión en varias unidades y la contribución de la base a la entalpía.',
    look: 'En SIESTA un estrés positivo corresponde a presión negativa: la celda es mayor que la de equilibrio y tiende a contraerse en una relajación con celda variable.' },
  geomfin: { title: 'Geometría relajada', intro: 'Coordenadas y celda al terminar la relajación o el paso de dinámica.',
    look: 'Compáralas con la estructura inicial; si el sistema se relajó hacia una simetría más baja, revisa que no sea un artefacto de un SCF no convergido.' },
  cite: { title: 'Citas', intro: 'Lista de artículos cuyos métodos usó esta corrida, con DOI. Es la forma correcta de citar: se genera según las opciones activas.',
    look: 'Cita todos los de la lista y la versión de SIESTA; el archivo .bib que menciona contiene las referencias en BibTeX.' },
  timer: { title: 'Tiempos', intro: 'Tiempo total de reloj y tabla de rutinas con llamadas, tiempo por llamada, tiempo total y porcentaje. Dice dónde se fue el cálculo.',
    look: 'El porcentaje de «diagon» o «compute_dm» mide el costo del solver; «setup_H», «DHSCF» y «vmat» son la malla; si «Setup» o «IterGeom» no son casi 100 % de «siesta», hay trabajo de E/S o de arranque atípico.' },
  end: { title: 'Fin de la corrida', intro: 'Marca de fin y «Job completed». Su ausencia indica que SIESTA murió, fue cortado por el gestor de trabajos o se quedó sin memoria.',
    look: 'Sin «Job completed» no hay resultado final: revisa el stderr del clúster y la memoria disponible.' },
  other: { title: 'Sin clasificar', intro: 'Líneas que no pertenecen a ninguna de las secciones reconocidas.', look: '' },
};

// Cada regla abre un bloque nuevo si el bloque actual no es del mismo tipo.
const STARTS = [
  { id: 'fdf', re: /^reinit:|^\s*\*+\s*Dump of input data file/ },
  { id: 'pseudo', re: /^initatom:|^Species number:/ },
  { id: 'basis', re: /^<basis_specs>/ },
  { id: 'geom', re: /^coor:|^siesta: Atomic coordinates \(Bohr\)/ },
  { id: 'params', re: /^siesta: \*+ Simulation parameters|^redata:/ },
  { id: 'kmesh', re: /^(Total number of electrons|k-point displ|\s*Kpoints in|siesta: k-grid: Number of k-points)/ },
  { id: 'scf', re: /^\s+iscf\s+(Eharris|E_KS)|^siesta: iscf\s*=|^\s*scf:\s+1\s/ },
  { id: 'conv', re: /^SCF Convergence by|^SCF cycle (converged|did not)|^\s*SCF_NOT_CONV|^siesta: SCF did not converge/i },
  { id: 'forces', re: /^siesta: E_KS\(eV\) =/ },
  { id: 'pop', re: /^(mulliken:|Mulliken Atomic Populations|hirshfeld:|Hirshfeld|voronoi:|Voronoi)/ },
  { id: 'eig', re: /^siesta: Eigenvalues \(eV\)/ },
  { id: 'efinal', re: /^siesta: (Fermi energy|Program's energy decomposition|Final energy)/, needs: s => s.afterScf },
  { id: 'stress', re: /^siesta: Stress tensor \(static\)|^Basis Enthalpy Calculation/ },
  { id: 'geomfin', re: /^outcoor: (Relaxed|Final)|^outcell: Unit cell vectors \(Ang\):\s*$/, needs: s => s.afterScf },
  { id: 'cite', re: /^cite:/ },
  { id: 'timer', re: /^timer: (Elapsed wall time|CPU execution)/ },
  { id: 'end', re: /^>> End of run/ },
];

export function segment(lines) {
  const blocks = []; let cur = null; const st = { afterScf: false }; let stepNo = 0;
  const open = (id, i) => { cur = { id, from: i, to: i, step: stepNo }; blocks.push(cur); };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let id = null;
    // un paso nuevo (banner entre líneas de ====)
    if (/^\s*={10,}\s*$/.test(l) && /^\s+(Single-point calculation|Begin\s|.*opt\. move|.*MD step)/.test(lines[i + 1] || '')) {
      if (!cur || cur.id !== 'step' || st.afterScf) { stepNo++; st.afterScf = false; id = 'step'; }
    } else {
      for (const s of STARTS) {
        if (s.needs && !s.needs(st)) continue;
        if (s.re.test(l)) { id = s.id; break; }
      }
    }
    if (id === 'conv') st.afterScf = true;
    if (!cur) { open(id && id !== 'header' ? id : 'header', i); continue; }
    if (id && (id !== cur.id || (id === 'step'))) { cur.to = i - 1; open(id, i); }
    else cur.to = i;
  }
  if (cur) cur.to = lines.length - 1;
  // título con especie / paso
  for (const b of blocks) {
    let t = BLOCKS[b.id].title;
    if (b.id === 'pseudo' || b.id === 'basis') {
      for (let i = b.from; i <= Math.min(b.to, b.from + 60); i++) {
        const m = /Processing specs for species:\s*(\S+)|^(\w+)\s+Z=\s*\d+/.exec(lines[i] || ''); if (m) { t += ' · ' + (m[1] || m[2]); break; }
      }
    }
    if (stepNo > 1 && ['step', 'scf', 'conv', 'forces', 'pop', 'efinal', 'stress', 'eig'].includes(b.id) && b.step) t += ' · paso ' + b.step;
    b.title = t;
  }
  return blocks;
}

/* ───────────────────────── Diccionarios ───────────────────────── */
const ED = {
  Ebs: 'Energía de bandas: suma de los eigenvalores ocupados, Tr[ρH]. Sola no es una energía física.',
  Eions: 'Término iónico de la partición con átomos neutros de SIESTA (autoenergías de los iones). Es grande y positivo; solo tiene sentido dentro de la suma.',
  Ena: 'Energía asociada a los potenciales de átomo neutro (V_NA) que SIESTA suma y resta para que la parte de largo alcance converja rápido.',
  Ekin: 'Energía cinética de los electrones de Kohn–Sham.',
  Enl: 'Energía del pseudopotencial no local (proyectores de Kleinman–Bylander).',
  Eso: 'Acoplamiento espín–órbita. 0 si no se usa SOC.',
  Edftu: 'Corrección DFT+U. 0 si no hay U (ver sección 8).',
  DEna: 'Corrección de la energía de los átomos neutros respecto a la densidad real (parte de la partición de V_NA).',
  DUscf: 'Energía electrostática de la diferencia entre la densidad del SCF y la suma de átomos neutros.',
  DUext: 'Energía de un campo eléctrico externo. 0 sin campo.',
  Ex: 'Energía de intercambio del funcional.',
  Ec: 'Energía de correlación del funcional.',
  Exc: 'Intercambio + correlación (Ex + Ec).',
  EbV: 'Energía del bulk bias (TranSIESTA). 0 fuera de transporte.',
  'eta*DQ': 'Penalización por carga neta cuando se fija la carga con un fondo compensador. 0 en sistemas neutros.',
  Emadel: 'Corrección de Madelung por carga neta. 0 en sistemas neutros.',
  Emeta: 'Término meta-GGA. 0 si el funcional no es meta-GGA.',
  Emolmec: 'Mecánica molecular auxiliar (Geometry.Constraints/MM). 0 si no se usa.',
  Ekinion: 'Energía cinética de los iones (solo dinámica molecular).',
  Eharris: 'Energía del funcional de Harris–Foulkes: se evalúa con la densidad de entrada y no con la de salida del ciclo.',
  Etot: 'Energía total de Kohn–Sham (E_KS) con la densidad de salida. Es la que se compara entre corridas.',
  FreeEng: 'Energía libre Etot − TS, con T la temperatura electrónica. Es el funcional que minimiza SIESTA con smearing y el que da fuerzas consistentes.',
};
const FE = {
  'Band Struct.': 'Energía de bandas Σ f ε.', Kinetic: 'Cinética de Kohn–Sham.', Hartree: 'Repulsión electrostática electrón–electrón.',
  Edftu: 'Corrección DFT+U.', Eso: 'Espín–órbita.', 'Ext. field': 'Campo eléctrico externo.', 'Exch.': 'Intercambio.', 'Corr.': 'Correlación.',
  'Bulk bias': 'Bulk bias de TranSIESTA.', 'Exch.-corr.': 'Intercambio + correlación.', 'Ion-electron': 'Atracción ion–electrón (parte local y no local).',
  'Ion-ion': 'Repulsión ion–ion.', Ekinion: 'Cinética de los iones.', 'D3 dispersion': 'Corrección de dispersión DFT-D3.', Total: 'Energía total. Debe coincidir con Etot y, convergida, con Eharris.', Fermi: 'Energía de Fermi (eV), en la misma escala que los eigenvalores.',
};
const REDATA = [
  [/^Spin configuration/, 'Tipo de espín: sin polarizar, colineal («polarized»), no colineal o espín–órbita. Define cuántas matrices de densidad se resuelven.'],
  [/^Number of spin components/, 'Componentes de espín de la matriz de densidad: 1 (sin espín), 2 (colineal, ↑ y ↓), 4 (no colineal/SOC). Multiplica el costo de cada iteración.'],
  [/^Time-Reversal Symmetry/, 'Si SIESTA usa la simetría de inversión temporal para reducir los puntos k. En colineal con campo externo o espín no colineal puede apagarse.'],
  [/^Spin spiral/, 'Espirales de espín (teorema de Bloch generalizado). F = no se usan.'],
  [/^Number of Atomic Species/, 'Número de especies distintas (ChemicalSpeciesLabel).'],
  [/^Charge density info/, 'Qué archivo de densidad se escribirá (.RHO). Se activa con SaveRho.'],
  [/^Write Mulliken charges/, 'Cuándo se imprime el análisis de Mulliken (WriteMullikenPop): «geometry+end» es lo habitual.'],
  [/^Write Mulliken Pop/, 'Detalle del análisis de Mulliken: solo átomos o también por orbital.'],
  [/^Write Hirshfeld|^Write Voronoi/, 'Análisis de carga de Hirshfeld o Voronoi (ver sección 9). «none» = apagado.'],
  [/^Matel table size/, 'Tamaño de la tabla interna de elementos de matriz; no suele tocarse.'],
  [/^Mesh Cutoff/, 'MeshCutoff pedido: energía de corte de la malla de espacio real (Ry). Controla el error de integración de la densidad y del potencial XC y el efecto egg-box.'],
  [/^Net charge/, 'Carga neta del sistema (NetCharge). 0 = neutro. Con carga ≠ 0 aparece el término Emadel.'],
  [/^Min\. number of SCF/, 'Mínimo de iteraciones SCF (MinSCFIterations).'],
  [/^Max\. number of SCF/, 'Máximo de iteraciones SCF por paso (MaxSCFIterations). Si se agota sin converger, la corrida avisa o aborta según SCF.MustConverge.'],
  [/^SCF convergence failure will abort/, 'Si el SCF no converge, SIESTA aborta (SCF.MustConverge T, por defecto). Así no se publican energías sin converger.'],
  [/^SCF mix quantity/, 'Qué se mezcla entre iteraciones: Hamiltoniano (H) o matriz de densidad (DM).'],
  [/^Mix DM or H after/, 'Si se sigue mezclando tras converger (SCF.Mix.AfterConvergence).'],
  [/^Recompute H after/, 'Si se recalcula H al final para que energía y fuerzas sean consistentes (SCF.RecomputeHAfterSCF).'],
  [/^Mix DM in first SCF/, 'Mezclar la DM ya en la primera iteración (SCF.Mix.First).'],
  [/^Write Pulay info/, 'Guardar el historial de Pulay en disco para reiniciar.'],
  [/^New DM Occupancy tolerance/, 'Tolerancia de ocupación al renormalizar la DM.'],
  [/^No kicks/, 'Sin «patadas» periódicas a la mezcla (SCF.Kick).'],
  [/^DM Mixing Weight for Kicks/, 'Peso de mezcla en las patadas.'],
  [/^Require Harris convergence/, 'Si se exige también convergencia en la energía de Harris (SCF.Harris.Converge).'],
  [/^Harris energy tolerance/, 'Tolerancia en la energía de Harris, si se exige.'],
  [/^Require DM convergence/, 'Si el criterio de parada exige dDmax < tolerancia (SCF.DM.Converge, por defecto T).'],
  [/^DM tolerance for SCF/, 'Tolerancia de dDmax: máximo cambio de un elemento de la matriz de densidad entre la entrada y la salida de una iteración (SCF.DM.Tolerance, 10⁻⁴ por defecto).'],
  [/^Require EDM convergence/, 'Si se exige convergencia de la matriz de densidad de energía.'],
  [/^EDM tolerance/, 'Tolerancia de la matriz de densidad de energía, si se exige.'],
  [/^Require H convergence/, 'Si el criterio de parada exige dHmax < tolerancia (SCF.H.Converge, por defecto T).'],
  [/^Hamiltonian tolerance/, 'Tolerancia de dHmax en eV (SCF.H.Tolerance, 10⁻³ eV por defecto): máximo cambio de un elemento de H.'],
  [/^Require \(free\) Energy convergence/, 'Si se exige convergencia de la energía (libre) entre iteraciones.'],
  [/^\(free\) Energy tolerance/, 'Tolerancia de la energía (libre), si se exige.'],
  [/^Antiferro initial spin/, 'Espín inicial antiferromagnético automático (DM.InitSpin/Antiferro).'],
  [/^Using DFT-D3/, 'Dispersión DFT-D3. F = apagada.'],
  [/^Using Saved Data/, 'Si se reutiliza un SaveData completo.'],
  [/^Use continuation files for DM/, 'Si se intenta leer un .DM previo (DM.UseSaveDM). Con T, la corrida se arranca desde la densidad guardada si existe.'],
  [/^Neglect nonoverlap/, 'Ignorar interacciones entre orbitales que no se solapan (aproximación de OMM/orden N).'],
  [/^Method of Calculation/, 'Solver del problema de Kohn–Sham: diagonalización exacta, OMM o orden N (sección 6).'],
  [/^Electronic Temperature/, 'Temperatura electrónica kT del smearing (ElectronicTemperature). 1160 K ≈ 0.1 eV; 300 K ≈ 26 meV.'],
  [/^Fix the spin/, 'Si se fija el espín total (FixSpin).'],
  [/^Max\. number of TDED/, 'Iteraciones de TDDFT en tiempo real. 1 = no se usa.'],
  [/^Number of TDED substeps/, 'Subpasos de TDDFT en tiempo real. Sin efecto si no se usa.'],
  [/^Dynamics option/, 'Qué hace SIESTA tras el SCF: punto único, relajación (CG, FIRE…) o dinámica molecular.'],
  [/^Save all siesta data/, 'Guardar todo en un único archivo NetCDF (SaveData).'],
  [/^Long output/, 'LongOutput: si es T, imprime más detalle (fuerzas por átomo, eigenvalores, etc.).'],
];
const FDFKEYS = {
  systemlabel: 'Prefijo de todos los archivos de salida.', systemname: 'Nombre descriptivo (no afecta al cálculo).', numberofspecies: 'Número de especies químicas.', numberofatoms: 'Número de átomos.',
  latticeconstant: 'Escala de los vectores de red.', latticevectors: 'Vectores de la celda.', atomiccoordinatesformat: 'Unidades de las coordenadas (Fractional, Ang, Bohr, ScaledCartesian).',
  'pao.basissize': 'Tamaño de la base: SZ, DZ, SZP, DZP, TZP… (DZP por defecto en este curso).', 'pao.energyshift': 'Desplazamiento de energía que fija el radio de corte de los PAO: menor = orbitales más largos.',
  meshcutoff: 'Energía de corte de la malla de espacio real (Ry).', 'xc.functional': 'Familia del funcional: LDA o GGA.', 'xc.authors': 'Parametrización: CA/PZ (LDA), PBE, revPBE…',
  solutionmethod: 'diagon, OMM o orderN.', maxscfiterations: 'Máximo de iteraciones SCF.', 'scf.dm.tolerance': 'Tolerancia de dDmax.', 'scf.h.tolerance': 'Tolerancia de dHmax (eV).',
  'dm.tolerance': 'Tolerancia de dDmax (nombre antiguo).', 'dm.mixingweight': 'Peso de mezcla lineal (nombre antiguo).', 'dm.numberpulay': 'Historial de Pulay (nombre antiguo).',
  'scf.mixer.method': 'Mezclador: Linear, Pulay o Broyden.', 'scf.mixer.weight': 'Peso de mezcla.', 'scf.mixer.history': 'Longitud del historial de Pulay/Broyden.',
  electronictemperature: 'kT del smearing electrónico.', occupationfunction: 'Función de ocupación: FD (Fermi–Dirac), MP (Methfessel–Paxton), CS (cold smearing).', occupationmporder: 'Orden de Methfessel–Paxton.',
  spin: 'polarized = colineal; non-colinear; spin-orbit.', 'dm.initspin': 'Espín inicial por átomo.', 'md.typeofrun': 'CG, FIRE, Verlet, Nose…', 'md.numcgsteps': 'Pasos máximos de relajación.', 'md.maxforcetol': 'Fuerza máxima aceptada (eV/Å).',
  'md.variablecell': 'Relajar también la celda.', writemullikenpop: '0 nada, 1 átomos, 2 átomos + orbitales.', writeeigenvalues: 'Imprimir eigenvalores en el .out.', chemicalspecieslabel: 'Bloque: índice, número atómico, etiqueta.',
  'kgrid_monkhorst_pack': 'Bloque: malla de puntos k Monkhorst–Pack.', 'kgrid.monkhorstpack': 'Bloque: malla de puntos k Monkhorst–Pack.', 'bandlines': 'Bloque: camino de bandas.', 'pdos.kgrid_monkhorst_pack': 'Malla para la PDOS.',
  atomiccoordinatesandatomicspecies: 'Bloque: posición y especie de cada átomo.',
};
const TIMERS = {
  siesta: 'Todo el programa (100 % por definición).', Setup: 'Preparación inicial: lectura, base, listas de vecinos.', IterGeom: 'Bucle geométrico completo (SCF + fuerzas + movimiento).', IterSCF: 'Todas las iteraciones del ciclo autoconsistente.',
  compute_dm: 'Construir la matriz de densidad: diagonalización, ocupaciones, DM.', diagon: 'Diagonalización (resolver Hc = εSc en cada k y espín).', 'c-eigval': 'Eigenvalores (ScaLAPACK/LAPACK) de la diagonalización compleja.',
  'c-buildHS': 'Armar H(k) y S(k) a partir de las matrices dispersas.', 'c-eigvec': 'Eigenvectores (tras los eigenvalores).', 'c-buildD': 'Armar la matriz de densidad ρ = Σ f c c†.',
  cdiag: 'Diagonalizador complejo, etapa total.', setup_H: 'Construir H: potencial de malla, XC, Hartree y matrices no locales.', DHSCF: 'Todo el cálculo de densidad y potencial en la malla de espacio real.',
  DHSCF3: 'Densidad, potencial XC y Hartree sobre la malla.', DHSCF4: 'Cálculo final de fuerzas con la densidad convergida.', rhoofd: 'Densidad en la malla desde la DM y los orbitales (la parte cara de la malla).',
  vmat: 'Elementos de matriz del potencial de malla entre orbitales.', XC: 'Potencial y energía de intercambio-correlación.', POISON: 'Ecuación de Poisson (potencial de Hartree) por FFT.', fft: 'Transformadas rápidas de Fourier.',
  MIXER: 'Mezcla de la matriz (Pulay/Broyden/lineal): casi siempre insignificante.', PostSCF: 'Tras el SCF: fuerzas, estrés, análisis.', FINAL_HF: 'Fuerzas de Hellmann–Feynman finales.', dfscf: 'Fuerzas de la parte de malla.',
  nlefsm: 'Parte no local del pseudopotencial (proyectores KB).', kinefsm: 'Energía cinética (matriz de energía cinética).', overfsm: 'Matriz de solapes.', PHION: 'Orbitales y proyectores evaluados en la malla.', DHSCF_Init: 'Arranque de la malla y de las estructuras de datos.',
  state_init: 'Estado inicial (DM y primeras matrices).', geom_init: 'Inicialización de la geometría.', Setup_H0: 'Matrices H₀ (cinética + KB + potencial de átomo neutro).', Analysis: 'Poblaciones de Mulliken y demás análisis.', writeHSX: 'Escritura del archivo HSX.', 'GXC-CellXC': 'Funcional XC de libgridxc.', 'gridxc@cellXC': 'Funcional XC de libgridxc.', REORD: 'Reordenamiento entre distribuciones de la malla.', COMM_BSC: 'Comunicación de la malla (MPI).',
};

/* ───────────────────────── Exploración previa (contexto numérico) ───────────────────────── */
export function scan(lines, P) {
  const c = { tolDM: null, tolH: null, reqDM: true, reqH: true, maxScf: null, kT: null, meshReq: null, meshUsed: null, forceTol: 0.04, nspin: 1, nAtoms: P && P.nAtoms, nOrb: P && P.nOrbitals, nkpt: null, kcut: null };
  for (const l of lines) {
    let m;
    if (l.startsWith('redata:')) {
      if ((m = /^redata:\s+DM tolerance for SCF\s*=\s*(\S+)/.exec(l))) c.tolDM = num(m[1]);
      else if ((m = /^redata:\s+Hamiltonian tolerance for SCF\s*=\s*(\S+)/.exec(l))) c.tolH = num(m[1]);
      else if ((m = /^redata:\s+Require DM convergence\s*=\s*(\w)/.exec(l))) c.reqDM = m[1] === 'T';
      else if ((m = /^redata:\s+Require H convergence\s*=\s*(\w)/.exec(l))) c.reqH = m[1] === 'T';
      else if ((m = /Max\. number of SCF Iter\s*=\s*(\d+)/.exec(l))) c.maxScf = +m[1];
      else if ((m = /Electronic Temperature\s*=\s*(\S+)\s*K/.exec(l))) c.kT = num(m[1]);
      else if ((m = /Number of spin components\s*=\s*(\d+)/.exec(l))) c.nspin = +m[1];
    } else if ((m = /^InitMesh: Mesh cutoff \(required, used\) =\s*(\S+)\s+(\S+)/.exec(l))) { c.meshReq = num(m[1]); c.meshUsed = num(m[2]); }
    else if ((m = /^siesta: k-grid: Number of k-points =\s*(\d+)/.exec(l))) c.nkpt = +m[1];
    else if ((m = /^siesta: k-cutoff \(effective\) =\s*(\S+)/.exec(l))) c.kcut = num(m[1]);
    else if ((m = /^MD\.MaxForceTol|maximum force tolerance/i.exec(l))) { const t = /([\d.]+)\s*eV/.exec(l); if (t) c.forceTol = num(t[1]); }
  }
  return c;
}

/* ───────────────────────── Anotación de líneas ───────────────────────── */
// k: 'key' (idea central) | 'info' | 'ok' | 'warn' | 'bad'
const R = (re, h, k = 'info') => ({ re, h, k });
const RULES = [
  // — Errores y avisos explícitos
  R(/ghost/i, () => 'Aviso de estado fantasma (<em>ghost</em>): un proyector de Kleinman–Bylander mal condicionado crea un estado espurio. Cambia el pseudopotencial o PS.KBprojectors; no uses esta corrida.', 'bad'),
  R(/^\s*(SCF cycle did NOT converge|siesta: SCF did not converge|SCF_NOT_CONV)/i, () => 'El SCF <b>no convergió</b>. Ninguna energía, fuerza ni estructura de este paso es confiable. Prueba menos mezcla (SCF.Mixer.Weight), más historial, más smearing en un metal, o mejores condiciones iniciales (DM.InitSpin).', 'bad'),
  R(/^(Error|FATAL|ERROR|STOP)\b|^\s*\*{3}\s*(error|stop)/i, () => 'Error fatal: SIESTA se detuvo con este mensaje. Es la última pista antes de «sin Job completed».', 'bad'),
  R(/^WARNING|^warning:|^\s*Warning:/, (m, c, l) => /BASIS_ENTHALPY/.test(l) ? 'Aviso inocuo: los archivos BASIS_ENTHALPY están obsoletos; se reemplazan por <code>Label.BASIS_ENTHALPY</code>.' : 'Aviso de SIESTA. Léelo completo: unos son informativos y otros señalan un problema real de entrada.', 'warn'),
  // — Encabezado
  R(/^Version\s*:/, (m, c, l) => 'Versión de SIESTA. Cítala siempre (' + l.split(':')[1].trim() + '). La v5 cambió los valores por defecto de la base.', 'key'),
  R(/^Executable\s*:/, () => 'Ruta del ejecutable que corrió.'),
  R(/^Architecture\s*:/, () => 'Arquitectura donde se compiló.'),
  R(/^Compiler (version|flags)/, () => 'Compilador y banderas de compilación. Cambian los últimos dígitos de los resultados entre binarios.'),
  R(/^Parallelisations\s*:/, (m, c, l) => /none/i.test(l) ? 'Sin paralelización compilada (ni MPI ni OpenMP): corre en serie.' : 'Paralelizaciones compiladas (MPI/OpenMP).'),
  R(/^(NetCDF|NetCDF-4) support/, () => 'Compilado con NetCDF: permite escribir <code>.nc</code> y SaveData.'),
  R(/^Lua support/, () => 'Compilado con Lua: permite un script que controle el SCF y la geometría (sección 5).'),
  R(/^DFT-D3 support/, () => 'Compilado con DFT-D3: permite la corrección de dispersión.'),
  R(/^Runtime information/, () => 'Información del entorno de ejecución.'),
  R(/^\* Directory/, () => 'Carpeta de trabajo donde corrió SIESTA.'),
  R(/^\* Running (in serial mode|on\s+\d+ nodes?|in parallel)/, (m, c, l) => /serial/.test(l) ? 'Corrida en serie (un proceso MPI). Puede usar OpenMP si el binario lo soporta.' : 'Corrida con MPI: el número es la cantidad de procesos.', 'key'),
  R(/^>> Start of run/, () => 'Hora de inicio; con «End of run» da el tiempo total.'),
  R(/WELCOME TO SIESTA/, () => 'Banner de arranque.'),
  R(/^ NOTE: Siesta V5 introduces some new defaults/, () => 'En la v5 cambió la generación de la base por defecto: energías de corridas de la v4 pueden diferir ligeramente aunque el fdf sea el mismo.'),
  R(/^ NOTE:/, () => 'Nota del programa sobre defaults o compatibilidad.'),
  // — fdf
  R(/^reinit: Reading from (file|standard input)/, (m, c, l) => 'Archivo de entrada leído: ' + l.replace('reinit: Reading from ', '') + '. Si dice «standard input», el fdf se dio por redirección.', 'key'),
  R(/^reinit: System Name/, () => 'SystemName del fdf (descriptivo, puede estar vacío).'),
  R(/^reinit: System Label:\s*(\S*)/, (m) => 'SystemLabel «' + m[1] + '»: prefijo de todos los archivos que SIESTA escribe (' + m[1] + '.EIG, .DM, .XV…). Dos corridas con el mismo label en la misma carpeta se pisan.', 'key'),
  R(/^NOTE on units for spin output/, () => '{S} es el momento magnético de espín en magnetones de Bohr con g = 2; numéricamente es la diferencia de electrones ↑ − ↓.'),
  R(/Dump of input data file/, () => 'Eco del fdf tal como SIESTA lo leyó (comentarios quitados).'),
  // — pseudopotencial
  R(/^initatom: Reading input/, () => 'Comienza la lectura de pseudopotenciales y la generación de la base, especie por especie.'),
  R(/^Species number:\s*(\d+)\s+Atomic number:\s*(\d+)\s+Label:\s*(\S+)/, (m) => 'Especie ' + m[1] + ': Z = ' + m[2] + ', etiqueta «' + m[3] + '». Debe coincidir con ChemicalSpeciesLabel.', 'key'),
  R(/^Ground state valence configuration/, () => 'Configuración de valencia del átomo libre según las tablas internas, para dimensionar la base.'),
  R(/^Reading pseudopotential information in (\w+)/, (m) => 'Formato del pseudopotencial: ' + m[1] + '. PSML guarda la información completa (funcional, radios, semicore); psf es el formato clásico.'),
  R(/^PSML file version/, () => 'Versión del estándar PSML del archivo.'),
  R(/^Using libxc ids:\s*(.+)/, (m) => 'Identificadores de libxc para intercambio y correlación (' + m[1].trim() + '): 101 = GGA_X_PBE, 130 = GGA_C_PBE. SIESTA toma el funcional del pseudo.'),
  R(/^GGA--PBE|^LDA--|^[A-Z]{3}--/, () => 'Resumen del funcional con el que se generó el pseudo.'),
  R(/^Semicore shell\(s\) with\s+(\d+) electrons/, (m, c, l) => 'Capas de semicore incluidas en la valencia (' + m[1] + ' electrones). Mejoran la transferibilidad a costa de más electrones y de un rc más pequeño.', 'key'),
  R(/^PSML uuid/, () => 'Identificador único del archivo PSML.'),
  R(/^---- Pseudopotential check/, () => 'Verificación del pseudopotencial: capas pseudizadas y configuración de valencia usada al generarlo.'),
  R(/^Pseudized shells/, () => 'Capas que el pseudopotencial describe, con su ocupación y su radio de corte rc (Bohr).'),
  R(/^\d[spdfg]\(\s*[\d.]+\)\s+rc:\s*([\d.]+)/, (m) => 'Capa pseudizada con (ocupación) y radio de corte rc = ' + m[1] + ' Bohr. Más pequeño = pseudo más duro.'),
  R(/^Valence configuration for ps generation/, () => 'Configuración con la que se generó el pseudo y carga de valencia total.'),
  R(/^Fallback to non-perturbative polarization/, () => 'No se pudo polarizar con el método perturbativo; se usa un orbital de polarización no perturbativo. Es lo esperado cuando el pseudo no tiene el canal l+1.'),
  R(/lmxkb/, () => 'Momento angular máximo de los proyectores KB (lmxkb). Si el pseudo trae menos canales que los que SIESTA querría, se recorta.'),
  R(/^Processing specs for species/, () => 'Procesando las especificaciones de la especie.'),
  // — base
  R(/^<basis_specs>/, () => 'Resumen de la base solicitada por especie.', 'key'),
  R(/^=+$/, () => null),
  R(/^(\w+)\s+Z=\s*(\d+)\s+Mass=\s*([\d.]+)/, (m) => 'Especie ' + m[1] + ': Z = ' + m[2] + ', masa ' + m[3] + ' uma (se usa solo en dinámica).'),
  R(/Lmxo=\s*(\d+)\s+Lmxkb=\s*(\d+)\s+BasisType=(\w+)\s+Semic=(\w)/, (m) => 'Lmxo = ' + m[1] + ': momento angular máximo de la base (sin polarización). Lmxkb = ' + m[2] + ' para los proyectores KB. BasisType ' + m[3] + ': ζ adicionales por «split norm». Semic = ' + m[4] + (m[4] === 'T' ? ': hay semicore.' : '.'), 'key'),
  R(/^L=\s*(\d+)\s+Nsemic=\s*(\d+)\s+Cnfigmx=\s*(\d+)/, (m) => 'Canal l = ' + m[1] + ': ' + m[2] + ' capa(s) de semicore; la capa de valencia más alta tiene n = ' + m[3] + '.'),
  R(/^\s*i=\s*\d+\s+nzeta=\s*(\d+)\s+polorb=\s*(\d+)\s+\((\w+)\)/, (m, c, l) => 'Capa ' + m[3] + ': ' + m[1] + ' función(es) ζ' + (+m[2] ? ' y ' + m[2] + ' orbital(es) de polarización' : '') + (/semicore/.test(l) ? '; es de semicore.' : '.')),
  R(/^Using PAO\./, (m, c, l) => 'Opción de generación de PAO activa (' + l.trim() + ').'),
  R(/^atom: Called for/, (m, c, l) => 'Se resuelve el átomo aislado ' + l.replace('atom: Called for', '').trim() + ' con el pseudopotencial para obtener los orbitales.'),
  R(/^Maximum radius \(at nrval\)/, () => 'Radio máximo de la malla radial del átomo (Bohr).'),
  R(/^read_vps: Pseudopotential generation method/, () => 'Código con el que se generó el pseudopotencial.'),
  R(/^read_vps: (\S.*)/, () => 'Método de generación (ONCVPSP, ATOM, etc.).'),
  R(/^Valence charge in pseudo generation/, () => 'Electrones de valencia del pseudo; SIESTA los suma para el conteo total.'),
  R(/^xc_check: Exchange-correlation/, () => 'Funcional de intercambio-correlación del pseudo.'),
  R(/^xc_check: (.+)/, (m) => 'Funcional detectado: ' + m[1].trim() + '. Debe coincidir con XC.functional y XC.authors; mezclar funcionales es una causa clásica de error.', 'key'),
  R(/^Got Vlocal/, () => 'El potencial local viene del archivo PSML.'),
  R(/^Choosing vlocal chloc cutoff:\s*([\d.]+)/, (m) => 'Radio (Bohr) donde se separa la parte local de largo alcance del pseudo: ' + m[1] + '.'),
  R(/^\s*l=\s*(\d+)\s+rc=\s*([\d.]+)\s+Ekb=\s*(-?[\d.]+)/, (m) => 'Proyector KB l = ' + m[1] + ': rc = ' + m[2] + ' Bohr, E_KB = ' + m[3] + ' Ry. E_KB mide la intensidad del canal no local; un valor muy pequeño o de signo inesperado puede delatar un ghost, que SIESTA avisaría con un mensaje explícito.'),
  R(/^atom: Selected multiple-zeta basis/, () => 'Tipo de base múltiple-ζ seleccionada para generar los orbitales.'),
  R(/^SPLIT: PAO cut-off radius determined from an/, () => 'El radio de corte de los PAO se fija con el desplazamiento de energía (PAO.EnergyShift): el orbital se confina hasta que su energía sube esa cantidad.'),
  R(/^SPLIT: energy shift=\s*([\d.]+) Ry/, (m) => 'EnergyShift = ' + m[1] + ' Ry = ' + f(num(m[1]) * 13605.693, 0) + ' meV (PAO.EnergyShift). Menor desplazamiento → orbitales más largos y energías más bajas (sección 4).', 'key'),
  R(/^SPLIT: Basis orbitals for state (\w+)/, (m) => 'Orbitales generados para el estado ' + m[1] + '.'),
  R(/^SPLIT: Non-perturbative polarization orbs for state (\w+)/, (m) => 'Orbitales de polarización de ' + m[1] + ' (con l+1), calculados resolviendo el átomo en un campo eléctrico finito.'),
  R(/^SPLIT: Orbitals with angular momentum L=\s*(\d+)/, (m) => 'Orbitales con l = ' + m[1] + '.'),
  R(/^\s+izeta\s*=\s*(\d+)/, (m) => 'ζ número ' + m[1] + ': una función radial distinta para el mismo orbital (más ζ = más flexibilidad radial).'),
  R(/^\s+energy\s*=\s*(-?[\d.]+)/, (m) => 'Eigenvalor del orbital (Ry).'),
  R(/^\s+rmatch\s*=\s*([\d.]+)/, (m) => 'rmatch = ' + m[1] + ' Bohr: radio donde la 2.ª ζ (split) se hace igual a la 1.ª; hacia dentro es una parábola.'),
  R(/^\s+kinetic\s*=/, () => 'Energía cinética del orbital (Ry); si es muy grande, la malla (MeshCutoff) debe ser más fina.'),
  R(/^\s+potential\((ionic|screened)\)\s*=/, () => 'Valor del potencial en el radio de corte (Ry); sirve de control del confinamiento.'),
  R(/^\s+rc\s*=\s*([\d.]+)/, (m) => 'Radio de corte rc = ' + m[1] + ' Bohr de la primera ζ (' + f(num(m[1]) * 0.529177, 2) + ' Å).', 'key'),
  R(/^\s+splitnorm\s*=/, () => 'Fracción de la norma que debe quedar dentro de rmatch al desdoblar (PAO.SplitNorm).'),
  R(/^\s+lambda\s*=/, () => 'Factor de escala de la ζ de desdoblamiento (1.0 = sin escalar).'),
  R(/^Split based on tail norm/, () => 'Desdoblamiento por la norma de la cola (PAO.SplitTailNorm): el rmatch se elige por la norma de la cola.'),
  R(/^atom: _{10,}/, () => null),
  R(/^%block ChemicalSpeciesLabel/, () => 'Eco del bloque ChemicalSpeciesLabel como lo vio SIESTA.'),
  R(/# Species label, number of l-shells/, () => 'Especie y número de capas (l) de la base; debajo, el radio de corte de cada ζ en Bohr y los factores de escala.'),
  R(/# n, l, Nzeta/, () => 'Capa: número cuántico principal n, momento angular l, número de ζ.'),
  R(/^prinput: Basis input/, () => 'Eco de la base como bloque PAO.Basis completo; sirve para reproducirla exactamente.'),
  // — geometría
  R(/^coor:\s+Atomic-coordinates input format\s*=\s*(\w+)/, (m) => 'Formato de las coordenadas del fdf: ' + m[1] + '. SIESTA las convierte a Bohr para trabajar.'),
  R(/^siesta: Atomic coordinates \(Bohr\) and species/, () => 'Posiciones atómicas en Bohr (1 Bohr = 0.529177 Å), índice de especie y número de átomo.', 'key'),
  R(/^siesta:\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(\d+)\s+(\d+)\s*$/, (m) => 'Átomo ' + m[5] + ' (especie ' + m[4] + '): (' + f(num(m[1]) * 0.529177, 3) + ', ' + f(num(m[2]) * 0.529177, 3) + ', ' + f(num(m[3]) * 0.529177, 3) + ') Å cartesianos.'),
  R(/^siesta: System type =/, (m, c, l) => 'Tipo de sistema declarado (' + l.split('=')[1].trim() + '): bulk, slab, chain o molecule. Afecta a los dipolos y a ciertas correcciones.'),
  R(/^initatomlists: Number of atoms, orbitals, and projectors:\s*(\d+)\s+(\d+)\s+(\d+)/, (m) => m[1] + ' átomo(s), ' + m[2] + ' orbitales (' + f(+m[2] / +m[1], 1) + ' por átomo) y ' + m[3] + ' proyectores KB. Número de orbitales = dimensión del problema de Kohn–Sham por k y espín.', 'key'),
  R(/^siesta: \*+ Simulation parameters/, () => 'Comienza la lista de parámetros efectivos.'),
  R(/^siesta: (The following are some|A complete list of the parameters|can be found in file)/, () => 'La lista completa de parámetros, con defaults, se escribe en <code>out.fdf</code>.'),
  // — redata y mezcladores
  R(/^redata: \*{10,}/, () => null),
  R(/^redata:\s*(.+?)\s*(=.*)?$/, (m, c, l) => { const label = m[1]; for (const [re, h] of REDATA) if (re.test(label)) return h; return 'Parámetro efectivo leído por redata (con default aplicado).'; }),
  R(/^%block SCF\.Mixers?/, () => 'Eco del bloque de mezcladores del SCF.'),
  R(/^%block SCF\.Mixer\.(\w+)/, (m) => 'Opciones del mezclador «' + m[1] + '».'),
  R(/^\s+method\s+(\w+)/, (m) => 'Método de mezcla: ' + m[1] + ' (linear, pulay, broyden). Pulay y Broyden aceleran el SCF usando las iteraciones previas.', 'key'),
  R(/^\s+variant\s+(\w+)/, (m) => 'Variante del método (' + m[1] + '): «stable» regulariza el sistema de Pulay.'),
  R(/^\s+weight\s+([\d.]+)/, (m) => 'Peso de mezcla = ' + m[1] + ': fracción de la nueva salida que entra en la entrada. Menor es más estable y más lento.', 'key'),
  R(/^\s+weight\.linear\s+/, () => 'Peso usado en la parte lineal de la mezcla.'),
  R(/^\s+history\s+(\d+)/, (m) => 'Historial de ' + m[1] + ' iteraciones para el ajuste de Pulay. Más historial = más memoria y mayor riesgo de mal condicionamiento.'),
  R(/^DM_history_depth/, () => 'Profundidad del historial de la DM para extrapolar entre pasos geométricos. 1 = sin extrapolación (por defecto en relajaciones).'),
  R(/^Size of DM history Fstack/, () => 'Tamaño de la pila de historial de la DM.'),
  // — electrones y k
  R(/^Total number of electrons:\s*(-?[\d.]+)/, (m) => 'Electrones de valencia en la celda: ' + f(num(m[1]), 3) + '. Es Σ(valencia de cada pseudo) − NetCharge.', 'key'),
  R(/^Total ionic charge:\s*(-?[\d.]+)/, (m, c, l) => 'Carga iónica total: ' + f(num(m[1]), 3) + '. Igual al número de electrones en un sistema neutro.'),
  R(/^k-point displ\. along\s*(\d)\s+input, could be:\s*(.+)/, (m) => 'Desplazamientos del origen de la malla k a lo largo de b' + m[1] + ' que mantienen la simetría: ' + m[2].trim() + '. 0 incluye Γ.'),
  R(/^\s*Kpoints in:\s*(\d+)\s*\.\s*Kpoints trimmed:\s*(\d+)/, (m) => 'Puntos k generados: ' + m[1] + '; después de recortar (trimmed) los equivalentes por simetría: ' + m[2] + '. Esos ' + m[2] + ' puntos son los que SIESTA diagonaliza en cada iteración (multiplicados por el número de espines).', 'key'),
  R(/^siesta: k-grid: Number of k-points =\s*(\d+)/, (m) => 'Total de puntos k usados: ' + m[1] + '.', 'key'),
  R(/^siesta: k-points from Monkhorst-Pack grid/, () => 'Origen de los puntos k: malla Monkhorst–Pack (la otra opción es una lista explícita).'),
  R(/^siesta: k-cutoff \(effective\) =\s*(\S+)/, (m) => 'Corte equivalente de la malla k: ' + m[1] + ' Å. Para una malla n×n×n y celda cúbica de lado L es ≈ n·L/2 (aquí 16·2.482/2 ≈ 19.86). Cuanto mayor, más densa la malla.', 'key'),
  R(/^siesta: k-grid:\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?[\d.]+)/, (m) => 'Fila de la matriz entera de la malla k (n₁ n₂ n₃) y desplazamiento ' + m[4] + ' sobre el eje correspondiente.'),
  R(/^diag: Algorithm\s*=\s*(\S+)/, (m) => 'Algoritmo de diagonalización: ' + m[1] + ' (D&C = divide y vencerás; también Divide, Expert, MRRR, 2stage).'),
  R(/^diag: Used triangular part/, () => 'Parte triangular de H y S que se pasa al diagonalizador.'),
  R(/^diag: Absolute tolerance/, () => 'Tolerancia absoluta de los eigenvalores (solo algoritmos «Expert»).'),
  R(/^diag: Orthogonalization factor/, () => 'Umbral de reortogonalización de eigenvectores cercanos.'),
  R(/^diag: Memory factor/, () => 'Factor de memoria extra para el diagonalizador.'),
  R(/^superc: Internal auxiliary supercell:\s*(\d+) x\s+(\d+) x\s+(\d+)\s*=\s*(\d+)/, (m) => 'Supercelda auxiliar de ' + m[1] + '×' + m[2] + '×' + m[3] + ' = ' + m[4] + ' celdas: la que hace falta para que los orbitales y proyectores de una celda alcancen a todos sus vecinos. Crece con el alcance (rc) de los orbitales y con celdas chicas.'),
  R(/^superc: Number of atoms, orbitals, and projectors:\s*(\d+)\s+(\d+)\s+(\d+)/, (m) => 'Átomos, orbitales y proyectores contenidos en la supercelda auxiliar (' + m[1] + ' = celdas × átomos).'),
  R(/^ts: /, () => 'Opciones de TranSIESTA (transporte) que no se usan en este cálculo.'),
  R(/TS CHECKS AND WARNINGS/, () => 'Comprobaciones de TranSIESTA; vacías si no es una corrida de transporte.'),
  R(/^\s+(splnorm|vcte|rinn|qcoe|qyuk|qwid|rcs|lambdas):\s*(.*)/, (m) => ({ splnorm: 'splnorm: PAO.SplitNorm, fracción de la norma que debe quedar dentro de rmatch al desdoblar.', vcte: 'vcte: altura V₀ (Ry) del potencial de confinamiento suave que cierra el orbital en rc.', rinn: 'rinn: radio interno del confinamiento suave; negativo = fracción de rc (−0.9 = 0.9·rc).', qcoe: 'qcoe: coeficiente del confinamiento de carga (0 = no se usa).', qyuk: 'qyuk: parámetro de Yukawa del confinamiento de carga (0 = no se usa).', qwid: 'qwid: ancho del confinamiento de carga.', rcs: 'rcs: radios de corte pedidos por ζ en Bohr; 0 = que los fije PAO.EnergyShift.', lambdas: 'lambdas: factor de escala de cada ζ (1 = sin escalar).' })[m[1]]),
  R(/^L=\s*(\d+)\s+Nkbl=\s*(\d+)/, (m) => 'Canal l = ' + m[1] + ': ' + m[2] + ' proyector(es) KB por canal.'),
  R(/^PSML: Total number of\s+Kleinman-Bylander projectors:\s*(\d+)/, (m) => 'Proyectores KB totales de la especie (contando los 2l+1 de cada l): ' + m[1] + '.'),
  R(/^PSML: Kleinman-Bylander projectors|^Reading KB projs|^Using scalar-relativistic/, () => 'Se leen los proyectores no locales del archivo PSML.'),
  R(/^qtot up to nchloc/, () => 'Carga de valencia contenida dentro del radio de la parte local; debe ser ≈ la de valencia.'),
  R(/^atom: Maximum radius for/, () => 'Radio máximo (Bohr) hasta donde se integra la parte local.'),
  R(/^atom: SANKEY-TYPE ORBITALS/, () => 'Orbitales numéricos tipo Sankey–Niklewski generados a continuación.'),
  R(/^SPLIT: rc\(1st zeta\) \(re\)set to:\s*([\d.]+)/, (m) => 'El rc de la primera ζ se ajustó a ' + m[1] + ' Bohr para que el orbital de polarización y los demás compartan radio.'),
  R(/^atom: Total number of Sankey-type orbitals:\s*(\d+)/, (m) => 'Orbitales por átomo de esta especie: ' + m[1] + ' (contando los 2l+1 de cada l). Es la dimensión de la base por átomo.', 'key'),
  R(/^atm_pop:/, () => 'Configuración con la que se calcula el potencial de átomo neutro (Vna).'),
  R(/^Vna: chval, zval:/, () => 'Carga de valencia y carga del núcleo apantallada.'),
  R(/^Vna:\s+Cut-off radius/, (m, c, l) => 'Radio de corte de V_NA (Bohr): ' + l.split(':')[1].trim() + '.'),
  R(/^\s*%block PAO\.Basis/, () => 'Eco de la base completa como bloque PAO.Basis: por especie, las capas, el rc de cada ζ y los factores de escala. Copiarlo al fdf reproduce la base.'),
  R(/^# WARNING: This information might be incomplete/, () => 'Aviso del eco: si usaste parámetros avanzados de la base, el bloque no los recoge todos.'),
  R(/Species index, atomic number, species label/, () => 'Índice, número atómico y etiqueta de la especie.'),
  R(/^Dumping basis to NetCDF file/, () => 'Se guarda la base en un archivo <code>.ion.nc</code> (formato NetCDF) que otras herramientas pueden leer.'),
  R(/^PAO\.BasisType/, (m, c, l) => 'Tipo de base: ' + l.trim().split(/\s+/)[1] + '.'),
  R(/^mix\.SCF:/, () => 'Resumen del mezclador del SCF con los valores efectivos.'),
  R(/^siesta: k-point supercell and displacements/, () => 'Matriz entera de la malla k y desplazamiento, en filas.'),
  R(/^\s+<(sparsity|dData)/, () => null),
  R(/^<dSpData2D:DM/, () => 'Matriz de densidad (DM) inicializada con datos atómicos.'),
  R(/^cite: which we encourage/, () => 'Se recomienda citar estos trabajos.'),
  // — paso: celda y malla
  R(/^\s+(Single-point calculation)\s*$/, () => 'Tipo de paso: punto único. Un SCF y se acabó; en una relajación verás «Begin CG opt. move» (u otro) repetido.', 'key'),
  R(/^\s+Begin\s+(.+?)\s*=?\s*(\d+)?\s*$/, (m, c, l) => 'Inicio de un paso de la dinámica: «' + l.trim() + '». Cada uno contiene su propio SCF, fuerzas y estrés.', 'key'),
  R(/^outcell: Unit cell vectors \(Ang\)/, () => 'Vectores de la celda en Å, filas = a₁, a₂, a₃.', 'key'),
  R(/^\s+-?\d+\.\d+\s+-?\d+\.\d+\s+-?\d+\.\d+\s*$/, () => null),
  R(/^outcell: Cell vector modules/, () => 'Longitudes |a₁|, |a₂|, |a₃| en Å.'),
  R(/^outcell: Cell angles/, () => 'Ángulos α(a₂,a₃), β(a₁,a₃), γ(a₁,a₂) en grados.'),
  R(/^outcell: Cell volume/, () => 'Volumen de la celda en Å³: el que se usa para convertir estrés y presión.'),
  R(/^<dSpData1D:S/, () => 'Matriz de solapes S (dispersa). «sparsity» es el porcentaje de elementos no nulos (cuanto menor, más dispersa y más barata).'),
  R(/sparsity=([\d.]+)\s+nnzs=(\d+)/, (m) => 'Densidad de la matriz: ' + m[1] + ' % de elementos no nulos (' + m[2] + ' en total). Celdas chicas y orbitales largos dan matrices casi llenas; en sistemas grandes baja a pocos %.'),
  R(/^new_DM -- step:\s*(\d+)/, (m) => 'Se prepara la matriz de densidad (DM) para el paso ' + m[1] + '.'),
  R(/^Initializing Density Matrix/, () => 'Inicialización de la DM.'),
  R(/^Attempting to read DM from file\.\.\.\s*(\w+)/, (m) => m[1] === 'Failed' ? 'No hay <code>.DM</code> previo (o DM.UseSaveDM F): se empieza desde átomos neutros superpuestos. Normal en la primera corrida.' : 'Se leyó un <code>.DM</code> previo: el SCF suele ser mucho más corto. Cuidado: si cambiaste el fdf, esa DM puede no corresponder.', 'key'),
  R(/^DM filled with atomic data/, (m, c, l) => 'La DM inicial se llena con la densidad de átomos libres' + (/user-defined/.test(l) ? ' con el espín inicial definido por el usuario (DM.InitSpin).' : '.'), 'key'),
  R(/^No\. of atoms with KB's overlaping/, () => 'Máximo de átomos cuyos proyectores KB se solapan con un orbital dado (por proceso).'),
  R(/^InitMesh: MESH =\s*(\d+) x\s+(\d+) x\s+(\d+)\s*=\s*(\d+)/, (m) => 'Puntos de la malla de espacio real: ' + m[1] + '×' + m[2] + '×' + m[3] + ' = ' + m[4] + '. SIESTA los elige compatibles con la FFT.', 'key'),
  R(/^InitMesh: Mesh cutoff \(required, used\)/, (m, c) => 'MeshCutoff pedido ' + g(c.meshReq) + ' Ry y usado ' + g(c.meshUsed) + ' Ry. El usado siempre es ≥ pedido (la malla es de enteros compatibles con la FFT); si la diferencia es grande, la malla es más fina que lo pedido.', 'key'),
  R(/^New grid distribution/, () => 'Cómo se reparte la malla entre procesos MPI.'),
  R(/^stepf: (.+)/, (m) => 'Función de ocupación: ' + m[1] + '. Define el smearing con el que se llenan los estados cerca de E_F.'),
  R(/^\s+Using Hermite-Gauss polynomials of order\s*(\d+)/, (m) => 'Orden ' + m[1] + ' de Methfessel–Paxton. Orden 0 = Gauss; mayor orden reduce el error del smearing pero la energía no es variacional.'),
  R(/^siesta: FreeEng\s*=/, () => 'Energía libre de la densidad inicial; la primera línea «scf:» la mejora.'),
  // — energía
  R(/^siesta: Program's energy decomposition/, (m, c, l) => 'Descomposición de la energía por términos. La de aquí, antes del SCF, se calcula con la densidad inicial; la del final, con la convergida.', 'key'),
  R(/^siesta:\s+(Ebs|Eions|Ena|Ekin|Enl|Eso|Edftu|DEna|DUscf|DUext|Ex|Ec|Exc|EbV|eta\*DQ|Emadel|Emeta|Emolmec|Ekinion|Eharris|Etot|FreeEng)\s*=\s*(-?[\d.]+)/, (m) => '<b>' + m[1] + '</b> = ' + f(num(m[2]), 6) + ' eV. ' + ED[m[1]], 'info'),
  R(/^siesta: Final energy \(eV\)/, () => 'Desglose de la energía total en la partición usual: cinética + Hartree + XC + ion–electrón + ion–ion. Es la forma común de leer la energía.', 'key'),
  R(/^siesta:\s+(Band Struct\.|Kinetic|Hartree|Edftu|Eso|Ext\. field|Exch\.|Corr\.|Bulk bias|Exch\.-corr\.|Ion-electron|Ion-ion|Ekinion|D3 dispersion|Total|Fermi)\s*=\s*(-?[\d.]+)/, (m) => '<b>' + m[1] + '</b> = ' + f(num(m[2]), 6) + ' eV. ' + FE[m[1]]),
  R(/^siesta: Fermi energy =\s*(-?[\d.]+)/, (m) => 'Energía de Fermi E_F = ' + m[1] + ' eV, en la misma escala que los eigenvalores. Es la referencia para bandas, PDOS y función de trabajo (E_vac − E_F).', 'key'),
  // — SCF
  R(/^\s+iscf\s+Eharris/, () => '<b>Cabecera del SCF.</b> <code>iscf</code>: iteración. <code>Eharris</code>: energía de Harris (con la densidad de entrada). <code>E_KS</code>: energía de Kohn–Sham (con la de salida). <code>FreeEng</code>: energía libre (−TS incluido). <code>dDmax</code>: máximo cambio de la DM. <code>Ef</code>: energía de Fermi. <code>dHmax</code>: máximo cambio de H (eV).', 'key'),
  R(/^\s+scf:\s+(\d+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.Ee+-]+)\s+(-?[\d.]+)\s+([\d.Ee+-]+)/, (m, c) => {
    const dD = num(m[5]), dH = num(m[7]); const okD = c.tolDM != null ? dD < c.tolDM : null, okH = c.tolH != null ? dH < c.tolH : null;
    const st = v => v === null ? '' : v ? ' <span class="ok">✓ bajo la tolerancia</span>' : ' <span class="warn">✗ sobre la tolerancia</span>';
    return 'Iteración ' + m[1] + '. E_KS − E_harris = ' + f(num(m[3]) - num(m[2]), 6) + ' eV (se acerca a 0 al converger). dDmax = ' + g(dD) + (c.tolDM != null ? ' (tol ' + g(c.tolDM) + ')' : '') + st(okD) + '; dHmax = ' + g(dH) + ' eV' + (c.tolH != null ? ' (tol ' + g(c.tolH) + ')' : '') + st(okH) + '. E_F = ' + m[6] + ' eV.';
  }),
  R(/^\s+spin moment: \{S\} , \|S\| = \{\s*(\S+)\s+(\S+)\s+(\S+)\s*\}\s+(\S+)/, (m) => 'Momento de espín de esta iteración: S = (' + m[1] + ', ' + m[2] + ', ' + m[3] + ') μ_B y |S| = ' + m[4] + '. Debe estabilizarse junto con dDmax; si oscila, el SCF no se decide por un estado magnético.'),
  R(/^timer: Routine,Calls,Time,% = IterSCF\s+1\s+(\S+)\s+(\S+)/, (m) => 'Tiempo de la primera iteración (' + m[1] + ' s, ' + m[2] + ' % del total hasta ahora). Es la más cara porque incluye el armado inicial; las siguientes son más baratas.'),
  R(/^SCF Convergence by (.+)/, (m) => 'Criterio con el que se declaró la convergencia: ' + m[1] + ' (DM y/o H; el que pidas con SCF.DM.Converge y SCF.H.Converge).', 'key'),
  R(/^max \|DM_out - DM_in\|\s*:\s*(\S+)/, (m, c) => 'Valor final de dDmax = ' + m[1] + (c.tolDM != null ? ' (tolerancia ' + g(c.tolDM) + ')' : '') + '. Se compara con SCF.DM.Tolerance.'),
  R(/^max \|H_out - H_in\|\s*\(eV\)\s*:\s*(\S+)/, (m, c) => 'Valor final de dHmax = ' + m[1] + ' eV' + (c.tolH != null ? ' (tolerancia ' + g(c.tolH) + ' eV)' : '') + '.'),
  R(/^SCF cycle converged after\s+(\d+) iterations/, (m, c) => 'El SCF <b>convergió</b> en ' + m[1] + ' iteraciones' + (c.maxScf ? ' (máximo permitido ' + c.maxScf + ')' : '') + '. Más de ~40–50 iteraciones en un sistema sencillo es una señal de mezcla o smearing mal elegidos.', 'ok'),
  R(/^Using DM_out to compute the final energy and forces/, () => 'Para la energía y las fuerzas finales usa la DM de salida (más cercana a la solución) y no la de entrada.'),
  // — fuerzas, estrés
  R(/^siesta: E_KS\(eV\) =\s*(-?[\d.]+)/, (m) => 'Energía de Kohn–Sham de este paso: ' + m[1] + ' eV. Es el número que compara entre corridas (misma base, mallas y pseudos).', 'key'),
  R(/^siesta: E_KS - E_eggbox =\s*(-?[\d.]+)/, (m, c, l) => 'Energía menos el efecto egg-box (' + m[1] + ' eV). El egg-box es una oscilación espuria de la energía al desplazar un átomo respecto a la malla; se apaga subiendo MeshCutoff. Si E_KS y este valor difieren, la malla no es suficiente.'),
  R(/^siesta: Atomic forces \(eV\/Ang\)/, () => 'Fuerzas atómicas en eV/Å: Hellmann–Feynman más corrección de Pulay. Con los átomos en posiciones de simetría son 0 por construcción.', 'key'),
  R(/^\s+Tot\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/, (m) => 'Suma de las fuerzas: (' + m[1] + ', ' + m[2] + ', ' + m[3] + '). Debe ser ≈ 0 (translación libre); una suma grande indica ruido de la malla (efecto egg-box).'),
  R(/^\s+Max\s+(-?[\d.]+)\s+constrained/, () => 'Fuerza máxima entre los grados de libertad que sí pueden moverse.'),
  R(/^\s+Max\s+(-?[\d.]+)\s*$/, (m, c) => 'Fuerza máxima por componente = ' + m[1] + ' eV/Å. En una relajación se compara con MD.MaxForceTol (' + g(c.forceTol) + ' eV/Å por defecto).', 'key'),
  R(/^\s+Res\s+(-?[\d.]+)/, (m) => 'Fuerza residual rms = ' + m[1] + ' eV/Å: sqrt(Σ fᵢ² / 3N).'),
  R(/^\s+\d+\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s*$/, (m, c, l) => { const x = num(m[1]), y = num(m[2]), z = num(m[3]); return 'Fuerza sobre el átomo ' + l.trim().split(/\s+/)[0] + ': (' + f(x, 4) + ', ' + f(y, 4) + ', ' + f(z, 4) + ') eV/Å; |F| = ' + f(Math.hypot(x, y, z), 4) + '.'; }),
  R(/^Stress tensor Voigt/, (m, c, l) => { const v = l.split(':')[1].trim().split(/\s+/).map(num); if (v.length < 6 || v.some(isNaN)) return 'Tensor de estrés en notación de Voigt (kbar).'; const p = -(v[0] + v[1] + v[2]) / 3; return 'Estrés [xx, yy, zz, yz, xz, xy] en kbar. Presión = −traza/3 = ' + f(p, 2) + ' kbar. Convención de SIESTA: estrés positivo = presión negativa = celda mayor que la de equilibrio, que tiende a contraerse.'; }, 'key'),
  R(/^\(Free\)E \+ p\*V/, () => 'Entalpía con la presión objetivo (MD.TargetPressure): E + pV en eV por celda.'),
  R(/^Target enthalpy/, () => 'Entalpía objetivo del paso: la que minimiza una relajación de celda variable.'),
  R(/^siesta: Stress tensor \(static\)/, () => 'Tensor de estrés estático (sin el término cinético de los iones), en eV/Å³ — 3×3 simétrico.', 'key'),
  R(/^siesta:\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s*$/, () => 'Fila del tensor de estrés (eV/Å³).'),
  R(/^siesta: Cell volume =/, (m, c, l) => 'Volumen de la celda (' + l.split('=')[1].trim() + ').'),
  R(/^siesta: Pressure \(static\)/, () => 'Presión estática. Columna «Solid» = presión del sólido; «Molecule» para moléculas aisladas.'),
  R(/^siesta:\s+Solid\s+Molecule\s+Units/, () => 'Encabezado de la tabla de presión.'),
  R(/^siesta:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(Ry\/Bohr\*\*3|kBar|eV\/Ang\*\*3|GPa)/, (m, c, l) => 'Presión ' + (m[1]) + ' ' + m[3] + (m[3] === 'kBar' ? ' (kbar = 0.1 GPa)' : '') + '.'),
  R(/^siesta:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+kBar/, (m) => 'Presión en kbar (1 kbar = 0.1 GPa).'),
  R(/^Basis Enthalpy Calculation/, () => 'Presión de la base: cuánto «aprieta» el confinamiento de los orbitales (Anglada et al., PRB 66, 205101, 2002). Sirve para optimizar el radio de corte.'),
  R(/^\s+Basis Pressure for species\s*(\d+)\((\w+)\)\s*:\s*(\S+)/, (m) => 'Presión de la base de la especie ' + m[1] + ' (' + m[2] + '): ' + m[3] + ' GPa. Una presión alta indica orbitales muy confinados.'),
  R(/^\s+Orbital volume contribution/, () => 'Volumen ocupado por los orbitales.'),
  R(/^\s+\(Free\)E(harris)? \+ p_basis\*V_orbitals/, () => 'Entalpía de la base (E + p_basis·V).'),
  // — poblaciones
  R(/^mulliken: Atomic and Orbital Populations/, () => 'Análisis de población de Mulliken: la carga en cada orbital de cada átomo, repartiendo el solape S_ij a partes iguales entre i y j.', 'key'),
  R(/^mulliken: Spin (UP|DOWN)/, (m) => 'Población de la subred de espín ' + (m[1] === 'UP' ? '↑' : '↓') + '.'),
  R(/^Species:\s*(\w+)/, (m) => 'Átomos de la especie ' + m[1] + '.'),
  R(/^Atom\s+Qatom\s+Qorb/, () => 'Qatom: electrones del átomo. Qorb: electrones de cada orbital de su base, en el orden de la lista (3s, 4s 1.ª ζ, 4s 2.ª ζ, 3p…).'),
  R(/^\s+(?:[1-9]\d*[spdf][a-z0-9-]*\s+)+$/, () => 'Etiquetas de los orbitales de la base: n, l, y la forma real (py, pz, px, dxy…). Cada nombre repetido es una ζ adicional.'),
  R(/^\s+(\d+)\s+(-?\d+\.\d+)\s+(\d+\.\d+)(\s+(-?\d+\.\d+))?\s+(\w+)\s*$/, (m) => 'Átomo ' + m[1] + ' (' + m[6] + '): carga neta ' + m[2] + ' e, población de valencia ' + m[3] + ' e' + (m[5] ? ', momento de espín ' + m[5] + ' μ_B' : '') + '. Los valores de Mulliken dependen mucho de la base; úsalos solo para comparar con la misma base.'),
  R(/^\s+\d+\s+(\d+\.\d+)\s+(-?\d+\.\d+\s+)+/, (m, c, l) => { const parts = l.trim().split(/\s+/); const neg = parts.slice(2).filter(x => +x < 0).length; return 'Átomo ' + parts[0] + ': ' + parts[1] + ' electrones en este canal y población de sus primeros orbitales.' + (neg ? ' ' + neg + ' población(es) negativa(s) en esta fila: es un artefacto de Mulliken con orbitales difusos (el solape se reparte mal), no hay electrones negativos.' : ''); }),
  R(/^mulliken: Qtot =\s*(-?[\d.]+)/, (m) => 'Electrones totales de este canal de espín: ' + m[1] + '. La suma de ↑ y ↓ debe dar el total de electrones.'),
  R(/^Mulliken Atomic Populations/, () => 'Resumen: carga neta por átomo (<code>charge</code> = valencia del átomo libre − población; positivo = el átomo cedió electrones), población de valencia y, si hay espín, <code>Sz</code>.', 'key'),
  R(/^Atom #\s+charge/, () => 'Encabezado de la tabla resumen. «valence [e]» es la población de Mulliken del átomo; «Sz» el momento de espín del átomo en μ_B.'),
  R(/^\s+Total\s+(-?\d+\.\d+)/, () => 'Suma sobre los átomos de la celda.'),
  // — eigenvalores
  R(/^siesta: Eigenvalues \(eV\)/, () => 'Eigenvalores de Kohn–Sham por punto k (ik) y espín (is). Los primeros índices de cada fila son ik e is; los siguientes, las energías en eV (desde la más baja).', 'key'),
  R(/^\s+ik is\s+eps/, () => 'ik: punto k; is: espín; eps: energías en eV.'),
  // — citas y tiempos
  R(/^cite: Please indicate the Siesta version/, () => 'SIESTA pide que se cite la versión exacta.'),
  R(/^cite: This calculation has made use/, () => 'Sigue la lista de artículos que corresponden a las funciones usadas; se genera según el fdf.'),
  R(/^cite: \(Please see/, () => 'El archivo .bib con las referencias en formato BibTeX.'),
  R(/^\s+Primary SIESTA paper|^\s+PSML pseudopotential format/, () => 'Referencia que corresponde citar por la función usada.'),
  R(/^\s+DOI:/, () => 'DOI.'),
  R(/^timer: Elapsed wall time \(sec\)\s*=\s*(\S+)/, (m) => 'Tiempo de reloj total: ' + m[1] + ' s (' + f(num(m[1]) / 60, 1) + ' min). Es el que paga el clúster.', 'key'),
  R(/^timer: CPU execution times/, () => 'Tabla de tiempos por rutina. Una rutina anidada dentro de otra se cuenta también en la suya (los porcentajes no suman 100).'),
  R(/^Routine\s+Calls\s+Time\/call/, () => 'Rutina · número de llamadas · tiempo por llamada · tiempo total · porcentaje del total.'),
  R(/^(\S+)\s+(\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s*$/, (m, c, l) => { const t = TIMERS[m[1]]; return '<b>' + m[1] + '</b>: ' + m[2] + ' llamadas, ' + m[4] + ' s (' + m[5] + ' %).' + (t ? ' ' + t : ''); }),
  R(/^>> End of run/, () => 'Hora de fin de la corrida.'),
  R(/^Job completed/, () => 'SIESTA terminó con normalidad. Si falta, la corrida murió, se cortó por tiempo o por memoria.', 'ok'),
];

// Notas extra de un fdf copiado en el .out
const FDF_ECHO = /^\s*([A-Za-z][\w.\-]*)\s+\S+/;

// Anotaciones de la corrida de ejemplo (Fe bcc FM; solo se agregan cuando se muestra ese archivo)
export const EXAMPLE_NOTES = [
  [/^\s+scf:\s+1\s/, 'En esta corrida: parte de un momento de 2.75 μ_B (DM.InitSpin «+» le da un espín inicial) y dHmax = 10.8 eV. Es normal que la 1.ª iteración esté muy lejos.'],
  [/^\s+scf:\s+23\s/, 'En esta corrida: 23 iteraciones; el momento de espín queda en 2.299 μ_B (sección 11).'],
  [/^SCF cycle converged/, 'En esta corrida: dDmax = 3.4×10⁻⁶ < 10⁻⁵ y dHmax = 1.3×10⁻⁵ eV < 10⁻³ eV; Pulay con peso 0.1 e historial 8, con un solo salto (iteración 18: dDmax pasa de 2.6×10⁻⁵ a 8.3×10⁻⁴) que Pulay absorbe en cinco iteraciones más.'],
  [/^\s*Kpoints in:/, 'En esta corrida: malla 16×16×16 (4096 puntos) en una celda bcc primitiva de 1 átomo. Con 2192 k × 2 espines × 23 iteraciones salen las 100 832 llamadas de «c-eigval» de la tabla de tiempos.'],
  [/^InitMesh: Mesh cutoff/, 'En esta corrida: 300 Ry pedidos, 387.6 Ry usados (malla 24³). El exceso del 29 % se debe a que 24 es el menor número de puntos por eje que cumple 300 Ry en esta celda romboédrica y es compatible con la FFT.'],
  [/^Stress tensor Voigt/, 'En esta corrida: a = 2.866 Å es mayor que el a₀ ferromagnético de la sección 11 (2.834 Å), así que la celda está expandida: estrés +70.4 kbar, presión −70.4 kbar. Los 0.78 kbar fuera de la diagonal son ruido de la malla, ya que por simetría cúbica serían 0.'],
  [/^\s+1\s+9\.150/, 'En esta corrida: la subred ↑ tiene 9.150 e y la ↓ 6.850 e; la diferencia, 2.300, es el momento de espín (2.299 μ_B en el resumen). La 2.ª ζ del 4s sale con −0.286 e: artefacto de Mulliken.'],
  [/^timer: Elapsed wall time/, 'En esta corrida: 143.6 s, una sola CPU. 93 % se va en la diagonalización de 2192 puntos k × 2 espines por iteración: para acelerar hay que reducir los puntos k o paralelizar sobre ellos (MPI con k-point parallelization).'],
  [/^siesta: Fermi energy/, 'En esta corrida: E_F = −4.003 eV. Es una escala interna de SIESTA; el cero no es el vacío (para una función de trabajo se necesita el potencial electrostático, sección 10).'],
  [/^siesta: \[omitted/, 'DFT Lab acortó aquí el archivo original: en la corrida real hay 2192 puntos k × 2 espines de eigenvalores (8 768 líneas). Para analizarlos, usa el .EIG en «Mis archivos de SIESTA».'],
];

export function annotateLines(lines, ctx, opts = {}) {
  const notes = new Array(lines.length).fill(null);
  const ex = opts.example ? EXAMPLE_NOTES : null;
  let inDump = false, inEig = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (/Dump of input data file/.test(l)) inDump = true;
    else if (/End of input data file/.test(l)) inDump = false;
    if (/^siesta: Eigenvalues \(eV\)/.test(l)) inEig = true;
    else if (inEig && /^siesta: Fermi energy|^siesta: Program's energy|^siesta: \[omitted/.test(l)) inEig = false;
    if (inEig && /^\s+\d+\s+\d+\s+-?\d/.test(l)) continue;     // cientos de miles de líneas de eigenvalores
    let note = null;
    for (const r of RULES) {
      const m = r.re.exec(l); if (!m) continue;
      const h = r.h(m, ctx, l);
      if (h === null) { note = false; break; }
      note = { k: r.k, h }; break;
    }
    if (note === false) note = null;
    if (!note && inDump) {
      const m = FDF_ECHO.exec(l);
      if (m) { const k = m[1].toLowerCase().replace(/[-_]/g, ''); const key = Object.keys(FDFKEYS).find(x => x.replace(/[-_.]/g, '') === k.replace(/\./g, '')); note = { k: 'info', h: key ? FDFKEYS[key] : 'Línea del fdf tal como la leyó SIESTA.' }; }
    }
    if (note && ex) for (const [re, t] of ex) if (re.test(l)) { note.x = t; break; }
    if (!note && ex) for (const [re, t] of ex) if (re.test(l)) { note = { k: 'key', h: '', x: t }; break; }
    notes[i] = note;
  }
  return notes;
}

/* ───────────────────────── Diagnóstico ───────────────────────── */
// Cada hallazgo: {block, level:'ok'|'info'|'warn'|'bad', title, detail}
export function diagnose(P, lines, ctx) {
  const out = [];
  const add = (block, level, title, detail) => out.push({ block, level, title, detail });
  const text = lines.join('\n');

  // Fin de corrida
  const done = P.run && P.run.completed || /Job completed/.test(text);
  add('end', done ? 'ok' : 'bad', done ? 'La corrida terminó («Job completed»)' : 'No aparece «Job completed»', done ? 'SIESTA llegó al final sin abortar.' : 'El archivo termina antes del final normal: la corrida murió, se cortó por tiempo o por memoria, o este .out es parcial. Revisa el stderr del gestor de trabajos.');

  // SCF
  const rows = P.scf || [];
  const steps = P.steps || [];
  const notConv = steps.filter(s => s.scfConverged === false).length;
  const conv = /SCF cycle converged/.test(text), failed = /did NOT converge|SCF_NOT_CONV|SCF did not converge/i.test(text);
  if (failed || notConv) add('conv', 'bad', 'El SCF no convergió' + (steps.length > 1 ? ' en ' + notConv + ' paso(s)' : ''), 'Prueba, en este orden: bajar SCF.Mixer.Weight (0.05–0.1), subir SCF.Mixer.History, elegir Pulay o Broyden, aumentar ElectronicTemperature en un metal, dar un DM.InitSpin razonable si hay magnetismo y revisar la geometría (átomos demasiado cerca).');
  else if (conv) {
    const its = steps.map(s => s.scfIterations).filter(Boolean); const mx = Math.max(...its, 0);
    add('conv', mx > 60 ? 'warn' : 'ok', 'SCF convergido' + (its.length ? ' (máx. ' + mx + ' iteraciones por paso)' : ''), mx > 60 ? 'Converge, pero con muchas iteraciones: el mezclador o el smearing no son óptimos. Compara con la sección 5.' : 'Número de iteraciones razonable.');
  } else if (rows.length) add('conv', 'warn', 'No se encontró la línea de convergencia', 'Hay iteraciones del SCF pero ninguna línea «SCF cycle converged». La corrida pudo cortarse a mitad del ciclo.');

  if (rows.length > 3) {
    const dd = rows.map(r => r.dDmax).filter(x => isFinite(x) && x > 0);
    let jumps = 0, worst = 0, at = 0;
    for (let i = 3; i < dd.length; i++) { const r = dd[i] / dd[i - 1]; if (r > 10) { jumps++; if (r > worst) { worst = r; at = i + 1; } } }
    if (jumps) add('scf', 'warn', 'dDmax salta hacia arriba ' + jumps + ' vez/veces', 'El mayor salto, ×' + g(worst) + ', ocurre en la iteración ' + at + '. Un salto aislado tras un tirón de Pulay es normal; varios seguidos indican oscilación (carga o momento magnético).');
    else add('scf', 'ok', 'dDmax baja sin saltos de más de un orden de magnitud', 'Convergencia limpia (desde la iteración 4).');
    const last = rows[rows.length - 1];
    if (ctx.tolDM != null && ctx.reqDM && conv && last.dDmax > ctx.tolDM) add('scf', 'warn', 'La última dDmax (' + g(last.dDmax) + ') queda sobre la tolerancia (' + g(ctx.tolDM) + ')', 'SIESTA declaró convergencia aunque dDmax no bajó; revisa si el criterio de H bastaba o si SCF.DM.Converge está apagado.');
    if (isFinite(last.Eharris) && isFinite(last.E_KS)) { const d = Math.abs(last.E_KS - last.Eharris); add('scf', d < 1e-3 ? 'ok' : 'warn', 'E_KS − E_Harris al final = ' + g(d) + ' eV', d < 1e-3 ? 'Ambas energías coinciden: la densidad de entrada ya es autoconsistente.' : 'Las dos energías todavía difieren: el SCF no está bien afinado; no uses la energía con más precisión que esa diferencia.'); }
    if (last.spinMoment) add('scf', 'info', 'Momento de espín final |S| = ' + f(last.spinMoment.abs, 4) + ' μ_B', 'Debe permanecer estable en las últimas iteraciones; si oscila, el SCF aún no decide el estado magnético.');
  }

  // Parámetros
  if (ctx.tolDM != null) add('params', ctx.tolDM > 1e-3 ? 'warn' : 'info', 'Tolerancias: dDmax < ' + g(ctx.tolDM) + (ctx.tolH != null ? ', dHmax < ' + g(ctx.tolH) + ' eV' : ''), ctx.tolDM > 1e-3 ? 'Tolerancia floja: las fuerzas y el estrés pueden tener ruido; para relajaciones usa 10⁻⁴ o menos.' : 'Valores razonables para energías y para relajaciones.');
  if (ctx.kT != null) add('params', 'info', 'Temperatura electrónica ' + g(ctx.kT) + ' K = ' + g(ctx.kT * 8.617333e-5 * 1000) + ' meV', 'Para un aislante, 25–300 K bastan; un metal necesita smearing mayor (~0.1 eV con Methfessel–Paxton) y mallas k densas.');

  // Base, orbitales, electrones
  if (P.nOrbitals && P.nElectrons) {
    const need = Math.ceil(P.nElectrons / 2);
    add('basis', P.nOrbitals > need ? 'ok' : 'bad', P.nOrbitals + ' orbitales para ' + P.nElectrons + ' electrones', P.nOrbitals > need ? 'Hay al menos ' + need + ' orbitales para los estados ocupados, más ' + (P.nOrbitals - need) + ' vacíos (' + f(P.nOrbitals / need, 2) + '×). Una base mínima (SZ) apenas llega a 1.' : 'La base no tiene orbitales suficientes para alojar los electrones.');
  }
  if (P.nElectrons != null && P.ionicCharge != null) {
    const d = P.ionicCharge - P.nElectrons;
    add('kmesh', Math.abs(d) < 1e-3 ? 'ok' : 'info', Math.abs(d) < 1e-3 ? 'Sistema neutro (' + f(P.nElectrons, 3) + ' electrones = carga iónica)' : 'Carga neta de ' + f(d, 3) + ' e', Math.abs(d) < 1e-3 ? 'Los electrones igualan la carga iónica.' : 'Con carga neta aparece el término Emadel (fondo compensador). Verifica que NetCharge sea deliberado.');
  }
  if (ctx.nkpt) add('kmesh', 'info', ctx.nkpt + ' puntos k' + (ctx.nspin === 2 ? ' × 2 espines' : ''), 'Cada iteración del SCF diagonaliza ' + (ctx.nkpt * (ctx.nspin === 2 ? 2 : 1)) + ' matrices de ' + P.nOrbitals + '×' + P.nOrbitals + '. Para comprobar convergencia en k, repite con una malla más densa y compara E por átomo (sección 4).');

  // Malla
  if (ctx.meshReq && ctx.meshUsed) {
    const ok = ctx.meshUsed + 1e-6 >= ctx.meshReq;
    add('step', ok ? 'ok' : 'bad', 'MeshCutoff: pedido ' + g(ctx.meshReq) + ' Ry, usado ' + g(ctx.meshUsed) + ' Ry', ok ? 'Lo usado cumple lo pedido. Un MeshCutoff bajo produce efecto egg-box; compara E_KS y E_KS − E_eggbox.' : 'La malla usada es más gruesa que la pedida.');
  }
  const eg = steps.length && steps[steps.length - 1];
  if (eg && isFinite(eg.eKS) && isFinite(eg.eKSeggbox)) { const d = Math.abs(eg.eKS - eg.eKSeggbox); add('forces', d < 1e-3 ? 'ok' : 'warn', '|E_KS − (E_KS − E_eggbox)| = ' + g(d) + ' eV', d < 1e-3 ? 'La corrección de egg-box es despreciable.' : 'Corrección de egg-box apreciable: sube MeshCutoff.'); }

  // Fuerzas y estrés
  const F = P.forces; if (F && isFinite(F.max)) {
    const tol = ctx.forceTol;
    if (P.isRelaxation) add('forces', F.max < tol ? 'ok' : 'warn', 'Fuerza máxima ' + g(F.max) + ' eV/Å (tolerancia ' + g(tol) + ')', F.max < tol ? 'La relajación llegó a la tolerancia.' : 'La fuerza sigue sobre la tolerancia: la relajación no terminó o no converge.');
    else add('forces', F.max < 1e-3 ? 'info' : 'info', 'Fuerza máxima ' + g(F.max) + ' eV/Å', F.max < 1e-3 ? 'Fuerza nula; si el átomo está en un sitio de simetría, es lo esperado.' : 'Hay fuerza residual: la estructura no está en equilibrio a este nivel de teoría.');
    if (F.total && Math.hypot(...F.total) > 0.01 && P.nAtoms > 1) add('forces', 'warn', 'La suma de fuerzas es ' + g(Math.hypot(...F.total)) + ' eV/Å', 'Debería ser ≈ 0 (invariancia traslacional). Valores grandes delatan egg-box: sube MeshCutoff.');
  }
  if (P.stressVoigtKbar && P.stressVoigtKbar.length === 6) {
    const v = P.stressVoigtKbar, p = -(v[0] + v[1] + v[2]) / 3;
    add('stress', Math.abs(p) > 50 ? 'warn' : 'info', 'Presión ' + f(p, 2) + ' kbar (' + f(p / 10, 2) + ' GPa)', p < 0 ? 'Presión negativa: la celda es mayor que la de equilibrio y tiende a contraerse.' : 'Presión positiva: la celda está más comprimida que su equilibrio.');
  }

  // Energía final: identidad de la suma
  const FE_ = P.finalEnergy;
  if (FE_ && isFinite(FE_.Total)) {
    const keys = ['Kinetic', 'Hartree', 'Edftu', 'Eso', 'Ext. field', 'Exch.-corr.', 'Bulk bias', 'Ion-electron', 'Ion-ion', 'Ekinion', 'D3 dispersion'];
    const sum = keys.reduce((s, k) => s + (isFinite(FE_[k]) ? FE_[k] : 0), 0); const d = Math.abs(sum - FE_.Total);
    add('efinal', d < 1e-3 ? 'ok' : 'warn', 'La suma de los términos coincide con el total (Δ = ' + g(d) + ' eV)', d < 1e-3 ? 'Kinetic + Hartree + XC + ion–electrón + ion–ion (+ extras) = Total. Es una comprobación de que el archivo está completo.' : 'La suma no cuadra con el total: puede faltar algún término que esta versión imprime con otro nombre.');
  }
  const ED_ = P.energyDecomposition;
  if (ED_ && isFinite(ED_.Etot) && isFinite(ED_.FreeEng)) { const ts = ED_.FreeEng - ED_.Etot; add('efinal', Math.abs(ts) < 0.05 ? 'info' : 'warn', 'FreeEng − Etot = ' + g(ts) + ' eV (término −TS)', Math.abs(ts) < 0.05 ? 'Contribución entrópica pequeña del smearing.' : 'El smearing aporta más de 50 meV: la energía libre y la energía «a T = 0» difieren; usa la que corresponda y repórtalo.'); }

  // Poblaciones
  const pm = P.populations && P.populations.mulliken;
  if (pm && pm.atoms && pm.atoms.length) {
    const tot = pm.atoms.reduce((s, a) => s + a.valence, 0);
    add('pop', Math.abs(tot - P.nElectrons) < 0.01 ? 'ok' : 'warn', 'Σ población de Mulliken = ' + f(tot, 3) + ' (electrones ' + f(P.nElectrons, 3) + ')', Math.abs(tot - P.nElectrons) < 0.01 ? 'El reparto conserva el total de electrones.' : 'La suma no coincide con el número de electrones.');
    const sz = pm.atoms.map(a => a.Sz).filter(isFinite); if (sz.length) add('pop', 'info', 'Momentos de espín por átomo: ' + sz.map(x => f(x, 3)).join(', ') + ' μ_B', 'El de Mulliken depende de la base; el momento total (suma) es más robusto.');
  }
  const mo = P.populations && P.populations.mullikenOrbital;
  if (mo && mo.length) { let neg = 0; for (const b of mo) for (const a of (b.atoms || [])) for (const q of (a.qorb || [])) if (q < -0.05) neg++; if (neg) add('pop', 'info', neg + ' población(es) orbital(es) < −0.05 e', 'Normal con orbitales difusos (ζ adicionales): la suma sobre el átomo sí es robusta, el valor de un orbital suelto no.'); }

  // Avisos y tiempos
  for (const w of (P.warnings || []).slice(0, 8)) add('other', /BASIS_ENTHALPY/.test(w.text) ? 'info' : 'warn', 'Línea ' + w.line + ': ' + w.text.slice(0, 120), /BASIS_ENTHALPY/.test(w.text) ? 'Aviso inocuo de archivos obsoletos.' : 'Léelo en su contexto.');
  if (/ghost/i.test(text)) add('pseudo', 'bad', 'El archivo menciona un estado fantasma (ghost)', 'Revisa el pseudopotencial y los proyectores KB.');
  const tm = P.timers; if (tm && tm.routines && tm.routines.length) {
    const wall = tm.wallTime; const dg = tm.routines.find(r => r.name === 'diagon'), mesh = tm.routines.find(r => r.name === 'DHSCF');
    if (dg && dg.percent > 50) add('timer', 'info', 'Diagonalización: ' + dg.percent + ' % del tiempo', 'Domina el solver. Para acelerar: menos puntos k, paralelizar sobre k, algoritmo más rápido o (sistemas grandes) OMM/orden N (sección 6).');
    else if (mesh) add('timer', 'info', 'Malla (DHSCF): ' + mesh.percent + ' % del tiempo', 'Domina la malla de espacio real: baja MeshCutoff si el egg-box lo permite.');
    if (isFinite(wall)) add('timer', 'info', 'Tiempo de reloj ' + f(wall, 1) + ' s', P.nSteps > 1 ? f(wall / P.nSteps, 1) + ' s por paso geométrico.' : 'Un solo paso.');
  }
  return out;
}

export function analyzeOut(text, opts = {}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const P = parseOut(text);
  const ctx = scan(lines, P);
  ctx.isExample = !!opts.example;
  const blocks = segment(lines);
  const notes = annotateLines(lines, ctx, opts);
  const checks = diagnose(P, lines, ctx);
  return { P, lines, ctx, blocks, notes, checks };
}

// Informe en Markdown con el diagnóstico (para la bitácora)
export function reportMarkdown(name, A) {
  const L = { ok: '✔', info: 'ℹ', warn: '⚠', bad: '✘' };
  const rows = A.checks.map(c => `- ${L[c.level]} **${c.title}** (${BLOCKS[c.block].title}). ${c.detail}`);
  return `# Lectura anotada de ${name}\n\n- Líneas: ${A.lines.length}; bloques reconocidos: ${A.blocks.length}.\n- SIESTA ${A.P.program && A.P.program.version || '?'}; ${A.P.nAtoms ?? '?'} átomos, ${A.P.nOrbitals ?? '?'} orbitales.\n\n## Diagnóstico\n\n${rows.join('\n')}\n\n_Generado por DFT Lab. Las reglas leen el formato de SIESTA 4/5; revisa el .out original ante cualquier duda._\n`;
}
