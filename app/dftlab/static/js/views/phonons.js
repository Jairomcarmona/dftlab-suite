// Aprender 13 · Fonones: Si en supercelda 2×2×2 (16 átomos) con desplazamientos finitos (SIESTA 5.4.2, MD.TypeOfRun FC, LDA/DZP).
// El .FC se diagonaliza aquí: matriz dinámica D(q) con imágenes de Wigner–Seitz, dispersión, DOS y modo animado. Lector del .FC del usuario.
import { $, $$, css, alpha, onTheme, fmt, esc, seg, toast, downloadText } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import { createViewer } from '../core/three-view.js';
import { parseFC, fcRows } from '../siesta/fc.js';
import { phononModel, frequencies, pathFromSegments, dispersion, phononDOS, qCart, CM1_PER_THZ, MEV_PER_THZ } from '../physics/phonon.js';
import { readStructure } from '../crystal/formats.js';
import { massOf, symbolOf } from '../crystal/elements.js';
import { initMoyo, isMoyoReady } from '../crystal/symmetry.js';
import { getExplicitKPathOrigCell, bandPlotTicks } from '../crystal/kpath.js';
import D from '../data/si_fonones.json';

// Si, neutrones a 296 K: Nilsson y Nelin, PRB 6, 3777 (1972), en la tabulación de Giannozzi et al., PRB 43, 7231 (1991). THz.
const EXP = { G: { O: 15.53 }, X: { TA: 4.49, LA: 12.32, TO: 13.90 }, L: { TA: 3.43, LA: 11.35, LO: 12.60, TO: 14.68 } };
const MODES = { G: ['A', 'A', 'A', 'O', 'O', 'O'], X: ['TA', 'TA', 'LA', 'LA', 'TO', 'TO'], L: ['TA', 'TA', 'LA', 'LO', 'TO', 'TO'] };
const KP = { 'Γ': [0, 0, 0], X: [0.5, 0, 0.5], U: [0.625, 0.25, 0.625], K: [0.375, 0.375, 0.75], L: [0.5, 0.5, 0.5], W: [0.5, 0.25, 0.75] };
const SEGS = [['Γ', 'X'], ['X', 'U'], ['K', 'Γ'], ['Γ', 'L'], ['L', 'W'], ['W', 'X']].map(s => s.map(l => ({ label: l, f: KP[l] })));
const UNITS = { THz: [1, 'ν (THz)'], cm: [CM1_PER_THZ, 'ν (cm⁻¹)'], meV: [MEV_PER_THZ, 'ħω (meV)'] };

