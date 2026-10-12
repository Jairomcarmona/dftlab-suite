// Oráculo de referencia de WF-ELECTRONIC fino: gap, masas direccionales y fat bands (ficha docs/scientific-protocols/WF-ELECTRONIC.md).
// Lee las salidas de SIESTA 5.4.2 y de su utilidad `fat`; no es código de producción.

export const BOHR_ANG = 0.529177210903;
export const HBAR2_ME = 27.211386245988 * BOHR_ANG ** 2; // ħ²/mₑ en eV·Å²

// B-0: SIESTA 5.4.2 no calcula bandas con BandLinesScale pi/a en una celda no ortorrómbica; lo dice en stdout y termina bien.
export function bandRunCheck(stdout, bandsWritten) {
  if (/pi\/a option should only be used for orthorhombic cells/.test(stdout)) return { status: 'FAIL', code: 'BAND_SCALE_REJECTED' };
  if (!bandsWritten) return { status: 'FAIL', code: 'BANDS_NOT_WRITTEN' };
  return { status: 'PASS' };
}

// Archivo .bands. Con BandLines: Ef; kmin kmax; emin emax; nb ns nk; por k «x E…» (x en 1/Bohr a lo largo del camino); etiquetas.
// Con BandPoints: Ef; emin emax; nb ns nk; por k «kx ky kz E…» (cartesianas, 1/Bohr); sin etiquetas.
export function parseBands(text) {
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex(l => /^\s*\d+\s+\d+\s+\d+\s*$/.test(l));
  const kind = header === 3 ? 'lines' : header === 2 ? 'points' : null;
  if (!kind) throw new Error('cabecera .bands desconocida');
  const [nb, ns, nk] = lines[header].trim().split(/\s+/).map(Number);
  const t = lines.slice(header + 1).join(' ').trim().split(/\s+/);
  const kc = kind === 'lines' ? 1 : 3;
  const k = [], E = [];
  let i = 0;
  for (let q = 0; q < nk; q++) {
    k.push(t.slice(i, i + kc).map(Number)); i += kc;
    const e = t.slice(i, i + nb * ns).map(Number); i += nb * ns;
    E.push(Array.from({ length: ns }, (_, s) => e.slice(s * nb, (s + 1) * nb)));
  }
  return { kind, fermi_eV: Number(lines[0]), nbands: nb, nspin: ns, nk, k, E };
}

// B-1: gap sobre los k calculados. n_occupied = bandas ocupadas por spin (electrones/2 sin spin). El alcance es el de la muestra.
export function bandGap(bands, nOccupied) {
  let vbm = { eV: -Infinity }, cbm = { eV: Infinity };
  bands.E.forEach((byspin, ik) => byspin.forEach((e, s) => {
    if (e[nOccupied - 1] > vbm.eV) vbm = { eV: e[nOccupied - 1], k_index: ik, spin: s };
    if (e[nOccupied] < cbm.eV) cbm = { eV: e[nOccupied], k_index: ik, spin: s };
  }));
  const scope = bands.kind === 'lines' ? 'PATH' : 'POINTS';
  if (cbm.eV <= vbm.eV) return { status: 'NO_GAP', scope, vbm, cbm };
  return { status: 'GAP', scope, gap_eV: cbm.eV - vbm.eV, direct: vbm.k_index === cbm.k_index, vbm, cbm,
    fermi_in_gap: bands.fermi_eV > vbm.eV && bands.fermi_eV < cbm.eV };
}

// Mínimos cuadrados de e = c0 + c1 t + c2 t².
function quadFit(ts, es) {
  const S = Array.from({ length: 5 }, (_, p) => ts.reduce((a, t) => a + t ** p, 0));
  const R = [0, 1, 2].map(p => ts.reduce((a, t, i) => a + es[i] * t ** p, 0));
  const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  return [0, 1, 2].map(c => det(M.map((row, r) => row.map((x, j) => (j === c ? R[r] : x)))) / D);
}

