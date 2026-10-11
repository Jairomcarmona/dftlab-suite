// Fonones armónicos desde constantes de fuerza de una supercelda (desplazamientos finitos, SIESTA MD.TypeOfRun FC).
// Unidades: Å, eV, uma. Φ en eV/Å². Frecuencias en THz (ν = ω/2π); ν < 0 indica ω² < 0 (modo inestable).
// Pruebas: node tests/siesta/run_fc_tests.mjs

export const THZ = 15.633302;          // √(eV/(Å²·uma)) / 2π en THz
export const CM1_PER_THZ = 33.35641;   // 1 THz en cm⁻¹
export const MEV_PER_THZ = 4.135667;   // 1 THz en meV (h·ν)

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fracToCart = (L, f) => [0, 1, 2].map(k => f[0] * L[0][k] + f[1] * L[1][k] + f[2] * L[2][k]);
export function inv3(m) {
  const [a, b, c] = m, det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  return [[(b[1] * c[2] - b[2] * c[1]) / det, (a[2] * c[1] - a[1] * c[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
          [(b[2] * c[0] - b[0] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
          [(b[0] * c[1] - b[1] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det]];
}
/** Red recíproca con 2π, filas (Å⁻¹). */
export function reciprocal(L) { const I = inv3(L); return [0, 1, 2].map(i => [0, 1, 2].map(k => 2 * Math.PI * I[k][i])); }

/**
 * Celda primitiva y asignación de cada átomo de la supercelda a (base κ, celda R).
 * superCell = {lattice (filas, Å), positions (fraccionarias), numbers}; n = [n1,n2,n3] (supercelda diagonal).
 */
export function primitiveMap(superCell, n, tol = 1e-3) {
  const Ls = superCell.lattice, lat = Ls.map((v, i) => v.map(x => x / n[i]));
  const basis = [], map = [];
  superCell.positions.forEach((f, j) => {
    const g = f.map((x, i) => x * n[i]), R = g.map(x => Math.floor(x + tol)), u = g.map((x, i) => x - R[i]);
    let k = basis.findIndex(b => b.Z === superCell.numbers[j] && b.u.every((x, i) => { const d = x - u[i]; return Math.abs(d - Math.round(d)) < tol; }));
    if (k < 0) { k = basis.length; basis.push({ Z: superCell.numbers[j], u }); }
    map.push({ kappa: k, R: R.map((x, i) => ((x % n[i]) + n[i]) % n[i]) });
  });
  const ncell = n[0] * n[1] * n[2];
  if (basis.length * ncell !== superCell.positions.length)
    throw new Error(`La supercelda no es ${n.join('×')} veces una celda primitiva: ${superCell.positions.length} átomos, ${basis.length} en la base.`);
  return { prim: { lattice: lat, positions: basis.map(b => b.u.map(x => x)), numbers: basis.map(b => b.Z) }, map, nb: basis.length, ncell };
}

/**
 * Modelo de fonones.
 * opts: superCell, n, masses[] por átomo de la supercelda (uma), phi: [{atom (0-based), rows: 3×(3·na) eV/Å²}] —
 * rows[α][3j+β] = ∂²E/∂u_{iα}∂u_{jβ} = −∂F_{jβ}/∂u_{iα}; asr: impone Σ_j Φ(i,j) = 0; ws: imágenes de Wigner–Seitz.
 */
export function phononModel({ superCell, n, masses, phi, asr = true, ws = true }) {
  const pm = primitiveMap(superCell, n), na = superCell.positions.length, nb = pm.nb;
  const Ls = superCell.lattice, cart = superCell.positions.map(f => fracToCart(Ls, f));
  const Mk = new Array(nb); pm.map.forEach((m, j) => { Mk[m.kappa] = masses[j]; });
  const count = new Array(nb).fill(0); phi.forEach(p => count[pm.map[p.atom].kappa]++);
  for (let k = 0; k < nb; k++) if (!count[k]) throw new Error(`Falta desplazar algún átomo de la base ${k + 1} (MD.FCFirst/MD.FCLast).`);
  const terms = [];
  for (const p of phi) {
    const i = p.atom, a = pm.map[i].kappa;
    const blocks = [];
    for (let j = 0; j < na; j++) blocks.push([0, 1, 2].map(al => [0, 1, 2].map(be => p.rows[al][3 * j + be])));
    if (asr) for (let al = 0; al < 3; al++) for (let be = 0; be < 3; be++) {
      let s = 0; for (let j = 0; j < na; j++) if (j !== i) s += blocks[j][al][be]; blocks[i][al][be] = -s;
    }
    for (let j = 0; j < na; j++) {
      const b = pm.map[j].kappa, d0 = [0, 1, 2].map(k => cart[j][k] - cart[i][k]);
      let vecs = [d0];
      if (ws) {
        const cand = []; let dmin = Infinity;
        for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
          const d = [0, 1, 2].map(k => d0[k] + x * Ls[0][k] + y * Ls[1][k] + z * Ls[2][k]), r = Math.hypot(...d);
          cand.push([r, d]); if (r < dmin) dmin = r;
        }
        vecs = cand.filter(c => c[0] < dmin + 1e-3).map(c => c[1]);
      }
      const f = 1 / (count[a] * Math.sqrt(Mk[a] * Mk[b]) * vecs.length);
      terms.push({ a, b, i, j, phi: blocks[j], f, vecs, dist: Math.hypot(...vecs[0]) });
    }
  }
  return { ...pm, superCell, n, cart, Mk, terms, nmodes: 3 * nb, recip: reciprocal(pm.prim.lattice) };
}

/** Matriz dinámica D(q) (q cartesiano con 2π, Å⁻¹): {re, im} Float64Array n×n, eV/(Å²·uma). Hermítica por construcción. */
export function dynmat(M, q) {
  const n = M.nmodes, re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (const t of M.terms) {
    let c = 0, s = 0; for (const v of t.vecs) { const ph = dot(q, v); c += Math.cos(ph); s += Math.sin(ph); }
    c *= t.f; s *= t.f;
    for (let al = 0; al < 3; al++) for (let be = 0; be < 3; be++) {
      const p = t.phi[al][be], r = 3 * t.a + al, k = 3 * t.b + be;
      re[r * n + k] += p * c; im[r * n + k] += p * s;
    }
  }
  for (let r = 0; r < n; r++) for (let k = r; k < n; k++) {            // parte hermítica
    const a = (re[r * n + k] + re[k * n + r]) / 2, b = (im[r * n + k] - im[k * n + r]) / 2;
    re[r * n + k] = re[k * n + r] = a; im[r * n + k] = b; im[k * n + r] = -b;
  }
  return { re, im, n };
}

/** Jacobi cíclico para una matriz real simétrica (Float64Array n×n, se destruye). Devuelve {w, V} con V por columnas. */
export function jacobi(A, n, wantV = false) {
  const V = wantV ? new Float64Array(n * n) : null; if (V) for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, diag = 0;
    for (let p = 0; p < n; p++) { diag += A[p * n + p] ** 2; for (let q = p + 1; q < n; q++) off += A[p * n + q] ** 2; }
    if (off <= 1e-26 * Math.max(diag, 1e-300)) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p * n + q]; if (Math.abs(apq) < 1e-300) continue;
      const th = (A[q * n + q] - A[p * n + p]) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k * n + p], akq = A[k * n + q]; A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p * n + k], aqk = A[q * n + k]; A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk; }
      if (V) for (let k = 0; k < n; k++) { const vkp = V[k * n + p], vkq = V[k * n + q]; V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq; }
    }
  }
  const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = A[i * n + i];
  return { w, V };
}

