// SIESTA eigenvalue files: SystemLabel.EIG (+ SystemLabel.KP for k-point weights).
//
// .EIG layout:
//   Ef (eV)
//   nbands nspin nk          (nspin: 1, 2; NC writes 4, SOC writes 8 - then only one block of nbands=2*norb)
//   ik  e(1..nbands) [e(.. spin 2)]   (wrapped, 10 per line)
// .KP layout (also .PDOS.KP, .BZ_KP style):
//   nk
//   ik kx ky kz w            (k cartesian, 1/Bohr; weights sum to 1)
import { lines as splitLines, ffloat, floatBlock, BOHR_ANG, linspace, trapz } from './util.js';

export function parseKP(text) {
  const L = splitLines(text).filter((l) => l.trim() !== '');
  const nk = parseInt(L[0], 10);
  const kBohr = [], weights = [];
  for (let i = 1; i < L.length && kBohr.length < nk; i++) {
    const t = L[i].trim().split(/\s+/).map(ffloat);
    if (t.length < 5) continue;
    kBohr.push([t[1], t[2], t[3]]);
    weights.push(t[4]);
  }
  return {
    nk: kBohr.length,
    kpoints: kBohr.map((k) => k.map((v) => v / BOHR_ANG)),
    kpointsBohr: kBohr,
    weights: Float64Array.from(weights),
    weightSum: weights.reduce((a, b) => a + b, 0),
    units: { kpoints: '1/Ang cartesian', kpointsBohr: '1/Bohr (original)' },
  };
}

export function parseEIG(text, kpText = null) {
  const L = splitLines(text);
  let p = 0;
  while (p < L.length && !L[p].trim()) p++;
  const fermi = ffloat(L[p++]);
  while (p < L.length && !L[p].trim()) p++;
  const [nBands, nSpinFile, nk] = L[p++].trim().split(/\s+/).map(Number);
  const rest = floatBlock(L.slice(p).join(' '));
  const warnings = [];
  const noncollinear = nSpinFile > 2;
  // per-k count = 1 (index) + nbands * nsEff
  let nsEff = noncollinear ? 1 : nSpinFile;
  if (rest.length >= nk * (1 + nBands * nsEff) + 0) {
    // ok
  } else {
    const per = rest.length / nk - 1;
    if (Number.isInteger(per) && per % nBands === 0) nsEff = per / nBands;
    else warnings.push('EIG file shorter than expected (truncated?)');
  }
  const per = 1 + nBands * nsEff;
  const nkRead = Math.min(nk, Math.floor(rest.length / per));
  // eig[spin][k] = Float64Array(nBands)
  const eig = Array.from({ length: nsEff }, () => []);
  for (let ik = 0; ik < nkRead; ik++) {
    const o = ik * per + 1;
    for (let s = 0; s < nsEff; s++) eig[s].push(rest.slice(o + s * nBands, o + (s + 1) * nBands));
  }
  let kp = null;
  if (kpText) {
    kp = typeof kpText === 'string' || kpText instanceof ArrayBuffer || ArrayBuffer.isView(kpText) ? parseKP(kpText) : kpText;
    if (kp.nk !== nkRead) { warnings.push(`KP has ${kp.nk} k-points but EIG has ${nkRead}; ignoring KP weights`); kp = null; }
  }
  const weights = kp ? Float64Array.from(kp.weights, (w) => w / kp.weightSum) : new Float64Array(nkRead).fill(1 / nkRead);
  return {
    fermi,
    nBands,
    nSpin: nsEff,          // number of eigenvalue channels stored
    nSpinFile,             // value written in the header (1,2,4,8)
    noncollinear,
    spinDegeneracy: nsEff === 1 && !noncollinear ? 2 : 1,
    nk: nkRead,
    eig,                   // [spin][k] -> Float64Array(nBands), eV
    weights,               // normalized to 1
    weightsFromKP: !!kp,
    kpoints: kp ? kp.kpoints : null,
    kpointsBohr: kp ? kp.kpointsBohr : null,
    units: { energy: 'eV', kpoints: '1/Ang cartesian' },
    warnings,
  };
}

/** Band-gap analysis using the Fermi level as separator.
 *  Returns per channel and overall: VBM/CBM (energy, k index, band), gap, direct gap, metallic flag. */