// B-3, B-4: masa direccional sobre una línea recta de k (índices from…to, inclusivos) de una banda (1-based) y spin (0-based).
// policy: {fit_halfwidth_invA, min_points_per_side, degeneracy_meV, straightness_invA}.
export function directionalMass(bands, line, policy) {
  const { from, to, band, carrier, spin = 0 } = line;
  const idx = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const reasons = [];
  let s, direction = null;
  if (bands.kind === 'points') {
    const P = idx.map(i => bands.k[i].map(x => x / BOHR_ANG));
    const d = P[P.length - 1].map((x, j) => x - P[0][j]);
    const n = Math.hypot(...d);
    direction = d.map(x => x / n);
    s = P.map(p => p.reduce((a, x, j) => a + (x - P[0][j]) * direction[j], 0));
    const off = Math.max(...P.map((p, i) => Math.hypot(...p.map((x, j) => x - P[0][j] - s[i] * direction[j]))));
    if (off > policy.straightness_invA) reasons.push('LINE_NOT_STRAIGHT');
  } else {
    s = idx.map(i => (bands.k[i][0] - bands.k[from][0]) / BOHR_ANG);
  }
  const e = idx.map(i => bands.E[i][spin][band - 1]);
  let j = 0;
  e.forEach((x, i) => { if (carrier === 'electron' ? x < e[j] : x > e[j]) j = i; });
  const win = s.map((x, i) => i).filter(i => Math.abs(s[i] - s[j]) <= policy.fit_halfwidth_invA + 1e-12);
  const left = win.filter(i => s[i] < s[j]).length, right = win.filter(i => s[i] > s[j]).length;
  if (Math.min(left, right) < policy.min_points_per_side) reasons.push('EXTREMUM_AT_LINE_END');
  const near = bands.E[idx[j]][spin].filter((x, b) => b !== band - 1 && Math.abs(x - e[j]) * 1000 <= policy.degeneracy_meV);
  if (near.length) reasons.push('DEGENERATE_EXTREMUM');
  const ts = win.map(i => s[i] - s[j]), es = win.map(i => e[i]);
  const c = quadFit(ts, es);
  const curvature = 2 * c[2];
  const mass = (carrier === 'electron' ? 1 : -1) * HBAR2_ME / curvature;
  if (!(mass > 0)) reasons.push('CURVATURE_SIGN');
  const rms = Math.sqrt(ts.reduce((a, t, i) => a + (c[0] + c[1] * t + c[2] * t * t - es[i]) ** 2, 0) / ts.length);
  return {
    status: reasons.length ? 'NOT_ESTABLISHED' : 'ESTABLISHED', reasons,
    mass_me: reasons.length ? null : mass,
    extremum_k_index: idx[j], extremum_eV: e[j], degenerate_bands: near.length,
    extremum_offset_invA: -c[1] / (2 * c[2]),
    direction, n_points: win.length, curvature_eV_A2: curvature, rms_meV: rms * 1000,
  };
}

// Archivo .EIGFAT de `fat`: «# …»; nb ns nk; por k «ik kx ky kz» (1/Bohr) y pares (E, peso) por banda y spin.
export function parseEigfat(text) {
  const all = text.split(/\r?\n/);
  const m = /min_band, max_band:\s*(\d+)\s+(\d+)/.exec(all[0] || '');
  const lines = all.filter(l => !l.startsWith('#'));
  const [nb, ns, nk] = lines[0].trim().split(/\s+/).map(Number);
  const t = lines.slice(1).join(' ').trim().split(/\s+/).map(Number);
  const k = [], E = [], W = [];
  let i = 0;
  for (let q = 0; q < nk; q++) {
    k.push(t.slice(i + 1, i + 4)); i += 4;
    const v = t.slice(i, i + 2 * nb * ns); i += 2 * nb * ns;
    E.push(v.filter((_, j) => j % 2 === 0)); W.push(v.filter((_, j) => j % 2 === 1));
  }
  return { min_band: m ? Number(m[1]) : 1, nbands: nb, nspin: ns, nk, k, E, W };
}

// B-2: las proyecciones de una partición completa de orbitales suman 1 por estado (Mulliken; un peso puede ser negativo).
// Las energías de cada proyección deben ser las del .bands de la misma corrida (energía con 4 decimales en ambos).
// `fat -b/-B` limita las bandas; min_band sale de la cabecera del .EIGFAT.
export function fatPartition(bands, sets, policy) {
  const names = Object.keys(sets).sort();
  const reasons = [];
  const first = sets[names[0]];
  if (names.some(n => ['nk', 'nbands', 'nspin', 'min_band'].some(f => sets[n][f] !== first[f]))
    || first.nk !== bands.nk || first.nspin !== bands.nspin || first.min_band - 1 + first.nbands > bands.nbands) reasons.push('FAT_BANDS_MISMATCH');
  let maxDE = 0, maxSum = 0, minW = Infinity;
  if (!reasons.length) {
    for (let q = 0; q < first.nk; q++) {
      for (let b = 0; b < first.nbands * first.nspin; b++) {
        const ref = bands.E[q][Math.floor(b / first.nbands)][first.min_band - 1 + (b % first.nbands)];
        let sum = 0;
        for (const n of names) {
          maxDE = Math.max(maxDE, Math.abs(sets[n].E[q][b] - ref));
          sum += sets[n].W[q][b];
          minW = Math.min(minW, sets[n].W[q][b]);
        }
        maxSum = Math.max(maxSum, Math.abs(sum - 1));
      }
    }
    if (maxDE > policy.energy_match_eV) reasons.push('FAT_BANDS_MISMATCH');
    if (maxSum > policy.weight_rounding * names.length) reasons.push('PARTITION_INCOMPLETE');
  }
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons, sets: names, max_energy_diff_eV: maxDE, max_sum_error: maxSum, min_weight: minW };
}
