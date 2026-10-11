// Aprender 14 · Fuerzas, estrés y relajación (SIESTA 5.4.2, LDA/DZP).
// Fuerza frente a −dE/dr en H₂O (Hellmann–Feynman + Pulay), egg-box, tolerancia del SCF; relajaciones CG/Broyden/FIRE de H₂O
// y CG de la vacancia en Si (64 − 1 átomos) en 3D; E(a) con estrés y celda variable. Lector de la relajación del usuario (.out o .ANI).
import { $, $$, css, alpha, onTheme, fmt, esc, seg, downloadText } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import { createViewer } from '../core/three-view.js';
import { parseOut, parseANI } from '../siesta/index.js';
import { colorOf, covalentRadius, atomicNumber } from '../crystal/elements.js';
import D from '../data/fuerzas.json';

// H₂O gas: Benedict, Gailar y Plyler, J. Chem. Phys. 24, 1139 (1956). Si: a = 5.431 Å, B₀ = 98 GPa (los mismos que la sección 4).
// Vacancia: Dannefaer, Mascher y Kerr, PRL 56, 2195 (1986), aniquilación de positrones.
const EXP = { rOH: 0.9572, ang: 104.52, aSi: 5.431, BSi: 98, Ef: 3.6 };
const GPA = 0.1;                    // 1 kbar = 0.1 GPa
const EVA3_GPA = 160.21766;         // 1 eV/Å³ = 160.2 GPa
const METH = { cg: 'CG', broyden: 'Broyden', fire: 'FIRE' };
const SETS = { dzp300: 'DZP, 300 Ry', dzp60: 'DZP, 60 Ry', sz300: 'SZ, 300 Ry' };
const ESETS = { dzp300: 'DZP, 300 Ry', dzp100: 'DZP, 100 Ry', sz300: 'SZ, 300 Ry' };

const sub = (a, b) => a.map((x, i) => x - b[i]), nrm = a => Math.hypot(...a), dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const angle = (c, i, j, k) => { const u = sub(c[i], c[j]), v = sub(c[k], c[j]); return Math.acos(dot(u, v) / nrm(u) / nrm(v)) * 180 / Math.PI; };
const yl = (v, pad = 0.08) => { const a = Math.min(...v), b = Math.max(...v), d = (b - a) || 1; return [a - pad * d, b + pad * d]; };
const near = (arr, x) => { let b = 0; for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - x) < Math.abs(arr[b] - x)) b = i; return b; };

// ---- Birch–Murnaghan de 3er orden: E es un polinomio cúbico en x = V^(−2/3) ----
function bm(V, E){
  const x = V.map(v => Math.pow(v, -2 / 3)), n = 4, A = Array.from({ length: n }, () => Array(n + 1).fill(0));
  x.forEach((xi, k) => { const p = [1, xi, xi * xi, xi ** 3]; for (let i = 0; i < n; i++){ for (let j = 0; j < n; j++) A[i][j] += p[i] * p[j]; A[i][n] += p[i] * E[k]; } });
  for (let i = 0; i < n; i++){ let m = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r; [A[i], A[m]] = [A[m], A[i]];
    for (let r = 0; r < n; r++) if (r !== i){ const f = A[r][i] / A[i][i]; for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c]; } }
  const c = A.map((r, i) => r[n] / r[i]);
  const e = X => c[0] + c[1] * X + c[2] * X * X + c[3] * X ** 3, d1 = X => c[1] + 2 * c[2] * X + 3 * c[3] * X * X, d2 = X => 2 * c[2] + 6 * c[3] * X;
  // dE/dx = 0 → mínimo (x0 entre los datos)
  const disc = (2 * c[2]) ** 2 - 12 * c[3] * c[1], roots = [(-2 * c[2] + Math.sqrt(disc)) / (6 * c[3]), (-2 * c[2] - Math.sqrt(disc)) / (6 * c[3])];
  const x0 = roots.find(r => d2(r) > 0), V0 = Math.pow(x0, -1.5);
  const EV = v => e(Math.pow(v, -2 / 3));
  const dEdV = v => d1(Math.pow(v, -2 / 3)) * (-2 / 3) * Math.pow(v, -5 / 3);
  const d2EdV2 = v => { const X = Math.pow(v, -2 / 3), dx = (-2 / 3) * Math.pow(v, -5 / 3), ddx = (10 / 9) * Math.pow(v, -8 / 3); return d2(X) * dx * dx + d1(X) * ddx; };
  const B0 = V0 * d2EdV2(V0) * EVA3_GPA;
  const rms = Math.sqrt(E.reduce((s, y, k) => s + (y - EV(V[k])) ** 2, 0) / E.length);
  return { V0, E0: EV(V0), B0, EV, P: v => -dEdV(v) * EVA3_GPA, rms };
}
// mínimos cuadrados polinomiales, coeficientes c[0] + c[1] x + …
function polyfit(x, y, deg){ const n = deg + 1, A = Array.from({ length: n }, () => Array(n + 1).fill(0));
  x.forEach((xi, k) => { for (let i = 0; i < n; i++){ for (let j = 0; j < n; j++) A[i][j] += xi ** (i + j); A[i][n] += xi ** i * y[k]; } });
  for (let i = 0; i < n; i++) for (let r = 0; r < n; r++) if (r !== i){ const f = A[r][i] / A[i][i]; for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c]; }
  return A.map((r, i) => r[n] / r[i]); }
const aOfV = V => Math.cbrt(4 * V);       // fcc: V = a³/4 por celda primitiva

