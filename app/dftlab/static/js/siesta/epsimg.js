// SIESTA optical output: SystemLabel.EPSIMG (imaginary part of the dielectric function)
// and SystemLabel.contrib.EPSIMG (per-transition contributions, SIESTA 5.x).
//
// .EPSIMG layout (SIESTA 4.1/5.x):
//   ## Minimum and maximum energy in eV
//   ##     0.0000   20.4000
//   ## Number of spin components
//   ##   1
//   ## f-sum rule [spin i]
//   ##     0.8535
//   ## wp^2 in Ha^2 for Drude [, spin i]
//   ##     0.0000
//   E(eV)  eps2(spin 1) [eps2(spin 2)]
// The polarization type (polarized / unpolarized / polycrystal) is an fdf input and is not
// written in the file; pass it from the .out/.fdf (out.js extracts Optical.* keys).
import { lines as splitLines, ffloat, HA_EV } from './util.js';

const HBARC_EV_CM = 1.973269804e-5; // hbar*c in eV*cm

export function parseEPSIMG(text) {
  const L = splitLines(text);
  const header = [];
  const rows = [];
  const comments = [];
  for (const ln of L) {
    const t = ln.trim();
    if (!t) continue;
    if (t[0] === '#') { comments.push(t); header.push(t.replace(/^#+\s?/, '')); continue; }
    const v = t.split(/\s+/).map(ffloat);
    if (v.some(Number.isNaN)) continue;
    rows.push(v);
  }
  // header is pairs: description line, value line
  const meta = { fsum: [], wp2Ha: [] };
  for (let i = 0; i < header.length - 1; i++) {
    const key = header[i].toLowerCase();
    const vals = header[i + 1].trim().split(/\s+/).map(ffloat);
    if (vals.some(Number.isNaN)) continue;
    if (key.includes('minimum and maximum energy')) { meta.emin = vals[0]; meta.emax = vals[1]; }
    else if (key.includes('number of spin')) meta.nspin = vals[0];
    else if (key.includes('f-sum')) meta.fsum.push(vals[0]);
    else if (key.includes('wp^2') || key.includes('drude')) meta.wp2Ha.push(vals[0]);
    else continue;
    i++;
  }
  const ncol = rows.length ? Math.min(...rows.map((r) => r.length)) : 0;
  const energy = Float64Array.from(rows, (r) => r[0]);
  const eps2 = [];
  for (let c = 1; c < ncol; c++) eps2.push(Float64Array.from(rows, (r) => r[c]));
  const total = new Float64Array(energy.length);
  for (const e of eps2) for (let i = 0; i < total.length; i++) total[i] += e[i];
  return {
    nspin: meta.nspin ?? eps2.length,
    emin: meta.emin, emax: meta.emax,
    fsumRule: meta.fsum,                   // one per spin
    drudeWp2Ha: meta.wp2Ha,                // Ha^2, one per spin (original units)
    drudeWpEV: meta.wp2Ha.map((w) => Math.sqrt(Math.max(0, w)) * HA_EV),
    energy,                                 // eV
    eps2,                                   // [spin] imaginary part per spin channel
    eps2Total: total,                       // sum over spin channels
    comments,
    units: { energy: 'eV', eps2: 'dimensionless' },
  };
}

/** SystemLabel.contrib.EPSIMG: per-transition contributions (large file). Returns blocks per (ispin, ipol). */
export function parseContribEPSIMG(text, { maxRows = Infinity } = {}) {
  const blocks = [];
  let cur = null, ispin = null, ipol = null, n = 0;
  for (const ln of splitLines(text)) {
    const t = ln.trim();
    if (!t) continue;
    if (t[0] === '#') {
      let m;
      if ((m = /ispin\s*=\s*(\d+)/.exec(t))) ispin = +m[1];
      else if ((m = /ipol\s*=\s*(\d+)/.exec(t))) ipol = +m[1];
      else if (/Energy/.test(t)) {
        cur = { ispin, ipol, columns: ['energy', 'bin', 'ik', 'kx', 'ky', 'kz', 'bandIni', 'bandFin', 'eigIni', 'eigFin', 'deltaEig', 'contribution'], rows: [] };
        blocks.push(cur);
      }
      continue;
    }
    if (!cur || n >= maxRows) continue;
    const v = t.split(/\s+/).map(ffloat);
    if (v.length >= 12) { cur.rows.push(v.slice(0, 12)); n++; }
  }
  return { blocks, truncated: n >= maxRows, units: { energy: 'eV', k: '1/Bohr', eig: 'as written by SIESTA (Ry in 5.4)' } };
}

/** Kramers-Kronig transform: eps1(w) = 1 + 2/pi P int_0^inf w' eps2(w') / (w'^2 - w^2) dw'.
 *  Singularity removed by subtraction; the analytic tail of the subtracted term is added back.
 *  The integral is truncated at the last energy of the file (eps2 assumed 0 beyond); the last point
 *  copies its neighbour. For metals (eps2(0) != 0) eps1 diverges as w -> 0.
 *  Energies must be increasing; the grid need not be uniform. */
export function kramersKronig(energy, eps2, { eps1Inf = 1 } = {}) {
  const n = energy.length;
  const E = energy, f = Float64Array.from(eps2, (v, i) => v * E[i]); // w*eps2
  const W = E[n - 1];
  const out = new Float64Array(n);
  // derivative of w*eps2 for the singular point
  const df = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    df[i] = (f[b] - f[a]) / (E[b] - E[a]);
  }
  for (let i = 0; i < n; i++) {
    const w = E[i];
    let s = 0;
    let prev = null;
    for (let j = 0; j < n; j++) {
      const wp = E[j];
      let g;
      if (j === i) g = w > 0 ? df[i] / (2 * w) : 0;
      else g = (f[j] - f[i]) / (wp * wp - w * w);
      if (j > 0) s += 0.5 * (g + prev) * (E[j] - E[j - 1]);
      prev = g;
    }
    // analytic part: f(w) * P int_E0^W dw'/(w'^2-w^2)
    let tail = 0;
    if (i === n - 1 && n > 2) { out[i] = out[i - 1]; continue; } // log-divergent PV at the window edge
    if (w > 0) {
      const prim = (x) => Math.log(Math.abs((x - w) / (x + w))) / (2 * w);
      const lo = E[0];
      tail = f[i] * (prim(W) - (lo > 0 ? prim(lo) : 0));
    } else {
      // w = 0: integrand is eps2(w')/w'
      tail = 0;
    }
    out[i] = eps1Inf + (2 / Math.PI) * (s + tail);
  }
  return out;
}

/** Optical constants from eps1, eps2 at energies E (eV). */
export function opticalConstants(energy, eps1, eps2) {
  const n = energy.length;
  const N = new Float64Array(n), K = new Float64Array(n), R = new Float64Array(n), alpha = new Float64Array(n), eels = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const e1 = eps1[i], e2 = eps2[i];
    const mod = Math.hypot(e1, e2);
    const nn = Math.sqrt(Math.max(0, (mod + e1) / 2));
    const kk = Math.sqrt(Math.max(0, (mod - e1) / 2));
    N[i] = nn; K[i] = kk;
    R[i] = ((nn - 1) ** 2 + kk * kk) / ((nn + 1) ** 2 + kk * kk);
    alpha[i] = (2 * energy[i] * kk) / HBARC_EV_CM; // 1/cm
    eels[i] = mod > 0 ? e2 / (mod * mod) : 0;
  }
  return { n: N, k: K, reflectivity: R, absorption: alpha, eels, units: { absorption: '1/cm', energy: 'eV' } };
}

/** Full optical analysis of a parsed EPSIMG (uses eps2Total). */
export function opticalSpectrum(eps, opts = {}) {
  const eps2 = opts.spin != null ? eps.eps2[opts.spin] : eps.eps2Total;
  const eps1 = kramersKronig(eps.energy, eps2, opts);
  return { energy: eps.energy, eps1, eps2, ...opticalConstants(eps.energy, eps1, eps2) };
}

/** Add an intraband Drude term (wp, gamma in eV) to (eps1, eps2). */
export function addDrude(energy, eps1, eps2, wpEV, gammaEV = 0.1) {
  const e1 = Float64Array.from(eps1), e2 = Float64Array.from(eps2);
  for (let i = 0; i < energy.length; i++) {
    const w = energy[i];
    if (w <= 0) continue;
    const d = w * w + gammaEV * gammaEV;
    e1[i] -= (wpEV * wpEV) / d;
    e2[i] += (wpEV * wpEV * gammaEV) / (w * d);
  }
  return { eps1: e1, eps2: e2 };
}
