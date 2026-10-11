// SIESTA band-structure file (SystemLabel.bands): BandLines and BandPoints variants.
//
// BandLines layout (SIESTA 3.x - 5.x):
//   Ef
//   kmin kmax                (path length range, 1/Bohr)
//   Emin Emax                (eV)
//   nbands nspin nk
//   per k: x  e(1..nbands, spin 1) [e(.., spin 2)]   (wrapped, 10 per line)
//   nlabels
//   x 'label'                (one per line)
// BandPoints layout:
//   Ef
//   Emin Emax
//   nbands nspin nk
//   per k: kx ky kz e(...)   (k in cartesian 1/Bohr)
//
// Non-collinear / spin-orbit runs write nspin = 1 and 2*norb bands.
import { lines as splitLines, ffloat, BOHR_ANG } from './util.js';

const GREEK = {
  gamma: 'Γ', delta: 'Δ', sigma: 'Σ', lambda: 'Λ', pi: 'Π', omega: 'Ω',
  alpha: 'α', beta: 'β', epsilon: 'ε', kappa: 'κ', mu: 'μ', rho: 'ρ', chi: 'χ', xi: 'ξ', zeta: 'ζ', eta: 'η',
};

/** Pretty label: "\Gamma" / "Gamma" / "G" -> "Γ"; keeps other labels. */
export function prettyLabel(raw) {
  const s = String(raw ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
  const m = /^\\?([A-Za-z]+)(.*)$/.exec(s);
  if (m) {
    const word = m[1].toLowerCase();
    if (word === 'gamma' || (word === 'g' && !m[2])) return 'Γ' + (word === 'g' ? '' : m[2]);
    if (GREEK[word]) {
      const upper = m[1][0] === m[1][0].toUpperCase();
      return (upper ? GREEK[word].toUpperCase() : GREEK[word]) + m[2];
    }
  }
  return s;
}

export function parseBands(text) {
  const L = splitLines(text);
  let p = 0;
  const next = () => {
    while (p < L.length && L[p].trim() === '') p++;
    return p < L.length ? L[p++] : null;
  };
  const warnings = [];
  const fermi = ffloat(next());
  const l2 = next().trim().split(/\s+/).map(ffloat);
  const l3raw = next();
  const l3 = l3raw.trim().split(/\s+/);
  let format, kmin = NaN, kmax = NaN, emin, emax, header;
  const isIntTriplet = (a) => a.length >= 3 && a.slice(0, 3).every((t) => /^[-+]?\d+$/.test(t));
  if (isIntTriplet(l3)) {
    format = 'BandPoints';
    [emin, emax] = l2;
    header = l3.map(Number);
  } else {
    format = 'BandLines';
    [kmin, kmax] = l2;
    [emin, emax] = l3.map(ffloat);
    header = next().trim().split(/\s+/).map(Number);
  }
  const [nBands, nSpin, nk] = header;
  const kcols = format === 'BandLines' ? 1 : 3;
  const per = kcols + nBands * nSpin;

  // read nk*per numbers
  const need = nk * per;
  const vals = new Float64Array(need);
  let got = 0;
  while (got < need && p < L.length) {
    const ln = L[p++];
    if (!ln.trim()) continue;
    for (const t of ln.trim().split(/\s+/)) {
      if (got < need) { let v = +t; if (Number.isNaN(v)) v = ffloat(t); vals[got++] = v; }
    }
  }
  const nkRead = Math.floor(got / per);
  if (nkRead < nk) warnings.push(`file truncated: ${nkRead} of ${nk} k-points read`);

  const xBohr = new Float64Array(nkRead);
  const kpointsBohr = kcols === 3 ? [] : null;
  const bands = Array.from({ length: nSpin }, () => Array.from({ length: nBands }, () => new Float64Array(nkRead)));
  for (let ik = 0; ik < nkRead; ik++) {
    const o = ik * per;
    if (kcols === 1) xBohr[ik] = vals[o];
    else {
      kpointsBohr.push([vals[o], vals[o + 1], vals[o + 2]]);
      if (ik > 0) {
        const a = kpointsBohr[ik - 1], b = kpointsBohr[ik];
        xBohr[ik] = xBohr[ik - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      }
    }
    for (let s = 0; s < nSpin; s++)
      for (let b = 0; b < nBands; b++) bands[s][b][ik] = vals[o + kcols + s * nBands + b];
  }

  // labels (BandLines only)
  const labels = [];
  if (format === 'BandLines') {
    const nlLine = next();
    const nl = nlLine != null ? parseInt(nlLine, 10) : 0;
    for (let i = 0; i < nl; i++) {
      const ln = next();
      if (ln == null) break;
      const m = /^\s*(\S+)\s*(.*)$/.exec(ln);
      const xb = ffloat(m[1]);
      const raw = m[2].trim().replace(/^'(.*)'$/, '$1').trim();
      labels.push({ x: xb / BOHR_ANG, xBohr: xb, raw, label: prettyLabel(raw) });
    }
  }
  const path = format === 'BandLines' ? bandLinesPath(xBohr, labels, warnings) : unknownPath(nkRead,
    'BandPoints no declara tramos ni etiquetas: los puntos se unen en el orden del archivo.');

  const x = Float64Array.from(xBohr, (v) => v / BOHR_ANG);
  return {
    format,
    fermi,
    nBands,
    nSpin,
    nk: nkRead,
    noncollinear: null, // unknown from file alone (NC/SOC writes nSpin=1 and 2*norb bands)
    emin, emax,
    kmin: kmin / BOHR_ANG, kmax: kmax / BOHR_ANG,
    x, xBohr,
    kpoints: kpointsBohr ? kpointsBohr.map((k) => k.map((v) => v / BOHR_ANG)) : null,
    kpointsBohr,
    bands,          // [spin][band][k], absolute energies in eV
    labels,         // [{x (1/Ang), xBohr, raw, label, kIndex}]
    path,           // {source, segments [{start, end, from, to}], breaks, jumps [{index, from, to}], note}
    units: { energy: 'eV', x: '1/Ang', xBohr: '1/Bohr (original)', kpoints: '1/Ang cartesian', kpointsBohr: '1/Bohr (original)' },
    warnings,
  };
}

// ---------------------------------------------------------------- k-path segments
//
// A band plot joins consecutive k-points only inside a segment. Segments come from the file,
// never from a distance or energy threshold:
//  * BandLines (.bands): each label sits on a k-point (x written with the same 6 decimals, so
//    the match tolerance below is the print precision, not a physical cut-off). A BandLines line
//    with 1 point after a labelled point ("U" then "1 ... K") puts two labels on consecutive
//    k-points: that is how seekpath-style paths and this app's fdf writer (tools/fdfgen.js,
//    crystal writeBandLines) declare a jump. SIESTA itself just takes one straight step there,
//    with no intermediate points, so the step is not drawn and both x values are kept.
//  * dftlab pack: the jump is explicit, a new start point at the same x and a label "A|B".
//  * BandPoints and anything else: no segment information; one segment, stated in `note`.

const X_PRINT_TOL = 1e-6; // .bands writes x with 6 decimals (labels and k lines alike)

function unknownPath(nk, note) {
  return { source: 'none', segments: nk ? [{ start: 0, end: nk - 1, from: null, to: null }] : [], breaks: [], jumps: [], note };
}

function segmentsFromBreaks(nk, breaks, labelAt) {
  const cuts = [0, ...breaks, nk], segments = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const start = cuts[i], end = cuts[i + 1] - 1;
    segments.push({ start, end, from: labelAt(start), to: labelAt(end) });
  }
  return segments;
}

function bandLinesPath(xBohr, labels, warnings) {
  const nk = xBohr.length;
  let p = 0;
  for (const l of labels) {
    let i = p;
    while (i < nk && !(Math.abs(xBohr[i] - l.xBohr) <= X_PRINT_TOL)) i++;
    if (i >= nk) {
      warnings.push(`band label '${l.raw}' at x = ${l.xBohr} does not match any k-point; path segments unknown`);
      labels.forEach((m) => { m.kIndex = null; });
      return unknownPath(nk, 'Las etiquetas del .bands no coinciden con sus puntos k: no se puede reconstruir el camino; los puntos se unen en orden.');
    }
    l.kIndex = i;
    p = i + 1;
  }
  const breaks = [], jumps = [];
  for (let j = 1; j + 1 < labels.length; j++) {
    const a = labels[j], b = labels[j + 1];
    if (b.kIndex === a.kIndex + 1) { breaks.push(b.kIndex); jumps.push({ index: b.kIndex, from: a.label, to: b.label }); }
  }
  const byIndex = new Map(labels.map((l) => [l.kIndex, l.label]));
  return {
    source: 'BandLines',
    segments: segmentsFromBreaks(nk, breaks, (i) => byIndex.get(i) ?? null),
    breaks, jumps,
    note: jumps.length
      ? 'Saltos declarados en BandLines (línea de 1 punto tras un punto etiquetado): ' + jumps.map((j) => `${j.from}|${j.to}`).join(', ') + '. SIESTA da un solo paso recto entre ambos puntos, sin puntos intermedios; no se dibuja.'
      : null,
  };
}

/** Segments of a dftlab pack path: a break where a new start point repeats the previous x
 *  and the label at that x is "A|B" (dftlab_pack.py build_path). Label x is written with 6
 *  decimals and the x array may be float32, so labels match within that print/storage precision. */
export function packPath(x, labels) {
  const nk = x.length, breaks = [], jumps = [];
  const same = (a, b) => Math.abs(a - b) <= 5e-7 + 1.2e-7 * Math.abs(b);
  for (let i = 1; i < nk; i++) {
    if (x[i] !== x[i - 1]) continue;
    const l = labels.find((m) => same(m.x, x[i]) && m.label.includes('|'));
    if (!l) continue;
    const [from, to] = l.label.split('|');
    breaks.push(i); jumps.push({ index: i, from, to });
  }
  const labelAt = (i) => {
    const l = labels.find((m) => same(m.x, x[i]));
    if (!l || !l.label.includes('|')) return l ? l.label : null;
    const [from, to] = l.label.split('|');
    return breaks.includes(i) ? to : from;   // end of the previous segment gets A, the new start gets B
  };
  return {
    source: 'dftlab-pack',
    segments: segmentsFromBreaks(nk, breaks, labelAt),
    breaks, jumps,
    note: jumps.length ? 'Saltos del camino en el paquete: ' + jumps.map((j) => `${j.from}|${j.to}`).join(', ') + '.' : null,
  };
}

/** [[x, y]] for one band with a [x, NaN] row before every segment start, so the chart
 *  (which joins only consecutive finite points) does not connect two segments. */
export function segmentSeries(x, y, breaks = []) {
  const br = new Set(breaks), d = [];
  for (let i = 0; i < x.length; i++) {
    if (br.has(i)) d.push([x[i], NaN]);
    d.push([x[i], y[i]]);
  }
  return d;
}

/** 1-based segment number of every k-point (for exports). */
export function segmentIndex(nk, breaks = []) {
  const out = new Int32Array(nk), br = new Set(breaks);
  let s = 1;
  for (let i = 0; i < nk; i++) { if (br.has(i)) s++; out[i] = s; }
  return out;
}

/** Return bands shifted so that E_F = 0 (new object, same shape). */
export function shiftToFermi(bandsData) {
  const ef = bandsData.fermi;
  return {
    ...bandsData,
    bands: bandsData.bands.map((sp) => sp.map((b) => Float64Array.from(b, (e) => e - ef))),
    energyReference: 'E_F',
  };
}

/** Simple band-edge analysis along the path (VBM/CBM w.r.t. E_F). */
export function bandEdges(bandsData) {
  const ef = bandsData.fermi;
  let vbm = { e: -Infinity }, cbm = { e: Infinity }, crossing = false;
  bandsData.bands.forEach((sp, s) => sp.forEach((b, ib) => {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < b.length; k++) {
      const e = b[k];
      if (e < lo) lo = e;
      if (e > hi) hi = e;
      if (e <= ef && e > vbm.e) vbm = { e, k, band: ib, spin: s, x: bandsData.x[k] };
      if (e > ef && e < cbm.e) cbm = { e, k, band: ib, spin: s, x: bandsData.x[k] };
    }
    if (lo < ef - 1e-6 && hi > ef + 1e-6) crossing = true;
  }));
  const gap = crossing ? 0 : Math.max(0, cbm.e - vbm.e);
  return { vbm, cbm, gap, metallic: crossing, direct: !crossing && vbm.k === cbm.k };
}