function theory(){ return `
  <h3>Teorema de Hellmann–Feynman</h3>
  <p>La fuerza sobre el núcleo I es F<sub>I</sub> = −dE/dR<sub>I</sub>. Si ψ es autofunción exacta de H, la derivada solo actúa sobre la dependencia explícita de H en R<sub>I</sub>:</p>
  <div class="eq">F<sub>I</sub><sup>HF</sup> = −⟨ψ|∂H/∂R<sub>I</sub>|ψ⟩ = −∫ ρ(r) ∂V<sub>ext</sub>(r)/∂R<sub>I</sub> dr − ∂E<sub>II</sub>/∂R<sub>I</sub></div>
  <p>Es una fuerza electrostática clásica: la nube ρ y los demás núcleos tiran del núcleo I. No hace falta derivar la función de onda.</p>
  <h3>Fuerzas de Pulay</h3>
  <p>En SIESTA ψ<sub>n</sub> = Σ c<sub>nμ</sub> φ<sub>μ</sub>(r − R<sub>I</sub>): los orbitales atómicos numéricos (PAO) viajan con su átomo. La autoconsistencia anula ∂E/∂c, pero no la derivada respecto de la propia base, y aparece un término extra (Pulay, 1969):</p>
  <div class="eq">F<sub>I</sub> = F<sub>I</sub><sup>HF</sup> − Σ<sub>μν</sub> ρ<sub>μν</sub> ⟨∂φ<sub>μ</sub>/∂R<sub>I</sub>|H|φ<sub>ν</sub>⟩ + Σ<sub>μν</sub> E<sub>μν</sub> ⟨∂φ<sub>μ</sub>/∂R<sub>I</sub>|φ<sub>ν</sub>⟩ + c.c.</div>
  <p>ρ<sub>μν</sub> es la matriz densidad y E<sub>μν</sub> la matriz densidad de energía (energy-density matrix). Con una base completa o fija en el espacio, como las ondas planas, este término desaparece; con una base local es del mismo orden que la fuerza y no se puede omitir. SIESTA calcula la derivada completa de su energía, con Pulay incluido. SIESTA no permite apagar ese término, así que aquí no se muestra su tamaño; lo que sí se mide es que la fuerza impresa coincide con −dE/dr numérico.</p>
  <h3>La malla rompe la invariancia de traslación</h3>
  <p>V<sub>H</sub> y V<sub>xc</sub> se integran en una malla fija al espacio, no a los átomos. Al trasladar toda la molécula la energía oscila con el periodo de la malla (efecto egg-box) y la suma de las fuerzas deja de ser cero. Se reduce subiendo <code>MeshCutoff</code>.</p>
  <h3>Tolerancia del SCF</h3>
  <p>La energía de Kohn–Sham es variacional: un error δρ en la densidad la cambia en orden δρ². La fuerza no lo es y su error es de orden δρ. Por eso una tolerancia que basta para energías puede no bastar para fuerzas, y menos para fonones.</p>
  <h3>Estrés</h3>
  <p>Al deformar la celda con una deformación ε (strain), la energía cambia y el tensor de estrés es</p>
  <div class="eq">σ<sub>αβ</sub> = (1/Ω) ∂E/∂ε<sub>αβ</sub>,  P = −Tr σ / 3 = −dE/dV</div>
  <p>(Nielsen y Martin, 1985). En ondas planas con número de ondas fijo aparece un estrés de Pulay espurio; en SIESTA la base se deforma con los átomos y su derivada se incluye, como en las fuerzas. La presión de una sola corrida dice hacia dónde quiere ir la celda sin calcular la curva E(V) entera.</p>
  <h3>Relajación</h3>
  <p>Buscar el mínimo de E(R) es una optimización en 3N variables con el gradiente −F. SIESTA ofrece (<code>MD.TypeOfRun</code>):</p>
  <p><b>CG</b>: gradientes conjugados, minimizaciones en línea a lo largo de direcciones conjugadas. <b>Broyden</b>: cuasi-Newton; construye una aproximación al inverso de la hessiana a partir de las fuerzas de los pasos anteriores. <b>FIRE</b> (Fast Inertial Relaxation Engine, Bitzek et al. 2006): dinámica molecular amortiguada que mezcla la velocidad con la dirección de la fuerza y adapta el paso de tiempo.</p>
  <p>Termina cuando todas las componentes de fuerza bajan de <code>MD.MaxForceTol</code> (0.04 eV/Å por omisión) y, con <code>MD.VariableCell true</code>, el estrés baja de <code>MD.MaxStressTol</code> (1 GPa por omisión). <code>MD.MaxDispl</code> (0.2 Bohr) limita cada paso.</p>
  <h3>Vacancia y energía de formación</h3>
  <div class="eq">E<sub>f</sub> = E(N − 1) − (N − 1)/N · E(N)</div>
  <p>Al quitar un átomo, sus cuatro vecinos quedan con un enlace colgante cada uno. Se acercan entre sí y pueden emparejarse, bajando la simetría de T<sub>d</sub> a D<sub>2d</sub> (distorsión de Jahn–Teller). Una geometría inicial perfectamente simétrica nunca rompe la simetría, porque las fuerzas la conservan; por eso se perturban los vecinos al inicio. El resultado depende del tamaño de la supercelda y de la malla k (Puska et al. 1998); 64 átomos con k 2×2×2 es un punto de partida, no un valor convergido.</p>
  <p class="src">Hellmann, <i>Einführung in die Quantenchemie</i> (1937) · Feynman, Phys. Rev. 56, 340 (1939) · Pulay, Mol. Phys. 17, 197 (1969) · Nielsen y Martin, PRB 32, 3780 (1985) · Francis y Payne, J. Phys.: Condens. Matter 2, 4395 (1990) · Soler et al., J. Phys.: Condens. Matter 14, 2745 (2002) (fuerzas y estrés en SIESTA) · Bitzek, Koskinen, Gähler, Moseler y Gumbsch, PRL 97, 170201 (2006) · Johnson, PRB 38, 12807 (1988) (Broyden modificado) · Puska, Pöykkö, Pesola y Nieminen, PRB 58, 1318 (1998) · Dannefaer, Mascher y Kerr, PRL 56, 2195 (1986) · Benedict, Gailar y Plyler, J. Chem. Phys. 24, 1139 (1956) · manual de SIESTA 5.4, «Structural relaxation».</p>`; }

// ---- visor de trayectorias: átomos, enlaces, estelas y un marcador opcional ----
function trajViewer(host, camera){
  let V = null, g = null, gt = null, spec = null, meshes = [], bms = [], up = null;
  const build = () => {
    if (!V){ V = createViewer(host, { camera }); g = V.group(); gt = V.group(); } else { V.clear(g); V.clear(gt); }
    if (!spec) return;
    const T = V.THREE; up = new T.Vector3(0, 1, 0);
    const geo = {}, mat = {};
    meshes = spec.Z.map((z, i) => { const r = spec.radius(z), col = spec.color(z, i), k = r.toFixed(2);
      geo[k] = geo[k] || new T.SphereGeometry(r, 20, 14); mat[col] = mat[col] || new T.MeshStandardMaterial({ color: new T.Color(col), roughness: .45 });
      const m = new T.Mesh(geo[k], mat[col]); g.add(m); return m; });
    const cg = new T.CylinderGeometry(spec.bondR || 0.09, spec.bondR || 0.09, 1, 8), bm = new T.MeshStandardMaterial({ color: new T.Color(css('--faint')), roughness: .6 });
    bms = spec.bonds.map(() => { const m = new T.Mesh(cg, bm); g.add(m); return m; });
    if (spec.cell){ const c = spec.center, P = [[0, 0, 0], ...spec.cell, [0, 1], [0, 2], [1, 2], [0, 1, 2]].map((x, k) => k === 0 ? [0, 0, 0] : k <= 3 ? x : x.reduce((s, j) => s.map((v, q) => v + spec.cell[j][q]), [0, 0, 0]));
      const E = [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 4], [2, 6], [3, 5], [3, 6], [4, 7], [5, 7], [6, 7]], pts = [];
      E.forEach(([i, j]) => pts.push(new T.Vector3(...sub(P[i], c)), new T.Vector3(...sub(P[j], c))));
      g.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: new T.Color(css('--line')) }))); }
    if (spec.marker){ const m = new T.Mesh(new T.SphereGeometry(spec.marker.r, 24, 16), new T.MeshBasicMaterial({ color: new T.Color(css('--bad')), transparent: true, opacity: .22, depthWrite: false }));
      m.position.set(...sub(spec.marker.pos, spec.center)); g.add(m); }
  };
  const show = (fi) => {
    if (!V || !spec) return; const T = V.THREE, pos = spec.pos(fi), c = spec.center;
    pos.forEach((p, i) => meshes[i].position.set(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
    spec.bonds.forEach(([i, j], b) => { const A = new T.Vector3(...sub(pos[i], c)), B = new T.Vector3(...sub(pos[j], c)), d = B.clone().sub(A), L = d.length(), m = bms[b];
      m.visible = L < spec.bondMax; m.position.copy(A.add(B).multiplyScalar(.5)); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(up, d.normalize()); });
    V.clear(gt);
    if (spec.trail?.length && fi > 0){ const lm = new T.LineBasicMaterial({ color: new T.Color(css('--accent')) });
      for (const i of spec.trail){ const pts = []; for (let f = 0; f <= fi; f++) pts.push(new T.Vector3(...sub(spec.pos(f)[i], c)));
        gt.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), lm)); } }
  };
  // encuadre automático: distancia de cámara según la extensión de la estructura
  const fit = () => { if (!spec?.fit) return; const P = spec.pos(0).map(p => sub(p, spec.center)); if (spec.cell) for (const v of spec.cell) P.push(sub(v, spec.center));
    const R = Math.max(2, ...P.map(nrm)); const d = [0.62, 0.42, 0.66], k = 3.2 * R / nrm(d); V.view(d.map(x => x * k)); };
  return { set(s){ spec = s; build(); fit(); }, rebuild: build, show, destroy(){ V?.destroy(); V = null; } };
}
const bondsByDistance = (Z, pos, scale = 1.2) => { const b = []; for (let i = 0; i < Z.length; i++) for (let j = i + 1; j < Z.length; j++)
  if (nrm(sub(pos[i], pos[j])) < scale * (covalentRadius(Z[i]) + covalentRadius(Z[j]))) b.push([i, j]); return b; };

