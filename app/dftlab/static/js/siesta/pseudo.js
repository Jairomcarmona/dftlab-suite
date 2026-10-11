// Norm-conserving pseudopotential files used by SIESTA: .psf (ATOM) and .psml (PSML 1.0/1.1).
//
// Output units (documented in `units`): r in Bohr; potentials V(r) in Ry (psml Hartree values are
// multiplied by 2; the original unit is recorded); charge densities in the convention of each format
// (psf: 4*pi*r^2*rho(r); psml: f(r) = 4*pi*rho(r), i.e. int r^2 f dr = Q); helper `radialCharge`
// gives 4*pi*r^2*rho(r) for a psml density so that int radialCharge dr = number of electrons.
import { parseXML, xchild, xchildren, xfind, xfindAll, xtext, attrStr, ffloat, floatBlock, lines as splitLines, trapz } from './util.js';

const LSYM = ['s', 'p', 'd', 'f', 'g'];
const LNUM = { s: 0, p: 1, d: 2, f: 3, g: 4 };

// ----------------------------------------------------------------------------- PSF
export function parsePSF(text) {
  const L = splitLines(text);
  const h1 = L[0].trim().split(/\s+/);
  const h2 = L[1];
  const config = L[2];
  const g = L[3].trim().split(/\s+/);
  const nDown = parseInt(g[0], 10), nUp = parseInt(g[1], 10), nr = parseInt(g[2], 10);
  const a = ffloat(g[3]), b = ffloat(g[4]), zval = ffloat(g[5]);
  const name = h1[0], xc = h1[1], relFlag = h1[2], coreFlag = h1[3];
  // configuration line: "3s 2.00  r= 1.89/3p 2.00  r= 1.89/..."
  const shells = [];
  for (const part of config.split('/')) {
    const m = /(\d)([spdfg])\s*([-\d.]+)\s*r?\s*r=\s*([-\d.]+)/.exec(part);
    if (m) shells.push({ n: +m[1], l: LNUM[m[2]], lsym: m[2], occupation: ffloat(m[3]), rc: ffloat(m[4]) });
  }
  const m2 = /^\s*(\S+)\s+(\S+)\s+(.*)$/.exec(h2) || [];
  const header = {
    name, xc, relativistic: relFlag, coreCorrection: coreFlag,
    generator: m2[1] ?? '', date: m2[2] ?? '', method: (m2[3] ?? '').trim(),
    configurationLine: config.trim(), shells, zval,
    rawHeader: [L[0], L[1], L[2], L[3]].map((s) => s.replace(/\s+$/, '')),
  };
  // sections
  let p = 4;
  const readN = (n) => {
    const out = new Float64Array(n);
    let k = 0;
    while (k < n && p < L.length) {
      const t = L[p++].trim();
      if (!t) continue;
      for (const tok of t.split(/\s+/)) if (k < n) out[k++] = ffloat(tok);
    }
    return out;
  };
  let r = null;
  const down = [], up = [];
  let core = null, valence = null;
  while (p < L.length) {
    const t = L[p].trim();
    p++;
    if (/Radial grid follows/i.test(t)) r = readN(nr);
    else if (/(Down|Up) Pseudopotential follows/i.test(t)) {
      const isUp = /^Up/i.test(t);
      const l = parseInt(L[p++].trim(), 10);
      const rV = readN(nr);
      const V = Float64Array.from(rV, (v, i) => v / r[i]);
      (isUp ? up : down).push({ l, lsym: LSYM[l], rV, V });
    } else if (/Core charge follows/i.test(t)) core = readN(nr);
    else if (/Valence charge follows/i.test(t)) valence = readN(nr);
  }
  // r(i) = a*(exp(b*i)-1), i=1..nr (the origin is not stored)
  const kind = relFlag === 'rel' ? 'scalar-relativistic + spin-orbit' : relFlag === 'isp' ? 'spin-polarized' : 'non-relativistic';
  const res = {
    format: 'psf',
    header,
    grid: { npts: nr, a, b, recipe: 'r(i) = a*(exp(b*i)-1), i=1..nr', r },
    semilocal: { down, up, upMeaning: relFlag === 'rel' ? 'spin-orbit potentials' : relFlag === 'isp' ? 'spin-up' : 'none' },
    potentialKind: kind,
    coreCharge: core,       // 4*pi*r^2*rho_core
    valenceCharge: valence, // 4*pi*r^2*rho_val
    units: { r: 'Bohr', V: 'Ry', rV: 'Ry*Bohr (original)', charge: '4*pi*r^2*rho (electrons/Bohr)' },
  };
  res.valenceElectrons = valence ? trapz(r, valence) : NaN;
  res.coreElectrons = core ? trapz(r, core) : 0;
  return res;
}