/** Autovalores (y autovectores complejos) de una matriz hermítica vía la forma real 2n×2n [[A,−B],[B,A]]. */
export function eigHermitian({ re, im, n }, wantV = false) {
  const N = 2 * n, A = new Float64Array(N * N);
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
    const a = re[r * n + k], b = im[r * n + k];
    A[r * N + k] = a; A[(r + n) * N + k + n] = a; A[r * N + k + n] = -b; A[(r + n) * N + k] = b;
  }
  const { w, V } = jacobi(A, N, wantV);
  const idx = [...w.keys()].sort((x, y) => w[x] - w[y]);
  const vals = [], vecs = [];
  for (let m = 0; m < n; m++) {                                            // cada autovalor aparece dos veces
    const c = idx[2 * m]; vals.push(w[c]);
    if (wantV) { const v = []; let nn = 0; for (let k = 0; k < n; k++) { const x = V[k * N + c], y = V[(k + n) * N + c]; v.push([x, y]); nn += x * x + y * y; }
      nn = Math.sqrt(nn) || 1; vecs.push(v.map(([x, y]) => [x / nn, y / nn])); }
  }
  return { vals, vecs };
}

/** Frecuencias en THz (orden creciente; negativas si ω² < 0). */
export const toTHz = w2 => Math.sign(w2) * Math.sqrt(Math.abs(w2)) * THZ;
export function frequencies(M, q, wantV = false) {
  const e = eigHermitian(dynmat(M, q), wantV);
  return { nu: e.vals.map(toTHz), vecs: e.vecs };
}
/** q fraccionario (en la recíproca de la celda primitiva) → cartesiano. */
export const qCart = (M, f) => [0, 1, 2].map(k => f[0] * M.recip[0][k] + f[1] * M.recip[1][k] + f[2] * M.recip[2][k]);