export function mount(root){
  // ---------- números derivados ----------
  const hfStats = {}; for (const k of Object.keys(SETS)){ const H = D.hf[k], dd = [];
    // derivada de 5 puntos (error h⁴); la de 3 puntos se guarda para mostrar su error de truncamiento (h²)
    const h = H.r[1] - H.r[0]; let max3 = 0;
    for (let i = 1; i < H.r.length - 1; i++) max3 = Math.max(max3, Math.abs(H.F[i] + (H.E[i + 1] - H.E[i - 1]) / (2 * h)));
    for (let i = 2; i < H.r.length - 2; i++) dd.push({ r: H.r[i], mdE: -(-H.E[i + 2] + 8 * H.E[i + 1] - 8 * H.E[i - 1] + H.E[i - 2]) / (12 * h), F: H.F[i] });
    hfStats[k] = { dd, max: Math.max(...dd.map(x => Math.abs(x.F - x.mdE))), max3, Fnet: Math.max(...H.Fnet) }; }
  const eggStats = {}; for (const k of ['m60', 'm300']){ const G = D.egg[k]; eggStats[k] = { dE: (Math.max(...G.E) - Math.min(...G.E)) * 1000, F: Math.max(...G.Fnet.map(Math.abs)) }; }
  const tref = D.tol.find(t => t.tol === 1e-7) || D.tol.at(-1);
  const tolRows = D.tol.filter(t => t !== tref).map(t => ({ tol: t.tol, dF: nrm(sub(t.F, tref.F)), dE: Math.abs(t.E - tref.E), it: t.it }));
  const geo = m => { const c = D.h2o[m].steps.at(-1).pos; return { r1: nrm(sub(c[1], c[0])), r2: nrm(sub(c[2], c[0])), ang: angle(c, 1, 0, 2) }; };
  const g0 = (() => { const c = D.h2o.cg.steps[0].pos; return { r1: nrm(sub(c[1], c[0])), r2: nrm(sub(c[2], c[0])), ang: angle(c, 1, 0, 2) }; })();
  const N = D.vac.nAtoms + 1, Ef0 = D.vac.Eunrel - (N - 1) / N * D.vac.Ebulk, Ef = D.vac.steps.at(-1).E - (N - 1) / N * D.vac.Ebulk;
  const fits = {}; for (const k of Object.keys(ESETS)){ const S = D.eos[k]; const f = bm(S.V, S.E);
    // presión del estrés: P(V) = 0 por interpolación lineal y B = −V dP/dV
    let aP = NaN; for (let i = 0; i < S.P.length - 1; i++) if (S.P[i] * S.P[i + 1] <= 0){ const t = S.P[i] / (S.P[i] - S.P[i + 1]); aP = S.a[i] + t * (S.a[i + 1] - S.a[i]); }
    const q = polyfit(S.V, S.P.map(p => p * GPA), 2), VP = aP ** 3 / 4, BP = -VP * (q[1] + 2 * q[2] * VP);
    const dP = Math.max(...S.V.map((v, i) => Math.abs(S.P[i] * GPA - f.P(v))));
    fits[k] = { ...f, a0: aOfV(f.V0), aP, BP, dP }; }
  const VC = D.eos.vc.steps;

  // vacancia: centrar el hueco en la celda (origen → centro), envolviendo cada átomo según su posición ideal
  const Lc = D.vac.cell, Lx = [0, 1, 2].map(k => Lc[k][k]), half = Lx.map(x => x / 2);
  const shiftOf = D.vac.ideal.map(p => p.map((x, k) => { const y = x + half[k]; return y >= Lx[k] - 1e-3 ? -Lx[k] : y < -1e-3 ? Lx[k] : 0; }));
  const vpos = (f, amp = 1) => D.vac.steps[f].pos.map((p, i) => p.map((x, k) => { const id = D.vac.ideal[i][k], d = x - id; return id + half[k] + shiftOf[i][k] + amp * d; }));
  const vacC = half.slice();
  const nb = D.vac.ideal.map((p, i) => [i, nrm(p.map((x, k) => { const y = x % Lx[k]; return Math.min(Math.abs(y), Lx[k] - Math.abs(y)); }))]).filter(x => x[1] < 2.5).map(x => x[0]);
  const nbInfo = f => { const P = vpos(f), d = []; for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) d.push(nrm(sub(P[nb[a]], P[nb[b]])));
    const r = nb.map(i => nrm(sub(P[i], vacC))); return { d: d.sort((x, y) => x - y), r }; };
  const nb0 = nbInfo(0), nbF = nbInfo(D.vac.steps.length - 1);
  const vbonds = bondsByDistance(Array(D.vac.nAtoms).fill(14), vpos(0), 1.15);

  root.innerHTML = `
  <div class="pghead"><div>
    <div class="kicker">Aprender · 14</div><h1>Fuerzas, estrés y relajación</h1>
    <p class="lede">La fuerza que imprime SIESTA coincide con −dE/dr numérico hasta ${fmt(hfStats.dzp300.max * 1000, 1)} meV/Å en H₂O, porque incluye el término de Pulay de su base local. Con esas fuerzas el agua se relaja en ${D.h2o.broyden.steps.length - 1} pasos con Broyden, la vacancia del Si baja ${fmt((Ef0 - Ef) * 1000, 0)} meV al relajarse (E<sub>f</sub> = ${fmt(Ef, 2)} eV) y el estrés da la red de equilibrio ${fmt(fits.dzp300.aP, 3)} Å sin trazar E(V).</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">

      <section class="panel wide"><div class="ph"><h2>Fuerza frente a −dE/dr</h2><div class="seg" id="hfSel">${Object.entries(SETS).map(([k, l]) => `<button data-v="${k}">${l}</button>`).join('')}</div></div>
        <div class="pb"><div class="split2"><div><canvas data-export="H2O_E_r" id="cvHE" style="height:260px"></canvas><div class="readout" id="rdHE"></div></div>
          <div><canvas data-export="H2O_fuerza_vs_dEdr" id="cvHF" style="height:260px"></canvas><div class="readout" id="rdHF"></div></div></div>
        <p class="note">Se estira un enlace O–H del agua de ${fmt(D.hf.dzp300.r[0], 2)} a ${fmt(D.hf.dzp300.r.at(-1), 2)} Å con el otro H y el ángulo fijos (geometría experimental, 104.52°). La línea es la componente de la fuerza sobre el H a lo largo del enlace, tal como la imprime SIESTA; los puntos son −dE/dr calculado aquí con la fórmula centrada de 5 puntos sobre las energías de corridas vecinas (paso ${fmt(D.hf.dzp300.r[1] - D.hf.dzp300.r[0], 3)} Å). Con la fórmula de 3 puntos la diferencia sube a ${fmt(hfStats.dzp300.max3 * 1000, 0)} meV/Å: no es un error de SIESTA sino de truncamiento de la diferencia finita, porque el enlace es muy anarmónico. Si faltara el término de Pulay no coincidirían (inferencia: SIESTA no permite apagarlo).</p>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>base y malla</th><th>máx |F + dE/dr| (5 puntos)</th><th>r de equilibrio del barrido</th><th>máx |Σ F| (fuerza neta)</th></tr></thead><tbody>
        ${Object.entries(SETS).map(([k, l]) => { const H = D.hf[k]; let i0 = 0; for (let i = 0; i < H.F.length - 1; i++) if (H.F[i] * H.F[i + 1] <= 0) i0 = i; const t = H.F[i0] / (H.F[i0] - H.F[i0 + 1]);
          return `<tr><td>${l}</td><td>${fmt(hfStats[k].max * 1000, 1)} meV/Å</td><td>${fmt(H.r[i0] + t * (H.r[i0 + 1] - H.r[i0]), 4)} Å</td><td>${fmt(hfStats[k].Fnet * 1000, 1)} meV/Å</td></tr>`; }).join('')}</tbody></table></div>
        <p class="note">El residuo que queda viene del truncamiento que aún tiene la fórmula de 5 puntos y de la precisión de las energías (10⁻⁶ eV en el .out). Con 60 Ry la fuerza sigue siendo coherente con la energía en este barrido, pero la fuerza neta sobre la molécula ya no es cero (ver egg-box). La base SZ da otra curva E(r) y otro equilibrio, pero sus fuerzas son igual de coherentes con su propia energía: coherente no quiere decir exacto.</p></div></section>

      <section class="panel"><div class="ph"><h2>Egg-box: trasladar la molécula</h2></div>
        <div class="pb"><canvas data-export="H2O_eggbox" id="cvEgg" style="height:250px"></canvas><div class="readout" id="rdEgg"></div>
        <p class="note">La molécula entera se desplaza en x de 0 a ${fmt(D.egg.m60.s.at(-1), 2)} Å. Físicamente nada cambia. Con 60 Ry (malla de ${fmt(D.egg.m60.h, 3)} Å) la energía oscila ${fmt(eggStats.m60.dE, 1)} meV y la fuerza neta llega a ${fmt(eggStats.m60.F * 1000, 0)} meV/Å; con 300 Ry (${fmt(D.egg.m300.h, 3)} Å), ${fmt(eggStats.m300.dE, 2)} meV y ${fmt(eggStats.m300.F * 1000, 1)} meV/Å. La línea discontinua marca un paso de la malla de 60 Ry.</p></div></section>

      <section class="panel"><div class="ph"><h2>Tolerancia del SCF</h2></div>
        <div class="pb"><canvas data-export="H2O_DM_Tolerance" id="cvTol" style="height:250px"></canvas><div class="readout" id="rdTol"></div>
        <p class="note">Error de la fuerza sobre el H estirado (r = 1.05 Å) y de la energía frente a una corrida con <code>DM.Tolerance</code> = 10⁻⁷. La energía converge más rápido que la fuerza, como predice el argumento variacional. Con el valor por omisión de SIESTA 5 (10⁻⁴) el error de la fuerza es ${fmt((tolRows.find(t => t.tol === 1e-4)?.dF ?? NaN) * 1000, 2)} meV/Å, de sobra para relajar con 0.01 eV/Å.</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Relajación de H₂O: CG, Broyden y FIRE</h2><div class="seg" id="mSel">${Object.entries(METH).map(([k, l]) => `<button data-v="${k}">${l}</button>`).join('')}</div></div>
        <div class="pb"><div class="split2"><div><div class="three" id="h3" style="height:300px"></div>
            <div class="btnrow"><label class="sl">paso <input type="range" id="hStep" min="0" max="1" step="1" value="0"><output id="hStepO"></output></label><button class="tiny" id="hPlay">animar</button></div>
            <div class="readout" id="rdH3"></div></div>
          <div><canvas data-export="H2O_relajacion" id="cvRel" style="height:300px"></canvas><div class="readout" id="rdRel"></div></div></div>
        <p class="note">Las tres corridas parten de la misma geometría torcida (O–H ${fmt(g0.r1, 2)} y ${fmt(g0.r2, 2)} Å, ángulo ${fmt(g0.ang, 0)}°) y paran cuando toda componente de fuerza es menor que 0.01 eV/Å. La gráfica muestra E − E<sub>final</sub> en escala logarítmica; la fuerza máxima de cada paso aparece al pasar el cursor. La línea de color en 3D es el camino de cada átomo. Clic en la gráfica elige el paso.</p>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>método</th><th>pasos</th><th>iteraciones SCF</th><th>tiempo</th><th>O–H (Å)</th><th>H–O–H</th></tr></thead><tbody>
        ${Object.entries(METH).map(([k, l]) => { const G = geo(k), R = D.h2o[k]; return `<tr><td>${l}</td><td>${R.steps.length - 1}</td><td>${R.nscf}</td><td>${R.wall != null ? fmt(R.wall, 0) + ' s' : '—'}</td><td>${fmt(G.r1, 4)} / ${fmt(G.r2, 4)}</td><td>${fmt(G.ang, 2)}°</td></tr>`; }).join('')}
        <tr><td>experimento</td><td></td><td></td><td></td><td>${EXP.rOH}</td><td>${EXP.ang}°</td></tr></tbody></table></div>
        <p class="note">Las tres llegan a la misma geometría dentro de la tolerancia. El O–H sale ${fmt(100 * (geo('cg').r1 - EXP.rOH) / EXP.rOH, 1)} % más largo que el experimento: LDA con esta base DZP (PAO.EnergyShift por omisión, orbitales cortos) alarga el enlace; el ángulo queda a ${fmt(Math.abs(geo('cg').ang - EXP.ang), 1)}°. Que un método tome menos pasos aquí no es una regla general: depende de la geometría inicial y de la forma de la superficie de energía (inferencia).</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Vacancia en Si: 63 átomos relajados con CG</h2></div>
        <div class="pb"><div class="split2"><div><div class="three" id="v3" style="height:340px"></div>
            <div class="btnrow"><label class="sl">paso <input type="range" id="vStep" min="0" max="${D.vac.steps.length - 1}" step="1" value="${D.vac.steps.length - 1}"><output id="vStepO"></output></label>
              <label class="sl">desplazamiento × <input type="range" id="vAmp" min="1" max="10" step="1" value="5"><output id="vAmpO">5</output></label></div>
            <div class="readout" id="rdV3"></div></div>
          <div><canvas data-export="Si_vacancia_relajacion" id="cvVac" style="height:340px"></canvas><div class="readout" id="rdVac"></div></div></div>
        <dl class="kv"><dt>E<sub>f</sub> sin relajar</dt><dd>${fmt(Ef0, 3)} eV</dd><dt>E<sub>f</sub> relajada</dt><dd>${fmt(Ef, 3)} eV</dd><dt>energía de relajación</dt><dd>${fmt((Ef0 - Ef) * 1000, 0)} meV</dd>
          <dt>experimento</dt><dd>${EXP.Ef} ± 0.2 eV (positrones)</dd><dt>vecinos: distancia al hueco</dt><dd>${fmt(nb0.r[0], 3)} → ${nbF.r.map(x => fmt(x, 3)).join(', ')} Å</dd>
          <dt>distancias entre los 4 vecinos</dt><dd>${fmt(nb0.d[0], 3)} → ${nbF.d.map(x => fmt(x, 3)).join(', ')} Å</dd>
          <dt>pasos / SCF / tiempo</dt><dd>${D.vac.steps.length - 1} / ${D.vac.nscf} / ${fmt((D.vac.wall.relax || 0) / 60, 0)} min</dd></dl>
        <p class="note">Supercelda cúbica 2×2×2 (a = 5.396 Å, el mínimo propio de esta base, el mismo de Fonones) sin el átomo del origen; el hueco se dibuja en el centro como una esfera roja translúcida y sus cuatro vecinos en color de acento. Los desplazamientos respecto de la red perfecta se exageran con el deslizador. Los vecinos empezaron con desplazamientos aleatorios de hasta 0.02 Å para que la simetría pudiera romperse. La energía de formación sale de esta misma corrida y de la del cristal perfecto de 64 átomos con la misma malla k; con 64 átomos y k 2×2×2 no está convergida en tamaño (Puska et al. 1998), así que la comparación con el experimento es solo de orden de magnitud.</p>
        <p class="note">${(() => { const sp = nbF.d.at(-1) - nbF.d[0], up = D.vac.steps.map((x, i) => i && x.E > D.vac.steps[i - 1].E ? i : 0).filter(Boolean);
          return `Los cuatro vecinos se acercan al hueco ${fmt(nb0.r[0] - nbF.r.reduce((a, b) => a + b, 0) / 4, 2)} Å en promedio. Las seis distancias entre ellos quedan dentro de ${fmt(sp * 1000, 0)} mÅ: en esta celda y con esta malla k la relajación es casi simétrica (T<sub>d</sub>) y el emparejamiento D<sub>2d</sub> que describe la teoría no aparece de forma clara. Los cálculos que lo encuentran usan superceldas mayores o más puntos k (Puska et al. 1998). ${up.length ? `La energía sube en ${up.length === 1 ? 'el paso' : 'los pasos'} ${up.join(' y ')}: el CG de SIESTA prueba pasos a lo largo de una línea y retrocede cuando se pasa del mínimo.` : ''}`; })()}</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Ecuación de estado con estrés</h2><div class="seg" id="eSel">${Object.entries(ESETS).map(([k, l]) => `<button data-v="${k}">${l}</button>`).join('')}</div></div>
        <div class="pb"><div class="split2"><div><canvas data-export="Si_E_a" id="cvEa" style="height:280px"></canvas><div class="readout" id="rdEa"></div></div>
          <div><canvas data-export="Si_P_V" id="cvPV" style="height:280px"></canvas><div class="readout" id="rdPV"></div></div></div>
        <p class="note">Si con 2 átomos, k 8×8×8. Izquierda: energía de ${D.eos.dzp300.a.length} corridas y su ajuste Birch–Murnaghan. Derecha: la presión que imprime SIESTA a partir del tensor de estrés (puntos) frente a −dE/dV del ajuste (línea). Si el estrés es coherente con la energía ambas coinciden y la presión cruza cero en el mínimo de E.</p>
        <div class="tblwrap"><table class="tbl"><thead><tr><th></th><th>a₀ de E(V)</th><th>a con P = 0</th><th>B₀ de E(V)</th><th>B de P(V) en P = 0</th><th>máx |P − (−dE/dV)|</th></tr></thead><tbody>
        ${Object.entries(ESETS).map(([k, l]) => { const f = fits[k]; return `<tr><td>${l}</td><td>${fmt(f.a0, 4)} Å</td><td>${fmt(f.aP, 4)} Å</td><td>${fmt(f.B0, 1)} GPa</td><td>${fmt(f.BP, 1)} GPa</td><td>${fmt(f.dP, 2)} GPa</td></tr>`; }).join('')}
        <tr><td>experimento</td><td>${EXP.aSi} Å</td><td></td><td>${EXP.BSi} GPa</td><td></td><td></td></tr></tbody></table></div>
        <p class="note" id="ntEos"></p></div></section>

      <section class="panel"><div class="ph"><h2>Celda variable</h2></div>
        <div class="pb"><canvas data-export="Si_celda_variable" id="cvVC" style="height:260px"></canvas><div class="readout" id="rdVC"></div>
        <p class="note">La misma celda de 2 átomos, empezando en a = ${fmt(VC[0].a, 2)} Å con <code>MD.VariableCell true</code> y CG hasta que el estrés baja de 0.05 GPa. En ${VC.length - 1} pasos llega a a = ${fmt(VC.at(-1).a, 4)} Å (presión ${fmt(VC.at(-1).P * GPA, 3)} GPa), frente a ${fmt(fits.dzp300.a0, 4)} Å del ajuste de E(V). Solo el estrés guía el cambio de celda: las fuerzas sobre los átomos son nulas por simetría. a se calcula del volumen, a = (4V)<sup>⅓</sup>.</p>
        <p class="note">${(() => { const k = VC.reduce((b, s, i) => s.sh > VC[b].sh ? i : b, 0); return VC[k].sh * GPA > 1 ? `En el paso ${k} la celda deja de ser cúbica: el CG mueve también los ángulos y la celda se cizalla (estrés cortante de ${fmt(VC[k].sh * GPA, 1)} GPa, presión ${fmt(VC[k].P * GPA, 1)} GPa). El paso siguiente lo corrige. Las componentes cortantes del estrés eran pequeñas pero no nulas (malla de integración y puntos k), y el optimizador las sigue; con <code>%block GeometryConstraints</code> o restringiendo la deformación se evita.` : ''; })()}</p></div></section>

      <section class="panel"><div class="ph"><h2>Descargar las entradas</h2></div>
        <div class="pb"><p class="note">Los .fdf de estas corridas, listos para SIESTA 5.4.2 (copiar los pseudopotenciales al lado).</p>
        <div class="btnrow"><button class="tiny" data-dl="h2o">H₂O, relajación CG</button><button class="tiny" data-dl="vac">Si, vacancia CG</button><button class="tiny" data-dl="vc">Si, celda variable</button></div>
        <p class="note">Para fuerzas fiables: <code>DM.Tolerance</code> 10⁻⁵ o menos, <code>MeshCutoff</code> de 200 Ry o más y revisar que la fuerza neta (línea «Tot» de las fuerzas en el .out) sea pequeña frente a <code>MD.MaxForceTol</code>.</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Tu relajación</h2></div>
        <div class="pb"><label class="drop" id="uDrop"><input type="file" id="uIn" hidden>Arrastra aquí el <b>.out</b> de una relajación o dinámica de SIESTA (o un <b>.ANI</b>), o haz clic. Se lee en el navegador; nada se envía.</label>
        <div id="uMsg" class="note"></div>
        <div id="uOut" hidden><div class="split2"><div><div class="three" id="u3" style="height:320px"></div>
            <div class="btnrow"><label class="sl">paso <input type="range" id="uStep" min="0" max="1" step="1" value="0"><output id="uStepO"></output></label><button class="tiny" id="uPlay">animar</button></div></div>
          <div><canvas data-export="relajacion_usuario" id="cvU" style="height:320px"></canvas><div class="readout" id="rdU"></div></div></div>
          <div id="uTab"></div></div></div></section>
    </div>
  </div>
  <footer class="prov">Procedencia: SIESTA ${esc(D.meta.version)}, ${esc(D.meta.xc)}, base ${D.meta.basis} (salvo donde se indica SZ), MeshCutoff ${D.meta.mesh} Ry salvo donde se indica, diagonalización. Pseudopotenciales: ${esc(D.meta.pseudo.Si)}, ${esc(D.meta.pseudo.O)}, ${esc(D.meta.pseudo.H)}. H₂O en caja cúbica de 10 Å, solo Γ; barrido O–H con DM.Tolerance 10⁻⁶, relajaciones con 10⁻⁵ y MD.MaxForceTol 0.01 eV/Å. Vacancia: supercelda cúbica de 64 átomos, a = 5.396 Å, k 2×2×2 desplazada, DM.Tolerance 10⁻⁵, CG con MD.MaxForceTol 0.02 eV/Å, 3 hilos OpenMP. E(a): celda primitiva, k 8×8×8 desplazada, DM.Tolerance 10⁻⁶, 11 parámetros de red de 5.25 a 5.55 Å. Ajuste Birch–Murnaghan y diferencias finitas en el navegador. Entradas y salidas en corridas/fuerzas.tar.gz; JSON de corridas/fuerzas_gen_json.mjs. Experimento: Benedict et al. (1956) para H₂O; a y B₀ del Si como en la sección 4; Dannefaer et al. (1986) para la vacancia.</footer>`;
  $$('canvas[data-export]', root).forEach(cv => cv.closest('.panel').querySelector('.ph').append(exportBar(cv, cv.dataset.export)));

  const S = { hf: 'dzp300', m: 'broyden', hi: 0, vi: D.vac.steps.length - 1, amp: 5, e: 'dzp300' };
  const mcol = { cg: () => css('--orb-s'), broyden: () => css('--accent'), fire: () => css('--orb-d') };

  // ---- 1. fuerza frente a −dE/dr ----
  const drawHF = () => {
    const H = D.hf[S.hf], st = hfStats[S.hf], Emin = Math.min(...H.E);
    chart($('#cvHE', root), { xlim: [H.r[0], H.r.at(-1)], ylim: yl(H.E.map(e => (e - Emin) * 1000)), xlabel: 'r(O–H) (Å)', ylabel: 'E − E_min (meV)',
      series: [{ d: H.r.map((r, i) => [r, (H.E[i] - Emin) * 1000]), color: css('--accent'), width: 2 }],
      points: H.r.map((r, i) => ({ x: r, y: (H.E[i] - Emin) * 1000, color: css('--accent'), r: 3 })),
      readEl: $('#rdHE', root), read: x => { if (x == null) return `${H.r.length} corridas · ${SETS[S.hf]}`; const i = near(H.r, x); return `r = ${fmt(H.r[i], 3)} Å · E − E_min = ${fmt((H.E[i] - Emin) * 1000, 1)} meV`; } });
    chart($('#cvHF', root), { xlim: [H.r[0], H.r.at(-1)], ylim: yl([...H.F, ...st.dd.map(p => p.mdE)]), xlabel: 'r(O–H) (Å)', ylabel: 'fuerza sobre H a lo largo del enlace (eV/Å)', legend: true,
      series: [{ d: H.r.map((r, i) => [r, H.F[i]]), color: css('--accent'), width: 2, label: 'F de SIESTA' }, { d: [], color: css('--bad'), label: '−dE/dr numérico' }],
      hlines: [{ y: 0, color: css('--faint') }], points: st.dd.map(p => ({ x: p.r, y: p.mdE, color: css('--bad'), r: 4 })),
      readEl: $('#rdHF', root), read: x => { if (x == null) return `máx |F + dE/dr| = ${fmt(st.max * 1000, 1)} meV/Å`; const p = st.dd[near(st.dd.map(d => d.r), x)]; return `r = ${fmt(p.r, 3)} Å · F = ${fmt(p.F, 4)} · −dE/dr = ${fmt(p.mdE, 4)} eV/Å · diferencia ${fmt((p.F - p.mdE) * 1000, 1)} meV/Å`; } });
  };
  // ---- 2. egg-box ----
  const drawEgg = () => {
    const G = D.egg, e = k => G[k].E.map((y, i) => [G[k].s[i], (y - G[k].E[0]) * 1000]);
    const f = k => G[k].Fnet.map((y, i) => [G[k].s[i], y * 1000]);
    const ymax = Math.max(...e('m60').map(p => Math.abs(p[1])), ...f('m60').map(p => Math.abs(p[1]) / 10)) * 1.15;
    chart($('#cvEgg', root), { xlim: [0, G.m60.s.at(-1)], ylim: [-ymax, ymax], xlabel: 'traslación en x (Å)', ylabel: 'ΔE (meV) · fuerza neta /10 (meV/Å)', legend: true,
      series: [{ d: e('m60'), color: css('--bad'), width: 2, label: 'ΔE, 60 Ry' }, { d: f('m60').map(p => [p[0], p[1] / 10]), color: css('--bad'), width: 1.4, dash: [4, 3], label: 'ΣF_x/10, 60 Ry' },
        { d: e('m300'), color: css('--accent'), width: 2, label: 'ΔE, 300 Ry' }, { d: f('m300').map(p => [p[0], p[1] / 10]), color: css('--accent'), width: 1.4, dash: [4, 3], label: 'ΣF_x/10, 300 Ry' }],
      hlines: [{ y: 0, color: css('--faint') }], vlines: [{ x: G.m60.h, label: 'h (60 Ry)', color: css('--faint'), dash: [3, 3] }],
      readEl: $('#rdEgg', root), read: x => { if (x == null) return `mallas: ${G.m60.mesh.join('×')} (60 Ry) y ${G.m300.mesh.join('×')} (300 Ry)`; const i = near(G.m60.s, x);
        return `s = ${fmt(G.m60.s[i], 2)} Å · 60 Ry: ΔE ${fmt((G.m60.E[i] - G.m60.E[0]) * 1000, 2)} meV, ΣF_x ${fmt(G.m60.Fnet[i] * 1000, 1)} meV/Å · 300 Ry: ${fmt((G.m300.E[i] - G.m300.E[0]) * 1000, 2)} meV, ${fmt(G.m300.Fnet[i] * 1000, 2)} meV/Å`; } });
  };
  // ---- 3. tolerancia ----
  const drawTol = () => chart($('#cvTol', root), { logx: true, logy: true, xlim: [Math.min(...tolRows.map(t => t.tol)) / 2, Math.max(...tolRows.map(t => t.tol)) * 2], ylim: [1e-7, 10],
    xlabel: 'DM.Tolerance', ylabel: 'error (eV/Å o eV)', legend: true,
    series: [{ d: tolRows.map(t => [t.tol, Math.max(t.dF, 1e-7)]), color: css('--accent'), width: 2, label: '|ΔF| sobre H (eV/Å)' }, { d: tolRows.map(t => [t.tol, Math.max(t.dE, 1e-7)]), color: css('--orb-d'), width: 2, dash: [5, 3], label: '|ΔE| (eV)' }],
    points: [...tolRows.map(t => ({ x: t.tol, y: Math.max(t.dF, 1e-7), color: css('--accent'), r: 3.5 })), ...tolRows.map(t => ({ x: t.tol, y: Math.max(t.dE, 1e-7), color: css('--orb-d'), r: 3.5 }))],
    hlines: [{ y: 0.01, label: 'MD.MaxForceTol usado', color: css('--faint'), dash: [3, 3] }],
    readEl: $('#rdTol', root), read: x => { if (x == null) return 'referencia: DM.Tolerance = 10⁻⁷'; const t = tolRows[near(tolRows.map(t => Math.log(t.tol)), Math.log(x))]; return `10${String(Math.round(Math.log10(t.tol))).replace('-', '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])} · ${t.it} iteraciones · |ΔF| = ${t.dF.toExponential(1)} eV/Å · |ΔE| = ${t.dE.toExponential(1)} eV`; } });

  // ---- 4. H₂O ----
  const hv = trajViewer($('#h3', root), [0, 0, 6.5]);
  const hSpec = () => { const R = D.h2o[S.m], c = R.steps.at(-1).pos.reduce((a, p) => a.map((x, k) => x + p[k] / 3), [0, 0, 0]);
    return { Z: [8, 1, 1], radius: z => z === 1 ? 0.22 : 0.36, color: z => z === 1 ? css('--muted') : css('--bad'), bonds: [[0, 1], [0, 2]], bondMax: 2, bondR: 0.07,
      center: c, pos: f => R.steps[f].pos, trail: [0, 1, 2] }; };
  const setH = i => { const R = D.h2o[S.m]; S.hi = Math.max(0, Math.min(R.steps.length - 1, i)); $('#hStep', root).value = S.hi; $('#hStepO', root).textContent = S.hi;
    hv.show(S.hi); const c = R.steps[S.hi].pos;
    $('#rdH3', root).innerHTML = `${METH[S.m]} paso ${S.hi}: O–H ${fmt(nrm(sub(c[1], c[0])), 3)} y ${fmt(nrm(sub(c[2], c[0])), 3)} Å, ángulo ${fmt(angle(c, 1, 0, 2), 1)}° · F_máx = ${fmt(R.steps[S.hi].F, 3)} eV/Å`; drawRel(); };
  const drawRel = () => {
    const Ef = Math.min(...Object.keys(METH).map(k => D.h2o[k].steps.at(-1).E)), nmax = Math.max(...Object.keys(METH).map(k => D.h2o[k].steps.length)) - 1;
    const ser = []; for (const k of Object.keys(METH)){ const R = D.h2o[k];
      ser.push({ d: R.steps.map((s, i) => [i, Math.max(s.E - Ef, 1e-6)]), color: mcol[k](), width: k === S.m ? 2.4 : 1.4, label: METH[k] }); }
    chart($('#cvRel', root), { logy: true, xlim: [0, nmax], ylim: [1e-6, 10], xlabel: 'paso de relajación', ylabel: 'E − E_final (eV)', legend: true, series: ser,
      vlines: [{ x: S.hi, color: css('--ink'), dash: [2, 3] }],
      readEl: $('#rdRel', root), read: x => { if (x == null) return 'clic para elegir el paso'; const i = Math.round(x); return Object.keys(METH).map(k => { const s = D.h2o[k].steps[i]; return s ? `${METH[k]}: ${fmt(s.E - Ef, 5)} eV, F_máx ${fmt(s.F, 3)}` : `${METH[k]}: terminó`; }).join(' · '); },
      onclick: x => setH(Math.round(x)) });
  };
  let hTimer = 0;
  $('#hStep', root).addEventListener('input', e => setH(+e.target.value));
  $('#hPlay', root).addEventListener('click', e => { if (hTimer){ clearInterval(hTimer); hTimer = 0; e.target.textContent = 'animar'; return; }
    e.target.textContent = 'pausa'; setH(0); hTimer = setInterval(() => { const n = D.h2o[S.m].steps.length; if (S.hi >= n - 1){ clearInterval(hTimer); hTimer = 0; e.target.textContent = 'animar'; return; } setH(S.hi + 1); }, 260); });
  const initH = () => { $('#hStep', root).max = D.h2o[S.m].steps.length - 1; hv.set(hSpec()); setH(D.h2o[S.m].steps.length - 1); };
  seg($('#mSel', root), S.m, v => { S.m = v; initH(); });

  // ---- 5. vacancia ----
  const vv = trajViewer($('#v3', root), [21, 14, 27]);
  const nbSet = new Set(nb);
  const vSpec = () => ({ Z: Array(D.vac.nAtoms).fill(14), radius: () => 0.38, color: (z, i) => nbSet.has(i) ? css('--accent') : css('--orb-p'),
    bonds: vbonds, bondMax: 2.9, bondR: 0.08, center: vacC, fit: true, cell: [[Lx[0], 0, 0], [0, Lx[1], 0], [0, 0, Lx[2]]],
    pos: f => vpos(f, S.amp), trail: nb, marker: { pos: vacC, r: 0.5 } });
  const setV = i => { S.vi = i; $('#vStep', root).value = i; $('#vStepO', root).textContent = i; vv.show(i); const I = nbInfo(i), s = D.vac.steps[i];
    $('#rdV3', root).innerHTML = `paso ${i}: E − E_final = ${fmt((s.E - D.vac.steps.at(-1).E) * 1000, 1)} meV · F_máx = ${fmt(s.F, 3)} eV/Å · vecinos–hueco ${I.r.map(x => fmt(x, 3)).join(', ')} Å`; drawVac(); };
  const drawVac = () => { const St = D.vac.steps, Ef_ = St.at(-1).E, n = St.length - 1;
    chart($('#cvVac', root), { logy: true, xlim: [0, n], ylim: [1e-4, Math.max(1, ...St.map(s => s.E - Ef_)) * 2], xlabel: 'paso CG', ylabel: 'E − E_final (eV) · F_máx (eV/Å)', legend: true,
      series: [{ d: St.map((s, i) => [i, Math.max(s.E - Ef_, 1e-4)]), color: css('--accent'), width: 2, label: 'E − E_final' }, { d: St.map((s, i) => [i, s.F]), color: css('--orb-d'), width: 1.6, dash: [5, 3], label: 'F_máx' }],
      hlines: [{ y: 0.02, label: 'MD.MaxForceTol', color: css('--faint'), dash: [3, 3] }], vlines: [{ x: S.vi, color: css('--ink'), dash: [2, 3] }],
      readEl: $('#rdVac', root), read: x => { if (x == null) return 'clic para elegir el paso'; const i = Math.max(0, Math.min(n, Math.round(x))); return `paso ${i}: E − E_final = ${fmt((St[i].E - Ef_) * 1000, 2)} meV · F_máx = ${fmt(St[i].F, 4)} eV/Å`; },
      onclick: x => setV(Math.max(0, Math.min(n, Math.round(x)))) }); };
  $('#vStep', root).addEventListener('input', e => setV(+e.target.value));
  $('#vAmp', root).addEventListener('input', e => { S.amp = +e.target.value; $('#vAmpO', root).textContent = S.amp; vv.show(S.vi); });

  // ---- 6. E(V) y estrés ----
  const drawEos = () => {
    const Sx = D.eos[S.e], f = fits[S.e], Emin = f.E0, n = 2;
    const aa = Array.from({ length: 121 }, (_, i) => Sx.a[0] - 0.01 + i * (Sx.a.at(-1) - Sx.a[0] + 0.02) / 120);
    chart($('#cvEa', root), { xlim: [aa[0], aa.at(-1)], ylim: yl([0, ...Sx.E.map(e => (e - Emin) / n * 1000)]), xlabel: 'a (Å)', ylabel: 'E − E₀ (meV/átomo)', legend: true,
      series: [{ d: aa.map(a => [a, (f.EV(a ** 3 / 4) - Emin) / n * 1000]), color: css('--accent'), width: 2, label: 'Birch–Murnaghan' }, { d: [], color: css('--accent'), label: 'SIESTA' }],
      points: Sx.a.map((a, i) => ({ x: a, y: (Sx.E[i] - Emin) / n * 1000, color: css('--accent'), r: 3.5 })),
      vlines: [{ x: f.a0, label: 'a₀', color: css('--accent'), dash: [3, 3] }, { x: EXP.aSi, label: 'exp.', color: css('--bad'), dash: [3, 3] }],
      readEl: $('#rdEa', root), read: x => { if (x == null) return `a₀ = ${fmt(f.a0, 4)} Å · B₀ = ${fmt(f.B0, 1)} GPa · rms del ajuste ${fmt(f.rms * 1000, 3)} meV`; const i = near(Sx.a, x); return `a = ${fmt(Sx.a[i], 2)} Å · E − E₀ = ${fmt((Sx.E[i] - Emin) / n * 1000, 2)} meV/átomo · P = ${fmt(Sx.P[i] * GPA, 2)} GPa`; } });
    chart($('#cvPV', root), { xlim: [aa[0], aa.at(-1)], ylim: yl([...Sx.P.map(p => p * GPA), f.P(aa[0] ** 3 / 4), f.P(aa.at(-1) ** 3 / 4)]), xlabel: 'a (Å)', ylabel: 'P (GPa)', legend: true,
      series: [{ d: aa.map(a => [a, f.P(a ** 3 / 4)]), color: css('--accent'), width: 2, label: '−dE/dV (ajuste)' }, { d: [], color: css('--bad'), label: 'estrés de SIESTA' }],
      points: Sx.a.map((a, i) => ({ x: a, y: Sx.P[i] * GPA, color: css('--bad'), r: 4 })), hlines: [{ y: 0, color: css('--faint') }],
      readEl: $('#rdPV', root), read: x => { if (x == null) return `P = 0 en a = ${fmt(f.aP, 4)} Å · máx |P − (−dE/dV)| = ${fmt(f.dP, 2)} GPa`; const i = near(Sx.a, x); return `a = ${fmt(Sx.a[i], 2)} Å · estrés ${fmt(Sx.P[i] * GPA, 3)} GPa · −dE/dV ${fmt(f.P(Sx.V[i]), 3)} GPa`; } });
    const notes = { dzp300: `Con la base DZP y 300 Ry el estrés y la energía cuentan la misma historia: a con P = 0 y a₀ del ajuste difieren ${fmt(Math.abs(f.aP - f.a0) * 1000, 1)} mÅ. a₀ queda ${fmt(100 * (f.a0 - EXP.aSi) / EXP.aSi, 1)} % por debajo del experimento, lo típico de LDA.`,
      dzp100: `Con 100 Ry la malla es más gruesa, pero el Si es denso y su densidad varía poco: a₀ cambia ${fmt(Math.abs(f.a0 - fits.dzp300.a0) * 1000, 1)} mÅ y la máxima diferencia entre la presión del estrés y −dE/dV es ${fmt(f.dP, 2)} GPa (${fmt(fits.dzp300.dP, 2)} GPa con 300 Ry). En la molécula de agua, con su vacío y su densidad cerca del H, 60 Ry ya rompe la invariancia de traslación (panel egg-box).`,
      sz300: `La base SZ es otra aproximación de la energía y su mínimo se mueve (${fmt(f.a0, 3)} Å); el estrés sigue a su propia E(V). Que estrés y energía coincidan prueba que el código es coherente, no que la base sea buena.` };
    $('#ntEos', root).textContent = notes[S.e];
  };
  const drawVC = () => chart($('#cvVC', root), { xlim: [0, VC.length - 1], ylim: yl([...VC.map(s => s.a), fits.dzp300.a0]), xlabel: 'paso CG', ylabel: 'a = (4V)^⅓ (Å)',
    series: [{ d: VC.map((s, i) => [i, s.a]), color: css('--accent'), width: 2 }],
    points: VC.map((s, i) => ({ x: i, y: s.a, color: css('--accent'), r: 3 })), hlines: [{ y: fits.dzp300.a0, label: 'a₀ de E(V)', color: css('--faint'), dash: [3, 3] }],
    readEl: $('#rdVC', root), read: x => { if (x == null) return `${VC.length - 1} pasos · pasa el cursor para ver la presión`; const i = Math.max(0, Math.min(VC.length - 1, Math.round(x))); return `paso ${i}: a = ${fmt(VC[i].a, 4)} Å · P = ${fmt(VC[i].P * GPA, 3)} GPa · máx |σ cortante| = ${fmt(VC[i].sh * GPA, 2)} GPa · E = ${fmt(VC[i].E, 4)} eV`; } });

  $$('[data-dl]', root).forEach(b => b.addEventListener('click', () => downloadText(D.fdf[b.dataset.dl], { h2o: 'h2o_relax_cg.fdf', vac: 'si_vacancia_cg.fdf', vc: 'si_celda_variable.fdf' }[b.dataset.dl])));

  // ---- 7. archivo del usuario ----
  const uv = trajViewer($('#u3', root), [10, 7, 12]);
  let U = null, uTimer = 0, ui = 0;
  const msg = (t, bad) => { const m = $('#uMsg', root); m.innerHTML = t; m.style.color = bad ? css('--bad') : ''; };
  const drawU = () => { if (!U) return; const n = U.frames.length - 1, Ef_ = Math.min(...U.E.filter(Number.isFinite));
    const ser = []; if (U.E.some(Number.isFinite)) ser.push({ d: U.E.map((e, i) => [i, Math.max(e - Ef_, 1e-6)]), color: css('--accent'), width: 2, label: 'E − E_mín (eV)' });
    if (U.F.some(Number.isFinite)) ser.push({ d: U.F.map((f, i) => [i, Math.max(f, 1e-6)]), color: css('--orb-d'), width: 1.6, dash: [5, 3], label: 'F_máx (eV/Å)' });
    if (!ser.length){ $('#cvU', root).hidden = true; return; }
    const all = ser.flatMap(x => x.d.map(p => p[1])); chart($('#cvU', root), { logy: true, xlim: [0, Math.max(1, n)], ylim: [Math.max(1e-6, Math.min(...all) / 2), Math.max(...all) * 2], xlabel: 'paso', ylabel: 'eV · eV/Å', legend: true, series: ser, vlines: [{ x: ui, color: css('--ink'), dash: [2, 3] }],
      readEl: $('#rdU', root), read: x => { if (x == null) return `${n + 1} configuraciones`; const i = Math.max(0, Math.min(n, Math.round(x))); return `paso ${i}${Number.isFinite(U.E[i]) ? ` · E = ${fmt(U.E[i], 5)} eV` : ''}${Number.isFinite(U.F[i]) ? ` · F_máx = ${fmt(U.F[i], 4)} eV/Å` : ''}${Number.isFinite(U.P[i]) ? ` · P = ${fmt(U.P[i] * GPA, 3)} GPa` : ''}`; },
      onclick: x => setU(Math.max(0, Math.min(n, Math.round(x)))) }); };
  const setU = i => { ui = i; $('#uStep', root).value = i; $('#uStepO', root).textContent = i; uv.show(i); drawU(); };
  const loadU = async f => {
    const text = await f.text();
    try {
      let frames, Z, E = [], F = [], P = [], cell = null, info = '';
      if (/\.ani$/i.test(f.name) || !/Siesta|siesta:/.test(text.slice(0, 20000))){
        const A = parseANI(text); if (!A.nFrames) throw new Error('no se reconocen configuraciones');
        frames = A.frames.map(fr => fr.positions); Z = A.frames[0].symbols.map(s => atomicNumber(s)); info = `${A.nFrames} configuraciones del .ANI (sin energías ni fuerzas)`;
      } else {
        const o = parseOut(text); let st = o.steps.filter(s => s.coordinates?.coords?.length), noCoor = false;
        if (!st.length){ // sin WriteCoorStep: energías y fuerzas por paso, una sola geometría (la final si está, si no la inicial)
          if (!o.steps.length || !o.initialGeometry?.positions?.length) throw new Error('el .out no tiene pasos ni geometría');
          const g = o.finalCoordinates?.coords?.length ? { ...o.finalCoordinates, species: o.finalCoordinates.species || o.initialGeometry.species } : { unit: 'ang', coords: o.initialGeometry.positions, species: o.initialGeometry.species };
          st = o.steps.map(s => ({ ...s, coordinates: g, cell: s.cell || o.cell })); noCoor = true; }
        const spZ = Object.fromEntries(o.species.map(s => [s.index, s.Z]));
        Z = st[0].coordinates.species.map(k => spZ[k] ?? atomicNumber(String(k)));
        frames = st.map(s => { const c = s.coordinates, L = s.cell || o.cell;
          if (c.unit === 'ang') return c.coords; if (c.unit === 'bohr') return c.coords.map(p => p.map(x => x * 0.529177210903));
          return c.coords.map(fr => [0, 1, 2].map(k => fr[0] * L[0][k] + fr[1] * L[1][k] + fr[2] * L[2][k])); });
        E = st.map(s => s.freeEnergy ?? s.etot); F = st.map(s => s.maxForce); P = st.map(s => s.pressure?.total?.kbar ?? s.pressure?.static?.kbar ?? NaN); cell = st.at(-1).cell || o.cell;
        info = `${noCoor ? 'El .out no trae coordenadas en cada paso (WriteCoorStep true las escribe): el visor muestra una sola geometría. ' : ''}${st.length} pasos (${esc(st[0].type || '')}) · ${Z.length} átomos${o.final?.maxForce != null ? ` · F<sub>máx</sub> final ${fmt(o.final.maxForce, 4)} eV/Å` : ''}${o.final?.pressureKbar != null ? ` · P final ${fmt(o.final.pressureKbar * GPA, 3)} GPa` : ''}`;
      }
      if (Z.length > 2000) throw new Error('más de 2000 átomos: demasiados para el visor');
      U = { frames, Z, E, F, P };
      const c0 = frames.at(-1).reduce((a, p) => a.map((x, k) => x + p[k] / Z.length), [0, 0, 0]);
      const moved = frames[0].map((p, i) => [i, nrm(sub(frames.at(-1)[i], p))]).sort((a, b) => b[1] - a[1]);
      uv.set({ Z, radius: z => 0.2 + 0.3 * covalentRadius(z), color: z => z === 1 ? css('--muted') : colorOf(z), bonds: Z.length <= 600 ? bondsByDistance(Z, frames.at(-1)) : [], bondMax: 3.2, bondR: 0.07,
        center: c0, cell: cell || null, fit: true, pos: k => frames[k], trail: moved.slice(0, Math.min(8, moved.length)).map(m => m[0]) });
      $('#uStep', root).max = frames.length - 1; $('#uOut', root).hidden = false;
      $('#uTab', root).innerHTML = `<p class="note">${info}. Las estelas siguen a los ${Math.min(8, moved.length)} átomos que más se movieron (el primero, ${fmt(moved[0][1], 3)} Å).</p>`;
      msg(`Listo: ${esc(f.name)}.`); setU(frames.length - 1);
    } catch (e){ msg('No se pudo leer: ' + esc(e.message), true); }
  };
  const drop = $('#uDrop', root), inp = $('#uIn', root);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) loadU(e.dataTransfer.files[0]); });
  inp.addEventListener('change', () => inp.files[0] && loadU(inp.files[0]));
  $('#uPlay', root).addEventListener('click', e => { if (uTimer){ clearInterval(uTimer); uTimer = 0; e.target.textContent = 'animar'; return; } if (!U) return;
    e.target.textContent = 'pausa'; setU(0); uTimer = setInterval(() => { if (ui >= U.frames.length - 1){ clearInterval(uTimer); uTimer = 0; e.target.textContent = 'animar'; return; } setU(ui + 1); }, 200); });

  seg($('#hfSel', root), S.hf, v => { S.hf = v; drawHF(); });
  seg($('#eSel', root), S.e, v => { S.e = v; drawEos(); });
  const draw = () => { drawHF(); drawEgg(); drawTol(); drawRel(); drawVac(); drawEos(); drawVC(); drawU(); };
  onTheme(() => { draw(); hv.rebuild(); hv.show(S.hi); vv.rebuild(); vv.show(S.vi); if (U){ uv.rebuild(); uv.show(ui); } });
  draw(); initH(); vv.set(vSpec()); setV(S.vi);
  mount.destroy = () => { clearInterval(hTimer); clearInterval(uTimer); hv.destroy(); vv.destroy(); uv.destroy(); };
}
export function destroy(){ mount.destroy?.(); }