export function analyzeGap(data, opts = {}) {
  const ef = opts.fermi ?? data.fermi;
  const tol = opts.tol ?? 1e-6;
  const kvec = (ik) => (data.kpoints ? data.kpoints[ik] : null);
  const channels = data.eig.map((ks, s) => {
    let vbm = { e: -Infinity }, cbm = { e: Infinity };
    let metallic = false;
    let directGap = Infinity, directK = -1;
    const nb = data.nBands;
    const bmin = new Float64Array(nb).fill(Infinity), bmax = new Float64Array(nb).fill(-Infinity);
    ks.forEach((ev, ik) => {
      let hv = -Infinity, lc = Infinity;
      for (let b = 0; b < nb; b++) {
        const e = ev[b];
        if (e < bmin[b]) bmin[b] = e;
        if (e > bmax[b]) bmax[b] = e;
        if (e <= ef + tol) { if (e > hv) hv = e; if (e > vbm.e) vbm = { e, k: ik, band: b, kpoint: kvec(ik) }; }
        else { if (e < lc) lc = e; if (e < cbm.e) cbm = { e, k: ik, band: b, kpoint: kvec(ik) }; }
      }
      if (lc - hv < directGap) { directGap = lc - hv; directK = ik; }
    });
    for (let b = 0; b < nb; b++) if (bmin[b] < ef - tol && bmax[b] > ef + tol) metallic = true;
    const nOcc = Array.from(bmax).filter((v) => v <= ef + tol).length;
    const gap = metallic ? 0 : cbm.e - vbm.e;
    return {
      spin: s, vbm, cbm, gap, metallic, nOccupiedBands: metallic ? null : nOcc,
      directGap: metallic ? 0 : directGap, directGapK: directK,
      direct: !metallic && vbm.k === cbm.k,
    };
  });
  const vbm = channels.reduce((a, c) => (c.vbm.e > a.e ? { ...c.vbm, spin: c.spin } : a), { e: -Infinity });
  const cbm = channels.reduce((a, c) => (c.cbm.e < a.e ? { ...c.cbm, spin: c.spin } : a), { e: Infinity });
  const metallic = channels.some((c) => c.metallic);
  const gap = metallic ? 0 : cbm.e - vbm.e;
  return {
    fermi: ef, vbm, cbm, gap, metallic,
    direct: !metallic && vbm.k === cbm.k && vbm.spin === cbm.spin,
    type: metallic ? 'metal' : (vbm.k === cbm.k ? 'direct' : 'indirect'),
    directGap: Math.min(...channels.map((c) => c.directGap)),
    channels,
  };
}

/** Broadened DOS from eigenvalues (client side).
 *  opts: {emin, emax, npts | de, sigma (eV), shape: 'gaussian'|'lorentzian', fermi}
 *  Returns states/eV/cell; spin-unpolarized includes the factor 2. */
export function computeDOS(data, opts = {}) {
  const sigma = opts.sigma ?? 0.1;
  const shape = opts.shape ?? 'gaussian';
  let lo = Infinity, hi = -Infinity;
  for (const sp of data.eig) for (const ev of sp) for (const e of ev) { if (e < lo) lo = e; if (e > hi) hi = e; }
  const emin = opts.emin ?? lo - 5 * sigma;
  const emax = opts.emax ?? hi + 5 * sigma;
  const npts = opts.npts ?? Math.max(2, Math.round((emax - emin) / (opts.de ?? sigma / 5)) + 1);
  const E = linspace(emin, emax, npts);
  const de = npts > 1 ? (emax - emin) / (npts - 1) : 1;
  const g = data.spinDegeneracy;
  const cut = shape === 'gaussian' ? 6 * sigma : 200 * sigma;
  const dos = data.eig.map((ks) => {
    const D = new Float64Array(npts);
    ks.forEach((ev, ik) => {
      const w = data.weights[ik] * g;
      for (const e0 of ev) {
        const i0 = Math.max(0, Math.floor((e0 - cut - emin) / de));
        const i1 = Math.min(npts - 1, Math.ceil((e0 + cut - emin) / de));
        if (shape === 'gaussian') {
          const a = w / (sigma * Math.sqrt(2 * Math.PI));
          for (let i = i0; i <= i1; i++) { const x = (E[i] - e0) / sigma; D[i] += a * Math.exp(-0.5 * x * x); }
        } else {
          const a = w * sigma / Math.PI;
          for (let i = i0; i <= i1; i++) { const x = E[i] - e0; D[i] += a / (x * x + sigma * sigma); }
        }
      }
    });
    return D;
  });
  const total = new Float64Array(npts);
  for (const D of dos) for (let i = 0; i < npts; i++) total[i] += D[i];
  const fermi = opts.fermi ?? data.fermi;
  return {
    energy: E, dos, total, sigma, shape, fermi,
    electronsBelowFermi: trapz(E, total, fermi),
    units: { energy: 'eV', dos: 'states/eV/cell' },
  };
}

/** Exact electron count below E_F from eigenvalues (step function, no broadening). */
export function countElectrons(data, fermi = data.fermi) {
  let n = 0;
  data.eig.forEach((ks) => ks.forEach((ev, ik) => { for (const e of ev) if (e <= fermi) n += data.weights[ik] * data.spinDegeneracy; }));
  return n;
}