/**
 * Camino k desde puntos fraccionarios: segs = [[{label,f}, {label,f}], …]; nper = puntos por Å⁻¹.
 * Devuelve {x, q (cart), ticks [{x,label}], breaks (índices donde empieza un tramo discontinuo)}.
 */
export function pathFromSegments(M, segs, nper = 60) {
  const x = [], q = [], ticks = [], breaks = []; let x0 = 0;
  segs.forEach((s, si) => {
    const A = qCart(M, s[0].f), B = qCart(M, s[1].f), len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const m = Math.max(2, Math.round(len * nper));
    const prev = ticks[ticks.length - 1];
    if (si && prev && Math.abs(prev.x - x0) < 1e-12) { if (prev.label !== s[0].label) { prev.label += '|' + s[0].label; breaks.push(x.length); } }
    else ticks.push({ x: x0, label: s[0].label });
    for (let t = 0; t <= m; t++) { x.push(x0 + len * t / m); q.push(A.map((a, k) => a + (B[k] - a) * t / m)); }
    x0 += len; ticks.push({ x: x0, label: s[1].label });
  });
  return { x, q, ticks, breaks };
}

export function dispersion(M, path) { return path.q.map(q => frequencies(M, q).nu); }

/** DOS fonónica por muestreo en malla Γ-centrada m×m×m y ensanchamiento gaussiano σ (THz). Normalizada a 3·nb modos. */
export function phononDOS(M, { m = 16, sigma = 0.12, de = 0.02, emin = null, emax = null } = {}) {
  const all = [];
  for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) for (let c = 0; c < m; c++)
    all.push(...frequencies(M, qCart(M, [a / m, b / m, c / m])).nu);
  const lo = emin ?? Math.min(0, ...all) - 4 * sigma, hi = emax ?? Math.max(...all) + 4 * sigma;
  const ne = Math.round((hi - lo) / de) + 1, E = [], g = new Float64Array(ne);
  const norm = 1 / (m * m * m * sigma * Math.sqrt(2 * Math.PI)), cut = 5 * sigma;
  for (const nu of all) { const i0 = Math.max(0, Math.floor((nu - cut - lo) / de)), i1 = Math.min(ne - 1, Math.ceil((nu + cut - lo) / de));
    for (let i = i0; i <= i1; i++) { const x = (lo + i * de - nu) / sigma; g[i] += norm * Math.exp(-0.5 * x * x); } }
  for (let i = 0; i < ne; i++) E.push(lo + i * de);
  return { E, g: [...g], nq: m * m * m, freqs: all };
}
