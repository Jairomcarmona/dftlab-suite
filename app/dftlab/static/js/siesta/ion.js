// SIESTA basis/species files: Label.ion.xml and the plain-text Label.ion.
//
// Radial functions are tabulated on uniform grids r_i = (i-1)*delta (Bohr) up to the cutoff.
// SIESTA stores the PAOs as f(r) = R(r)/r^l, i.e. phi_lm(r) = f(r) r^l Y_lm(r^).
// The helpers below also return R(r) = f(r) r^l and the normalization int R^2 r^2 dr.
// Units (original, kept): r in Bohr; Vna in Ry; KB reference energies in Ry; self energy in Ry.
// chlocal is the local-pseudopotential screening charge (negative, integrates to -Zval);
// core is the pseudo-core (partial core correction) charge density.
import { parseXML, xchild, xchildren, xtext, attrStr, ffloat, floatBlock, lines as splitLines, trapz, BOHR_ANG, RY_EV } from './util.js';

const LSYM = ['s', 'p', 'd', 'f', 'g'];

function radfuncXML(node) {
  const rf = xchild(node, 'radfunc') || node;
  const npts = parseInt(xtext(xchild(rf, 'npts')), 10);
  const delta = ffloat(xtext(xchild(rf, 'delta')));
  const cutoff = ffloat(xtext(xchild(rf, 'cutoff')));
  const d = floatBlock(xtext(xchild(rf, 'data')));
  return twoCol(d, npts, delta, cutoff);
}

function twoCol(d, npts, delta, cutoff) {
  const n = Math.min(npts || d.length / 2, Math.floor(d.length / 2));
  const r = new Float64Array(n), f = new Float64Array(n);
  for (let i = 0; i < n; i++) { r[i] = d[2 * i]; f[i] = d[2 * i + 1]; }
  return { npts: n, delta, cutoff, r, f };
}

function finishOrbital(o) {
  const R = Float64Array.from(o.f, (v, i) => v * o.r[i] ** o.l);
  const norm = trapz(o.r, Float64Array.from(R, (v, i) => v * v * o.r[i] * o.r[i]));
  return {
    ...o,
    R,                                   // R(r) = f(r) r^l  (Bohr^-3/2)
    norm,
    name: `${o.n}${LSYM[o.l] ?? o.l}${o.polarized ? ' (pol)' : ''} ζ${o.z}`,
    cutoffAng: o.cutoff * BOHR_ANG,
  };
}

export function parseIonXML(text) {
  const doc = parseXML(text);
  const ion = doc.children.find((c) => c.name === 'ion');
  if (!ion) throw new Error('Not a SIESTA ion.xml file');
  const t = (k) => xtext(xchild(ion, k));
  const pre = xchild(ion, 'preamble');
  const out = {
    format: 'ion.xml',
    version: attrStr(ion, 'version'),
    symbol: t('symbol'), label: t('label'),
    Z: parseInt(t('z'), 10), valence: ffloat(t('valence')), mass: ffloat(t('mass')),
    selfEnergy: ffloat(t('self_energy')),
    lmaxBasis: parseInt(t('lmax_basis'), 10), norbsNl: parseInt(t('norbs_nl'), 10),
    lmaxProjs: parseInt(t('lmax_projs'), 10), nprojsNl: parseInt(t('nprojs_nl'), 10),
    ljProjs: /true|^t/i.test(t('lj_projs')),
    basisSpecs: pre ? xtext(xchild(pre, 'basis_specs')) : '',
    pseudoHeader: pre ? xtext(xchild(pre, 'pseudopotential_header')).split('\n').map((s) => s.trim()).filter(Boolean) : [],
  };
  out.orbitals = xchildren(xchild(ion, 'paos'), 'orbital').map((o) => finishOrbital({
    l: parseInt(attrStr(o, 'l'), 10), n: parseInt(attrStr(o, 'n'), 10), z: parseInt(attrStr(o, 'z'), 10),
    polarized: parseInt(attrStr(o, 'ispol'), 10) === 1, population: ffloat(attrStr(o, 'population')),
    ...radfuncXML(o),
  }));
  out.projectors = xchildren(xchild(ion, 'kbs'), 'projector').map((p) => ({
    l: parseInt(attrStr(p, 'l'), 10),
    j: attrStr(p, 'j') != null ? ffloat(attrStr(p, 'j')) : null,
    n: parseInt(attrStr(p, 'n'), 10),
    refEnergy: ffloat(attrStr(p, 'ref_energy')),
    ...radfuncXML(p),
  }));
  for (const k of ['vna', 'chlocal', 'reduced_vlocal', 'core']) {
    const node = xchild(ion, k);
    const key = k === 'reduced_vlocal' ? 'reducedVlocal' : k;
    out[key] = node ? radfuncXML(node) : null;
  }
  return finishIon(out);
}