// ----------------------------------------------------------------------------- PSML
function gridFrom(node) {
  const gd = xchild(node, 'grid-data');
  return gd ? floatBlock(xtext(gd)) : null;
}

function readRadfunc(rf, globalGrid) {
  if (!rf) return null;
  const g = xchild(rf, 'grid');
  const grid = g ? gridFrom(g) : globalGrid;
  const dn = xchild(rf, 'data');
  const f = floatBlock(xtext(dn));
  const npts = dn && dn.attrs.npts ? parseInt(dn.attrs.npts, 10) : f.length;
  return { r: grid ? grid.slice(0, Math.min(npts, f.length)) : null, f: f.slice(0, npts) };
}

export function parsePSML(text) {
  const doc = parseXML(text);
  const psml = doc.children.find((c) => c.name === 'psml');
  if (!psml) throw new Error('Not a PSML file');
  const energyUnit = (attrStr(psml, 'energy_unit') || 'hartree').toLowerCase();
  const toRy = energyUnit.startsWith('hartree') ? 2 : 1;
  const prov = xchildren(psml, 'provenance').map((p) => ({
    creator: attrStr(p, 'creator'), date: attrStr(p, 'date'),
    annotation: xchild(p, 'annotation')?.attrs ?? null,
    inputFile: xchild(p, 'input-file') ? { name: attrStr(xchild(p, 'input-file'), 'name'), content: xchild(p, 'input-file').text.trim() } : null,
  }));
  const spec = xchild(psml, 'pseudo-atom-spec') || xchild(psml, 'header');
  const xcNode = xfind(spec, 'exchange-correlation');
  const libxc = xfind(xcNode, 'libxc-info');
  const header = {
    atomicLabel: attrStr(spec, 'atomic-label'),
    atomicNumber: ffloat(attrStr(spec, 'atomic-number')),
    zPseudo: ffloat(attrStr(spec, 'z-pseudo')),
    flavor: attrStr(spec, 'flavor'),
    relativity: attrStr(spec, 'relativity'),
    spinDft: attrStr(spec, 'spin-dft') ?? attrStr(spec, 'polarized'),
    coreCorrections: attrStr(spec, 'core-corrections'),
    annotation: xchild(spec, 'annotation')?.attrs ?? null,
    xcAnnotation: xchild(xcNode, 'annotation')?.attrs ?? null,
    libxc: libxc ? xchildren(libxc, 'functional').map((f) => ({ name: attrStr(f, 'name'), type: attrStr(f, 'type'), id: parseInt(attrStr(f, 'id'), 10) })) : [],
    valenceConfiguration: xchildren(xfind(spec, 'valence-configuration'), 'shell').map((s) => ({
      n: +attrStr(s, 'n'), l: LNUM[attrStr(s, 'l')], lsym: attrStr(s, 'l'), occupation: ffloat(attrStr(s, 'occupation')),
      occupationUp: s.attrs['occupation-up'] != null ? ffloat(s.attrs['occupation-up']) : undefined,
      occupationDown: s.attrs['occupation-down'] != null ? ffloat(s.attrs['occupation-down']) : undefined,
    })),
  };
  const gnode = xchild(psml, 'grid');
  const grid = gnode ? gridFrom(gnode) : null;
  const gridInfo = gnode ? { npts: parseInt(attrStr(gnode, 'npts'), 10), annotation: xchild(gnode, 'annotation')?.attrs ?? null, r: grid } : null;

  const scaled = (rf, factor) => (rf ? { r: rf.r, f: factor === 1 ? rf.f : Float64Array.from(rf.f, (v) => v * factor) } : null);

  // semilocal potentials (may be several sets)
  const semilocal = xfindAll(psml, 'semilocal-potentials').map((s) => ({
    set: attrStr(s, 'set') ?? 'non_relativistic',
    potentials: xchildren(s, 'slps').map((v) => {
      const rf = readRadfunc(xchild(v, 'radfunc'), grid);
      return {
        n: +attrStr(v, 'n'), l: LNUM[attrStr(v, 'l')], lsym: attrStr(v, 'l'),
        j: v.attrs.j != null ? ffloat(v.attrs.j) : null,
        rc: ffloat(attrStr(v, 'rc')), eref: v.attrs.eref != null ? ffloat(v.attrs.eref) * toRy : null,
        flavor: attrStr(v, 'flavor'),
        r: rf.r, V: Float64Array.from(rf.f, (x) => x * toRy),
      };
    }),
  }));
  const pswf = xfindAll(psml, 'pseudo-wave-functions').map((s) => ({
    set: attrStr(s, 'set') ?? 'non_relativistic',
    functions: xchildren(s, 'pswf').map((w) => {
      const rf = readRadfunc(xchild(w, 'radfunc'), grid);
      return { n: +attrStr(w, 'n'), l: LNUM[attrStr(w, 'l')], lsym: attrStr(w, 'l'), j: w.attrs.j != null ? ffloat(w.attrs.j) : null, r: rf.r, f: rf.f };
    }),
  }));
  const projectors = xfindAll(psml, 'nonlocal-projectors').map((s) => ({
    set: attrStr(s, 'set') ?? 'non_relativistic',
    projectors: xchildren(s, 'proj').map((pj) => {
      const rf = readRadfunc(xchild(pj, 'radfunc'), grid);
      return {
        l: LNUM[attrStr(pj, 'l')], lsym: attrStr(pj, 'l'), seq: +attrStr(pj, 'seq'),
        j: pj.attrs.j != null ? ffloat(pj.attrs.j) : null,
        ekb: ffloat(attrStr(pj, 'ekb')) * toRy, eref: pj.attrs.eref != null ? ffloat(pj.attrs.eref) * toRy : null,
        type: attrStr(pj, 'type'), r: rf.r, f: rf.f,
      };
    }),
  }));
  const lp = xchild(psml, 'local-potential');
  const local = lp ? { type: attrStr(lp, 'type'), ...(() => { const rf = readRadfunc(xchild(lp, 'radfunc'), grid); return { r: rf.r, V: Float64Array.from(rf.f, (x) => x * toRy) }; })() } : null;
  const vc = xchild(psml, 'valence-charge');
  const valence = vc ? { totalCharge: ffloat(attrStr(vc, 'total-charge')), ...readRadfunc(xchild(vc, 'radfunc'), grid) } : null;
  const cc = xchild(psml, 'pseudocore-charge');
  const core = cc ? {
    matchingRadius: ffloat(attrStr(cc, 'matching-radius')),
    continuousDerivatives: attrStr(cc, 'number-of-continuous-derivatives'),
    ...readRadfunc(xchild(cc, 'radfunc'), grid),
  } : null;
  const res = {
    format: 'psml',
    version: attrStr(psml, 'version'),
    uuid: attrStr(psml, 'uuid'),
    energyUnitOriginal: energyUnit, lengthUnitOriginal: attrStr(psml, 'length_unit') || 'bohr',
    provenance: prov,
    header,
    grid: gridInfo,
    semilocal,          // [{set, potentials:[{n,l,j,rc,eref,r,V}]}]
    pseudoWaveFunctions: pswf,
    projectors,         // [{set, projectors:[{l,seq,j,ekb,eref,type,r,f}]}]
    localPotential: local,
    valenceCharge: valence, // f = 4*pi*rho(r) as stored
    coreCharge: core,       // f = 4*pi*rho_core(r) as stored
    units: { r: 'Bohr', V: 'Ry (converted from ' + energyUnit + ')', ekb: 'Ry', charge: '4*pi*rho(r) (electrons/Bohr^3, as stored; int r^2 f dr = Q)' },
  };
  res.valenceElectrons = valence ? trapz(valence.r, radialCharge(valence)) : NaN;
  res.coreElectrons = core ? trapz(core.r, radialCharge(core)) : 0;
  return res;
}

/** 4*pi*r^2*rho(r) for a psml density {r, f=4*pi*rho}; psf charges are already in this form. */
export function radialCharge(rho) {
  return Float64Array.from(rho.f, (v, i) => rho.r[i] * rho.r[i] * v);
}

export function parsePseudo(name, text) {
  return /\.psml$/i.test(name) || /<psml/.test(String(text).slice(0, 2000)) ? parsePSML(text) : parsePSF(text);
}