function theory(){ return `
  <h3>Aproximación armónica</h3>
  <p>Si los núcleos se apartan poco de su posición de equilibrio, la energía de Born–Oppenheimer se desarrolla hasta segundo orden en los desplazamientos u:</p>
  <div class="eq">E = E₀ + ½ Σ Φ<sub>iα,jβ</sub> u<sub>iα</sub> u<sub>jβ</sub>,  Φ<sub>iα,jβ</sub> = ∂²E/∂u<sub>iα</sub>∂u<sub>jβ</sub> = −∂F<sub>jβ</sub>/∂u<sub>iα</sub></div>
  <p>Φ es la matriz de constantes de fuerza (force constants), en eV/Å². El término lineal no aparece porque en el equilibrio las fuerzas son nulas; los términos cúbicos y cuárticos (anarmonicidad) dan la dilatación térmica y la vida media de los fonones, y no se incluyen aquí.</p>
  <h3>Desplazamientos finitos en SIESTA</h3>
  <p>Con <code>MD.TypeOfRun FC</code> SIESTA mueve cada átomo entre <code>MD.FCFirst</code> y <code>MD.FCLast</code> ±<code>MD.FCDispl</code> en x, y, z, hace un SCF completo en cada caso y escribe en <code>Label.FC</code> −ΔF/Δu para todos los átomos. El promedio de las dos direcciones es la derivada centrada: su error es de orden Δu² y cancela la fuerza residual que tenga la geometría sin desplazar. Por la simetría de traslación basta desplazar un átomo de cada tipo de la base: esta corrida mueve los ${D.meta.ndisp} átomos de la celda primitiva del Si, ${D.meta.ndisp} × 3 direcciones × 2 signos = ${6 * D.meta.ndisp} SCF más el de referencia en la supercelda de ${D.meta.natoms} átomos, ${fmt(D.meta.wall_s / 60, 0)} min en 4 núcleos. Cada fila de Φ da la respuesta de los ${D.meta.natoms} átomos.</p>
  <h3>Matriz dinámica</h3>
  <p>En un cristal Φ solo depende de la distancia entre celdas. Para un vector de onda q, la matriz dinámica de 3n × 3n (n átomos en la celda primitiva) es</p>
  <div class="eq">D<sub>κα,κ′β</sub>(q) = Σ<sub>R</sub> Φ<sub>κα,κ′β</sub>(0,R) e<sup>iq·(R + τ<sub>κ′</sub> − τ<sub>κ</sub>)</sup> / √(M<sub>κ</sub> M<sub>κ′</sub>)</div>
  <p>y sus autovalores son ω²(q). Es hermítica: aquí se diagonaliza en el navegador con Jacobi sobre su forma real de 6n × 6n. Para el Si (n = 2) son 6 ramas: 3 acústicas, que se anulan en Γ, y 3 ópticas.</p>
  <h3>Supercelda e interpolación</h3>
  <p>Una supercelda N₁×N₂×N₃ contiene exactamente los q con q·T = 2π·entero para sus vectores T. En 2×2×2 de la fcc son Γ, X y L, y ahí las frecuencias son exactas para este Φ. En el resto del camino D(q) es una interpolación de Fourier: cada par de átomos se cuenta con su imagen más cercana en la supercelda y, si hay varias a la misma distancia, con peso 1/m (celda de Wigner–Seitz). Sin ese reparto la dispersión entre puntos conmensurados sale deformada; el selector «modelo» lo muestra.</p>
  ${D.meta.shifted ? `<h3>La malla k también tiene simetría</h3>
  <p>Una primera corrida con la malla 4×4×4 desplazada medio paso (la habitual para energías totales) conservaba solo la simetría de un eje (111): las dos TA de X, degeneradas por simetría, salían en ${fmt(D.meta.shifted.X[0], 2)} y ${fmt(D.meta.shifted.X[1], 2)} THz, y el triplete óptico de Γ en ${D.meta.shifted.G.slice(3).map(v => fmt(v, 3)).join(', ')} THz. En una red fcc una malla de Monkhorst–Pack desplazada no es invariante ante todas las operaciones cúbicas. Con la malla centrada en Γ que se usa aquí la degeneración se recupera. Para fonones conviene una malla k que respete la simetría del cristal.</p>` : ''}
  <h3>Regla de suma acústica</h3>
  <p>Trasladar todo el cristal no cuesta energía, así que Σ<sub>j</sub> Φ<sub>iα,jβ</sub> = 0 y las tres ramas acústicas deben valer cero en Γ. La malla de integración de SIESTA (efecto egg-box) y la tolerancia del SCF la rompen un poco; la corrección más simple fija el término propio Φ<sub>ii</sub> = −Σ<sub>j≠i</sub> Φ<sub>ij</sub>.</p>
  <h3>Qué falta y por qué difiere del experimento</h3>
  <p>El Si no es polar: no hay cargas efectivas de Born ni desdoblamiento LO–TO en Γ, cosa que en GaAs o MgO exigiría un término no analítico. Las diferencias con el experimento vienen de la supercelda pequeña (fuera de Γ, X y L), de la base DZP y de LDA; el parámetro de red usado es el de equilibrio de este mismo cálculo (${fmt(D.meta.a, 3)} Å frente a 5.431 Å experimental), que es lo coherente para fonones: con la red experimental el cristal estaría bajo tensión. Los datos experimentales son a temperatura ambiente; la anarmonicidad los baja unas décimas de THz respecto a 0 K (inferencia a partir del corrimiento Raman con la temperatura, no medido aquí).</p>
  <p class="src">Born y Huang, <i>Dynamical Theory of Crystal Lattices</i> (1954) · Kresse, Furthmüller y Hafner, EPL 32, 729 (1995) (desplazamientos finitos en superceldas) · Parlinski, Li y Kawazoe, PRL 78, 4063 (1997) · Giannozzi, de Gironcoli, Pavone y Baroni, PRB 43, 7231 (1991) · Nilsson y Nelin, PRB 6, 3777 (1972) (neutrones, Si a 296 K) · Togo y Tanaka, Scr. Mater. 108, 1 (2015) (imágenes de Wigner–Seitz en phonopy) · manual de SIESTA 5.4, «Force constants» y utilidad vibra.</p>`; }

function blocksFromJSON(F){ return { nAtoms: F.nAtoms, displ: F.displ, nDisplaced: F.blocks.length / 6, blocks: F.blocks.map(b => Float64Array.from(b)) }; }
function buildModel(cell, n, fc, first, opts){
  return phononModel({ superCell: cell, n, masses: cell.numbers.map(z => massOf(z)), phi: fcRows(fc, first), ...opts });
}
// series por rama con cortes (NaN) en discontinuidades del camino
function branchSeries(path, bands, k, s){
  const d = []; const br = new Set(path.breaks);
  path.x.forEach((x, i) => { if (br.has(i)) d.push([x, NaN]); d.push([x, bands[i][k] * s]); });
  return d;
}
const near = (arr, x) => { let b = 0; for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - x) < Math.abs(arr[b] - x)) b = i; return b; };