export function parseIon(text) {
  const L = splitLines(text);
  let p = 0;
  const out = { format: 'ion' };
  // preamble (optional)
  const preEnd = L.findIndex((l) => l.includes('</preamble>'));
  if (preEnd >= 0) {
    const pre = L.slice(0, preEnd).join('\n');
    const bs = /<basis_specs>([\s\S]*?)<\/basis_specs>/.exec(pre);
    const ph = /<pseudopotential_header>([\s\S]*?)<\/pseudopotential_header>/.exec(pre);
    out.basisSpecs = bs ? bs[1].trim() : '';
    out.pseudoHeader = ph ? ph[1].split('\n').map((s) => s.trim()).filter(Boolean) : [];
    p = preEnd + 1;
  }
  const val = () => L[p++].replace(/#.*/, '').trim();
  out.symbol = val(); out.label = val();
  out.Z = parseInt(val(), 10); out.valence = ffloat(val()); out.mass = ffloat(val()); out.selfEnergy = ffloat(val());
  [out.lmaxBasis, out.norbsNl] = val().split(/\s+/).map(Number);
  [out.lmaxProjs, out.nprojsNl] = val().split(/\s+/).map(Number);
  out.orbitals = []; out.projectors = []; out.vna = null; out.chlocal = null; out.core = null; out.reducedVlocal = null;
  out.ljProjs = false;
  let section = null;
  const readTable = () => {
    const [npts, delta, cutoff] = L[p++].replace(/#.*/, '').trim().split(/\s+/).map(ffloat);
    const d = floatBlock(L.slice(p, p + npts).join(' '));
    p += npts;
    return twoCol(d, npts, delta, cutoff);
  };
  while (p < L.length) {
    const ln = L[p];
    const t = ln.trim();
    if (!t) { p++; continue; }
    const sec = /^#\s*([A-Za-z ]+):_*/.exec(t);
    if (sec) { section = sec[1].trim().toLowerCase(); p++; continue; }
    if (section === 'paos') {
      const [l, n, z, ispol, pop] = t.replace(/#.*/, '').trim().split(/\s+/).map(ffloat);
      p++;
      out.orbitals.push(finishOrbital({ l, n, z, polarized: ispol === 1, population: pop, ...readTable() }));
    } else if (section === 'kbs') {
      const v = t.replace(/#.*/, '').trim().split(/\s+/).map(ffloat);
      const lj = /kb l, j/.test(t);
      if (lj) out.ljProjs = true;
      p++;
      const [l, j, n, ref] = lj ? v : [v[0], null, v[1], v[2]];
      out.projectors.push({ l, j, n, refEnergy: ref, ...readTable() });
    } else if (section) {
      const key = { vna: 'vna', chlocal: 'chlocal', core: 'core', 'reduced vlocal': 'reducedVlocal' }[section] ?? section;
      out[key] = readTable();
      section = null;
    } else p++;
  }
  return finishIon(out);
}

function finishIon(out) {
  // per-l summary of the basis: number of zetas, cutoffs
  const shells = new Map();
  for (const o of out.orbitals) {
    const k = `${o.n}${o.l}${o.polarized ? 'P' : ''}`;
    if (!shells.has(k)) shells.set(k, { n: o.n, l: o.l, lsym: LSYM[o.l], polarized: o.polarized, population: 0, zetas: [] });
    const s = shells.get(k);
    s.zetas.push({ z: o.z, cutoff: o.cutoff, cutoffAng: o.cutoffAng });
    s.population += o.population || 0;
  }
  out.basis = [...shells.values()];
  out.nOrbitalsTotal = out.orbitals.reduce((a, o) => a + 2 * o.l + 1, 0);
  out.selfEnergyEV = out.selfEnergy * RY_EV;
  out.units = {
    r: 'Bohr (original)', cutoffAng: 'Ang', f: 'R(r)/r^l', R: 'Bohr^-3/2',
    vna: 'Ry', refEnergy: 'Ry', selfEnergy: 'Ry', selfEnergyEV: 'eV', chlocal: 'electrons/Bohr^3', core: 'electrons/Bohr^3',
  };
  return out;
}