export function mount(root){
  const cell = D.cell, n = D.meta.n, fc = blocksFromJSON(D.fc);
  const S = { unit: 'THz', model: 'full', idx: 0, branch: 5, amp: 1, play: true };
  const models = {
    full: buildModel(cell, n, fc, 1, { asr: true, ws: true }),
    noasr: buildModel(cell, n, fc, 1, { asr: false, ws: true }),
    nows: buildModel(cell, n, fc, 1, { asr: true, ws: false }),
  };
  const M = models.full, path = pathFromSegments(M, SEGS, 40);
  const bandsCache = {}; const bandsOf = k => bandsCache[k] || (bandsCache[k] = dispersion(models[k], path));
  const at = (lab, k = 'full') => frequencies(models[k], qCart(models[k], KP[lab])).nu;
  const fG = at('Γ'), fX = at('X'), fL = at('L'), fGn = at('Γ', 'noasr');
  const rows = [];
  [['Γ', 'G', fG], ['X', 'X', fX], ['L', 'L', fL]].forEach(([lab, key, f]) => {
    const seen = new Set();
    MODES[key].forEach((m, i) => { if (m === 'A' || seen.has(m)) return; seen.add(m); const e = EXP[key][m] ?? (key === 'X' && m === 'LA' ? EXP.X.LA : null);
      rows.push({ lab, m: key === 'X' && m === 'LA' ? 'LA = LO' : m === 'O' ? 'LO = TO' : m, calc: f[i], exp: e }); });
  });
  const errs = rows.filter(r => r.exp).map(r => 100 * (r.calc - r.exp) / r.exp);
  const mae = errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length;
  const maxAsym = Math.max(...fcRows(fc).map(r => r.asym));
  // decaimiento de Φ con la distancia (filas del átomo 1)
  const decay = M.terms.filter(t => t.i === 0 && t.j !== 0).map(t => [t.dist, Math.sqrt(t.phi.flat().reduce((a, b) => a + b * b, 0))]);
  const self = M.terms.find(t => t.i === 0 && t.j === 0);

  root.innerHTML = `
  <div class="pghead"><div>
    <div class="kicker">Aprender · 13</div><h1>Fonones</h1>
    <p class="lede">Silicio con desplazamientos finitos en una supercelda de ${D.meta.natoms} átomos, calculado con SIESTA; el archivo .FC se diagonaliza en esta página. El modo óptico en Γ sale en ${fmt(fG[5], 2)} THz (${fmt(fG[5] * CM1_PER_THZ, 0)} cm⁻¹) frente a ${EXP.G.O} THz medidos, y el error medio en Γ, X y L es ${fmt(mae, 1)} %.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">

      <section class="panel wide"><div class="ph"><h2>Dispersión de fonones</h2><div class="seg" id="unSel"><button data-v="THz">THz</button><button data-v="cm">cm⁻¹</button><button data-v="meV">meV</button></div><div class="seg" id="mdSel"><button data-v="full">completo</button><button data-v="noasr">sin regla de suma</button><button data-v="nows">sin Wigner–Seitz</button></div></div>
        <div class="pb"><canvas data-export="Si_fonones_dispersion" id="cvDisp" style="height:400px"></canvas><div class="readout" id="rdDisp"></div>
        <p class="note" id="ntDisp"></p></div></section>

      <section class="panel"><div class="ph"><h2>Densidad de estados fonónica</h2></div>
        <div class="pb"><canvas data-export="Si_fonones_DOS" id="cvDos" style="height:300px"></canvas><div class="readout" id="rdDos"></div>
        <p class="note" id="ntDos">Calculando en una malla de q…</p></div></section>

      <section class="panel"><div class="ph"><h2>Γ, X y L frente al experimento</h2></div>
        <div class="pb"><div class="tblwrap"><table class="tbl"><thead><tr><th>q</th><th>modo</th><th>SIESTA</th><th>exp.</th><th>error</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${r.lab}</td><td>${r.m}</td><td>${fmt(r.calc, 2)}</td><td>${r.exp != null ? fmt(r.exp, 2) : '—'}</td><td>${r.exp != null ? (r.calc >= r.exp ? '+' : '−') + fmt(Math.abs(100 * (r.calc - r.exp) / r.exp), 1) + ' %' : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="note">Frecuencias en THz. Puntos conmensurados con la supercelda 2×2×2: aquí no hay interpolación. Las acústicas transversales (TA) quedan por debajo del experimento, las ópticas cerca; patrón que también aparece en otros cálculos LDA del Si con la red teórica (Giannozzi et al. 1991). Sin regla de suma las acústicas en Γ valen ${fGn.slice(0, 3).map(v => fmt(v, 2)).join(', ')} THz (negativo = ω² &lt; 0); con ella, ${fG.slice(0, 3).map(v => fmt(Math.abs(v) < 5e-3 ? 0 : v, 2)).join(', ')}.</p>
        <p class="note">Experimento: Nilsson y Nelin, PRB 6, 3777 (1972), dispersión inelástica de neutrones a 296 K, valores como los tabula Giannozzi et al., PRB 43, 7231 (1991).</p></div></section>

      <section class="panel"><div class="ph"><h2>Alcance de las constantes de fuerza</h2></div>
        <div class="pb"><canvas data-export="Si_constantes_fuerza" id="cvPhi" style="height:280px"></canvas><div class="readout" id="rdPhi"></div>
        <p class="note">Norma de cada bloque 3×3 Φ(1, j) frente a la distancia al átomo desplazado, en la imagen más cercana. El término propio vale ${fmt(Math.sqrt(self.phi.flat().reduce((a, b) => a + b * b, 0)), 1)} eV/Å². El primer vecino (${fmt(decay.reduce((a, b) => Math.min(a, b[0]), 9), 2)} Å) concentra casi toda la rigidez; lo que cae más allá de media supercelda se pierde, y por eso las TA, que dependen de interacciones lejanas, son lo menos convergido.</p>
        <p class="note">Diferencia máxima entre desplazar +Δu y −Δu: ${fmt(maxAsym, 3)} eV/Å² (fuerza residual sin desplazar y anarmonicidad, que el promedio elimina).</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Modo animado</h2><div class="seg" id="brSel">${[1, 2, 3, 4, 5, 6].map(b => `<button data-v="${b - 1}">${b}</button>`).join('')}</div></div>
        <div class="pb"><div class="split2"><div class="three" id="ph3" style="height:340px"></div>
          <div><div class="btnrow"><label class="sl">q en el camino <input type="range" id="qSl" min="0" max="${path.x.length - 1}" step="1" value="0"><output id="qSlO"></output></label></div>
          <div class="btnrow"><label class="sl">amplitud <input type="range" id="ampSl" min="0.2" max="3" step="0.1" value="1"><output id="ampSlO">1.0</output></label>
            <button class="tiny" id="playBt">pausa</button></div>
          <div class="btnrow">${['Γ', 'X', 'L', 'K', 'W'].map(l => `<button class="tiny" data-q="${l}">${l}</button>`).join('')}</div>
          <div class="readout" id="rdMode"></div>
          <p class="note">Bloque de 2×2×2 celdas cúbicas convencionales (64 átomos). Cada átomo se mueve como Re[e<sub>κ</sub>(q) e<sup>i(q·r − ωt)</sup>]/√M, con la amplitud exagerada; el tiempo está escalado para que todos los modos se vean al mismo ritmo. También se elige el modo haciendo clic en la dispersión.</p></div></div></div></section>

      <section class="panel wide"><div class="ph"><h2>Tu archivo .FC</h2></div>
        <div class="pb"><label class="drop" id="fcDrop"><input type="file" id="fcIn" multiple hidden>Arrastra aquí el <b>.FC</b> y la geometría de la misma corrida (<b>.fdf</b>, <b>.XV</b> o <b>.STRUCT_OUT</b>) a la vez, o haz clic. Se lee en el navegador; nada se envía.</label>
        <div class="btnrow" style="margin-top:10px"><label class="sl">supercelda <input type="number" id="n1" value="2" min="1" max="12" style="width:6ch"> × <input type="number" id="n2" value="2" min="1" max="12" style="width:6ch"> × <input type="number" id="n3" value="2" min="1" max="12" style="width:6ch"></label>
          <label class="sl">MD.FCFirst <input type="number" id="fcFirst" value="1" min="1" style="width:6ch"></label>
          <button class="tiny" id="fcGo">calcular</button><button class="tiny" id="fcEx">probar con la corrida de Si</button></div>
        <div id="fcMsg" class="note"></div>
        <div id="fcOut" hidden><canvas data-export="fonones_dispersion_usuario" id="cvU" style="height:340px"></canvas><div class="readout" id="rdU"></div>
          <canvas data-export="fonones_DOS_usuario" id="cvUd" style="height:220px"></canvas><div id="fcTab"></div></div>
        <p class="note">La supercelda debe ser la celda primitiva repetida N₁×N₂×N₃ veces a lo largo de sus vectores, como la genera la pestaña «Estructura y entrada». Hay que desplazar al menos un átomo de cada tipo de la base; si se desplazaron todos, se promedian. El camino k es el estándar de seekpath para la celda primitiva deducida. Las masas son las atómicas estándar. Con la estructura de <code>fcbuild</code> (celdas a ambos lados) se usa la utilidad <code>vibra</code> de SIESTA; este lector supone una supercelda diagonal.</p>
        <div class="btnrow"><button class="tiny" id="dlFdf">descargar el .fdf de esta corrida</button></div></div></section>
    </div>
  </div>
  <footer class="prov">Procedencia: SIESTA ${esc(D.meta.version)}, ${esc(D.meta.xc)}, base ${esc(D.meta.basis)}, pseudopotencial ${esc(D.meta.pseudo)}; MeshCutoff ${D.meta.mesh} Ry, DM.Tolerance ${D.meta.dmTol}; supercelda 2×2×2 de la fcc (${D.meta.natoms} átomos) con a = ${fmt(D.meta.a, 3)} Å (mínimo de E(a) con la misma base y malla, celda de 2 átomos, k 8×8×8), k ${esc(D.meta.kgrid)}; MD.FCDispl ${D.meta.displ} Å, MD.FCFirst 1 y MD.FCLast ${D.meta.ndisp}; ${fmt(D.meta.wall_s / 60, 0)} min con 4 hilos OpenMP. Masa del Si ${massOf(14)} uma. Diagonalización, DOS (malla Γ-centrada de q, σ gaussiano) y animación en el navegador (physics/phonon.js). Entradas y salidas en corridas/fonones.tar.gz; JSON de corridas/fonones_gen_json.mjs. Experimento: Nilsson y Nelin, PRB 6, 3777 (1972).</footer>`;
  $$('canvas[data-export]', root).forEach(cv => cv.closest('.panel').querySelector('.ph').append(exportBar(cv, cv.dataset.export)));

  const cols = () => [css('--orb-s'), css('--orb-s'), css('--orb-p'), css('--orb-d'), css('--accent'), css('--accent')];
  const expPts = s => {
    const P = []; const x = l => path.ticks.find(t => t.label === l || t.label.split('|').includes(l))?.x;
    P.push({ x: x('Γ'), y: EXP.G.O * s });
    for (const k of ['TA', 'LA', 'TO']) P.push({ x: x('X'), y: EXP.X[k] * s });
    for (const k of ['TA', 'LA', 'LO', 'TO']) P.push({ x: x('L'), y: EXP.L[k] * s });
    return P.map(p => ({ ...p, color: css('--bad'), r: 4 }));
  };

  // ---- dispersión ----
  const drawDisp = () => {
    const [s, yl] = UNITS[S.unit], B = bandsOf(S.model), c = cols();
    const ymax = Math.ceil(17 * s / (s > 10 ? 50 : 2)) * (s > 10 ? 50 : 2);
    const series = [0, 1, 2, 3, 4, 5].map(k => ({ d: branchSeries(path, B, k, s), color: k === S.branch ? css('--ink') : c[k], width: k === S.branch ? 2.4 : 1.6, label: k === 0 ? 'SIESTA + D(q)' : undefined }));
    chart($('#cvDisp', root), { xlim: [0, path.x[path.x.length - 1]], ylim: [Math.min(-0.5 * s, ...B.flat().map(v => v * s)) , ymax], xlabel: '', ylabel: yl, xticks: path.ticks, legend: true,
      series: [...series, { d: [], color: css('--bad'), label: 'exp. 296 K (neutrones)' }],
      hlines: [{ y: 0, color: css('--faint') }], vlines: path.ticks.slice(1, -1).map(t => ({ x: t.x, color: css('--line') })),
      points: [...expPts(s), { x: path.x[S.idx], y: B[S.idx][S.branch] * s, color: css('--ink'), r: 5 }],
      readEl: $('#rdDisp', root), read: x => { if (x == null) return 'Pasa el cursor sobre la gráfica; clic elige el modo animado.'; const i = near(path.x, x); return `q = (${qFrac(i).map(v => fmt(v, 3)).join(', ')}) · ${B[i].map(v => fmt(v * s, s > 10 ? 0 : 2)).join(' · ')} ${S.unit === 'cm' ? 'cm⁻¹' : S.unit}`; },
      onclick: x => { setIdx(near(path.x, x)); } });
    const note = { full: 'Seis ramas: tres acústicas (dos TA degeneradas en Γ–X y Γ–L, una LA) y tres ópticas. Los puntos rojos son las frecuencias medidas en Γ, X y L. Entre esos puntos la curva es una interpolación de una supercelda de 16 átomos.',
      noasr: 'Sin imponer la regla de suma acústica: en Γ las ramas acústicas no llegan a cero porque la suma de las fuerzas sobre todos los átomos no es exactamente cero (malla de integración y tolerancia del SCF). El efecto es pequeño en Si y se nota solo cerca de Γ.',
      nows: 'Sin repartir los pares entre imágenes equivalentes: en Γ, X y L las frecuencias no cambian (la suma sobre la supercelda es la misma), pero entre ellos la interpolación se deforma, sobre todo en las ramas acústicas.' }[S.model];
    $('#ntDisp', root).textContent = note;
  };
  const qFrac = i => { const q = path.q[i], L = M.prim.lattice; return [0, 1, 2].map(a => (q[0] * L[a][0] + q[1] * L[a][1] + q[2] * L[a][2]) / (2 * Math.PI)); };

  // ---- DOS ----
  let dos = null;
  const drawDos = () => {
    if (!dos) return; const [s, yl] = UNITS[S.unit];
    const pts = [['TA(X)', EXP.X.TA], ['', EXP.L.TA], ['', EXP.X.TO], ['Γ', EXP.G.O]];
    chart($('#cvDos', root), { xlim: [0, 17 * s], ylim: [0, Math.max(...dos.g) / s * 1.1], xlabel: yl, ylabel: `g (estados/${S.unit === 'cm' ? 'cm⁻¹' : S.unit}/celda)`,
      series: [{ d: dos.E.map((e, i) => [e * s, dos.g[i] / s]), color: css('--accent'), width: 1.8, fill: 0, fillAlpha: .18 }],
      vlines: pts.map(([l, v]) => ({ x: v * s, label: l, color: css('--bad'), dash: [3, 3] })),
      readEl: $('#rdDos', root), read: x => { if (x == null) return `integral = ${fmt(dos.integ, 3)} modos (6 esperados)`; const i = near(dos.E, x / s); return `${fmt(x, s > 10 ? 0 : 2)} → g = ${fmt(dos.g[i] / s, 3)}`; } });
  };
  setTimeout(() => {
    if (!root.isConnected) return;
    dos = phononDOS(M, { m: 18, sigma: 0.15, de: 0.02, emin: -0.5, emax: 17 });
    dos.integ = dos.g.reduce((a, b) => a + b, 0) * 0.02;
    const iTA = dos.E.findIndex(e => e > 3); let pk = iTA; for (let i = iTA; i < dos.E.length && dos.E[i] < 6; i++) if (dos.g[i] > dos.g[pk]) pk = i;
    let po = dos.E.findIndex(e => e > 13); for (let i = po; i < dos.E.length; i++) if (dos.g[i] > dos.g[po]) po = i;
    $('#ntDos', root).innerHTML = `Malla de ${dos.nq} puntos q (18×18×18) diagonalizada aquí, ensanchamiento gaussiano σ = 0.15 THz; la integral da ${fmt(dos.integ, 2)} de 6 modos. El pico acústico transversal está en ${fmt(dos.E[pk], 2)} THz y el óptico en ${fmt(dos.E[po], 2)} THz. Las líneas rojas son frecuencias medidas en puntos críticos: TA(L), TA(X), TO(X) y el óptico en Γ (no una DOS medida): los picos de la DOS caen cerca de ellas porque las ramas son planas allí.`;
    drawDos();
  }, 30);

  // ---- constantes de fuerza ----
  const drawPhi = () => chart($('#cvPhi', root), { xlim: [0, Math.ceil(Math.max(...decay.map(d => d[0])) + 0.5)], ylim: [1e-3, 30], logy: true, xlabel: 'distancia al átomo 1 (Å)', ylabel: '‖Φ(1,j)‖ (eV/Å²)',
    series: [{ d: [...decay].sort((a, b) => a[0] - b[0]), color: alpha(css('--accent'), .0), width: 0 }],
    points: decay.map(d => ({ x: d[0], y: Math.max(d[1], 1.1e-3), color: css('--accent'), r: 3.5 })), vlines: [{ x: Math.hypot(...M.superCell.lattice[0]) / 2, label: 'media supercelda', color: css('--faint'), dash: [4, 3] }],
    readEl: $('#rdPhi', root), read: x => { if (x == null) return `${decay.length} vecinos del átomo 1 en la supercelda`; const d = decay.reduce((b, c) => Math.abs(c[0] - x) < Math.abs(b[0] - x) ? c : b); return `r = ${fmt(d[0], 3)} Å · ‖Φ‖ = ${fmt(d[1], 4)} eV/Å²`; } });

  // ---- modo animado ----
  const a = D.meta.a, fccB = [[0, 0, 0], [0, .5, .5], [.5, 0, .5], [.5, .5, 0]], atoms = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) for (const f of fccB) for (const kap of [0, 1])
    atoms.push({ kappa: kap, r: [(i + f[0] + kap * .25) * a, (j + f[1] + kap * .25) * a, (k + f[2] + kap * .25) * a] });
  const bondsL = []; atoms.forEach((p, i) => atoms.forEach((q, j) => { if (j > i && Math.hypot(p.r[0] - q.r[0], p.r[1] - q.r[1], p.r[2] - q.r[2]) < 2.5) bondsL.push([i, j]); }));
  let V = null, gV = null, meshes = [], bmesh = [], mode = null, t0 = performance.now(), raf = 0;
  const ctr = [a, a, a];
  const setupViewer = () => {
    if (!V) { V = createViewer($('#ph3', root), { camera: [17, 11, 20] }); gV = V.group(); } else V.clear(gV);   // un solo renderer; el tema solo repinta
    const T = V.THREE, g = gV;
    const sg = new T.SphereGeometry(0.42, 22, 16), mats = [new T.MeshStandardMaterial({ color: new T.Color(css('--orb-p')), roughness: .45 }), new T.MeshStandardMaterial({ color: new T.Color(css('--orb-d')), roughness: .45 })];
    meshes = atoms.map(p => { const m = new T.Mesh(sg, mats[p.kappa]); g.add(m); return m; });
    const cg = new T.CylinderGeometry(0.1, 0.1, 1, 8), bm = new T.MeshStandardMaterial({ color: new T.Color(css('--faint')), roughness: .6 });
    bmesh = bondsL.map(() => { const m = new T.Mesh(cg, bm); g.add(m); return m; });
    const P = [[0, 0, 0], [2 * a, 0, 0], [0, 2 * a, 0], [0, 0, 2 * a], [2 * a, 2 * a, 0], [2 * a, 0, 2 * a], [0, 2 * a, 2 * a], [2 * a, 2 * a, 2 * a]].map(p => new T.Vector3(p[0] - ctr[0], p[1] - ctr[1], p[2] - ctr[2]));
    const E = [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 4], [2, 6], [3, 5], [3, 6], [4, 7], [5, 7], [6, 7]], pts = []; E.forEach(([i, j]) => pts.push(P[i], P[j]));
    g.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: new T.Color(css('--muted')) })));
  };
  const up = { v: null };
  const frame = () => {
    raf = requestAnimationFrame(frame); if (!V || !mode) return;
    const T = V.THREE; up.v = up.v || new T.Vector3(0, 1, 0);
    const ph = S.play ? (performance.now() - t0) / 1000 * 2 * Math.PI * 0.8 : 0;
    const pos = atoms.map((p, i) => { const e = mode.e[p.kappa], qr = mode.q[0] * p.r[0] + mode.q[1] * p.r[1] + mode.q[2] * p.r[2] - ph, c = Math.cos(qr), s = Math.sin(qr);
      return [0, 1, 2].map(k => p.r[k] - ctr[k] + mode.A * S.amp * (e[k][0] * c - e[k][1] * s)); });
    pos.forEach((p, i) => meshes[i].position.set(p[0], p[1], p[2]));
    bondsL.forEach(([i, j], b) => { const A = new T.Vector3(...pos[i]), B = new T.Vector3(...pos[j]), d = B.clone().sub(A), L = d.length();
      const m = bmesh[b]; m.position.copy(A.add(B).multiplyScalar(.5)); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(up.v, d.normalize()); });
  };
  const setMode = () => {
    const q = path.q[S.idx], r = frequencies(M, q, true), v = r.vecs[S.branch], Mk = M.Mk;
    const e = [0, 1].map(k => [0, 1, 2].map(al => v[3 * k + al].map(x => x / Math.sqrt(Mk[k] / Mk[0]))));
    let mx = 0; e.forEach(ek => ek.forEach(([x, y]) => { mx = Math.max(mx, Math.hypot(x, y)); }));
    mode = { q, e, A: 0.28 / (mx || 1) };
    const s = UNITS[S.unit][0], qf = qFrac(S.idx), tk = path.ticks.find(t => Math.abs(t.x - path.x[S.idx]) < 1e-9);
    const ratio = Math.hypot(...e[0].flat()) / (Math.hypot(...e[1].flat()) || 1e-12);
    $('#qSlO', root).textContent = tk ? tk.label : fmt(path.x[S.idx], 2);
    $('#rdMode', root).innerHTML = `rama ${S.branch + 1}${tk ? ' en ' + tk.label : ''}: q = (${qf.map(x => fmt(x, 3)).join(', ')}) en la recíproca primitiva · ν = ${fmt(r.nu[S.branch] * s, s > 10 ? 0 : 2)} ${S.unit === 'cm' ? 'cm⁻¹' : S.unit} · |u₁|/|u₂| = ${fmt(ratio, 2)}`;
    $$('#brSel button', root).forEach(b => b.classList.toggle('on', +b.dataset.v === S.branch));
  };
  const setIdx = i => { S.idx = i; $('#qSl', root).value = i; setMode(); drawDisp(); };

  // ---- controles ----
  seg($('#unSel', root), S.unit, v => { S.unit = v; drawDisp(); drawDos(); setMode(); });
  seg($('#mdSel', root), S.model, v => { S.model = v; drawDisp(); });
  seg($('#brSel', root), String(S.branch), v => { S.branch = +v; setMode(); drawDisp(); });
  $('#qSl', root).addEventListener('input', e => setIdx(+e.target.value));
  $('#ampSl', root).addEventListener('input', e => { S.amp = +e.target.value; $('#ampSlO', root).textContent = fmt(S.amp, 1); });
  $('#playBt', root).addEventListener('click', e => { S.play = !S.play; e.target.textContent = S.play ? 'pausa' : 'animar'; t0 = performance.now(); });
  $$('[data-q]', root).forEach(b => b.addEventListener('click', () => { const l = b.dataset.q; const t = path.ticks.find(t => t.label.split('|').includes(l)); if (t) setIdx(near(path.x, t.x + (l === 'K' ? 1e-9 : 0)) ); }));
  $('#dlFdf', root).addEventListener('click', () => downloadText(D.fdf, 'si_fc.fdf'));

  // ---- archivo del usuario ----
  let uFiles = [];
  const msg = (t, bad) => { const m = $('#fcMsg', root); m.innerHTML = t; m.style.color = bad ? css('--bad') : ''; };
  const readAll = async list => { uFiles = await Promise.all([...list].map(async f => ({ name: f.name, text: await f.text() }))); msg(`Cargados: ${uFiles.map(f => esc(f.name)).join(', ')}`); runUser(); };
  const drop = $('#fcDrop', root), inp = $('#fcIn', root);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); readAll(e.dataTransfer.files); });
  inp.addEventListener('change', () => readAll(inp.files));
  $('#fcGo', root).addEventListener('click', () => runUser());
  $('#fcEx', root).addEventListener('click', () => { uFiles = [{ name: 'si_fc.FC', text: D.fcText }, { name: 'si_fc.fdf', text: D.fdf }]; ['n1', 'n2', 'n3'].forEach(k => $('#' + k, root).value = 2); $('#fcFirst', root).value = 1; msg('Corrida de Si de esta página (16 átomos).'); runUser(); });
  async function runUser(){
    const fcF = uFiles.find(f => /\.fc$/i.test(f.name) || /^\s*Force constants matrix/i.test(f.text.slice(0, 200)));
    const stF = uFiles.find(f => f !== fcF && /\.(fdf|xv|struct_out|struct_in)$/i.test(f.name));
    if (!fcF || !stF) { msg('Faltan archivos: hacen falta el .FC y la geometría de la supercelda (.fdf, .XV o .STRUCT_OUT).', true); return; }
    try {
      const cellU = readStructure(stF.text, { filename: stF.name });
      const fcU = parseFC(fcF.text, { nAtoms: cellU.positions.length });
      if (fcU.nAtoms !== cellU.positions.length) throw new Error(`El .FC es de ${fcU.nAtoms} átomos y la geometría tiene ${cellU.positions.length}.`);
      const nU = ['n1', 'n2', 'n3'].map(k => Math.max(1, +$('#' + k, root).value || 1)), first = Math.max(1, +$('#fcFirst', root).value || 1);
      const MU = buildModel(cellU, nU, fcU, first, { asr: true, ws: true });
      let segs = null, ticks = null, pathU;
      try { if (!isMoyoReady()) await initMoyo('inline'); const kp = getExplicitKPathOrigCell(MU.prim, { referenceDistance: 0.02, symprec: 1e-3 });
        const P = kp.point_coords, lab = l => l === 'GAMMA' ? 'Γ' : l.replace(/_(\d)/, '$1');
        segs = kp.path.map(([A, B]) => [{ label: lab(A), f: P[A] }, { label: lab(B), f: P[B] }]); } catch (e) { segs = null; }
      if (!segs) segs = [[{ label: 'Γ', f: [0, 0, 0] }, { label: 'b₁/2', f: [.5, 0, 0] }], [{ label: 'b₁/2', f: [.5, 0, 0] }, { label: '(½,½,0)', f: [.5, .5, 0] }], [{ label: '(½,½,0)', f: [.5, .5, 0] }, { label: 'Γ', f: [0, 0, 0] }], [{ label: 'Γ', f: [0, 0, 0] }, { label: '(½,½,½)', f: [.5, .5, .5] }]];
      pathU = pathFromSegments(MU, segs, 40);
      const BU = dispersion(MU, pathU), nm = MU.nmodes, s = UNITS[S.unit][0];
      const all = BU.flat(), lo = Math.min(0, ...all), hi = Math.max(...all);
      $('#fcOut', root).hidden = false;
      const mq = Math.max(4, Math.min(16, Math.round(Math.cbrt(60000 / (nm * nm)))));
      const dU = phononDOS(MU, { m: mq, sigma: Math.max(0.05, (hi - lo) / 120), de: (hi - lo) / 600 || 0.01 });
      const gG = frequencies(MU, [0, 0, 0]).nu, neg = all.filter(v => v < -0.05).length;
      const drawU = () => {
        const s = UNITS[S.unit][0];
        chart($('#cvU', root), { xlim: [0, pathU.x[pathU.x.length - 1]], ylim: [Math.min(0, lo * s) - 0.03 * hi * s, hi * s * 1.06], ylabel: UNITS[S.unit][1], xticks: pathU.ticks,
          series: Array.from({ length: nm }, (_, k) => ({ d: branchSeries(pathU, BU, k, s), color: css('--accent'), width: 1.4 })), hlines: [{ y: 0, color: css('--faint') }], vlines: pathU.ticks.slice(1, -1).map(t => ({ x: t.x, color: css('--line') })),
          readEl: $('#rdU', root), read: x => x == null ? `${nm} ramas · ${MU.nb} átomos en la celda primitiva (${[...new Set(MU.prim.numbers)].map(symbolOf).join(', ')})` : BU[near(pathU.x, x)].map(v => fmt(v * s, 2)).join(' · ') });
        chart($('#cvUd', root), { xlim: [dU.E[0] * s, dU.E[dU.E.length - 1] * s], ylim: [0, Math.max(...dU.g) / s * 1.1], xlabel: UNITS[S.unit][1], ylabel: 'g', series: [{ d: dU.E.map((e, i) => [e * s, dU.g[i] / s]), color: css('--accent'), width: 1.6, fill: 0, fillAlpha: .18 }], nohover: true });
      };
      drawU(); uDraw = drawU;
      const asym = Math.max(...fcRows(fcU, first).map(r => r.asym));
      $('#fcTab', root).innerHTML = `<dl class="kv"><dt>átomos / desplazados</dt><dd>${fcU.nAtoms} / ${fcU.nDisplaced} (desde el ${first})</dd><dt>Δu</dt><dd>${fcU.displ != null ? fmt(fcU.displ, 4) + ' Å' : 'no indicado'}</dd>
        <dt>celda primitiva</dt><dd>${MU.nb} átomos × ${MU.ncell} celdas</dd><dt>Γ (THz)</dt><dd>${gG.map(v => fmt(v, 2)).join(', ')}</dd>
        <dt>malla de la DOS</dt><dd>${mq}×${mq}×${mq}</dd><dt>máx |Φ⁻ − Φ⁺|/2</dt><dd>${fmt(asym, 3)} eV/Å²</dd></dl>
        ${neg ? `<div class="callout warn">${neg} frecuencias imaginarias (dibujadas negativas) a lo largo del camino. Lo usual es una geometría no relajada, una supercelda pequeña o una tolerancia de SCF o malla insuficiente.</div>` : ''}`;
      msg(`Listo: ${esc(fcF.name)} con ${esc(stF.name)}.`);
    } catch (e) { msg('No se pudo calcular: ' + esc(e.message), true); }
  }
  let uDraw = null;

  const draw = () => { drawDisp(); drawDos(); drawPhi(); uDraw?.(); };
  onTheme(() => { draw(); setupViewer(); }); draw();
  setupViewer(); setMode(); frame();
  mount.destroy = () => { cancelAnimationFrame(raf); V?.destroy(); V = null; };
}
export function destroy(){ mount.destroy?.(); }
