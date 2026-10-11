// Genera app/dftlab/static/js/data/espin.json a partir de las corridas de espín (SIESTA 5.4.2).
//   node espin_gen_json.mjs <carpeta_fe> <carpeta_nio_fm> <nio.json existente> <salida.json>
// carpeta_fe: fe_fm_<a>, fe_nm_<a>, fe_{fm,nm}_2.866_pdos (con .bands y .PDOS); carpeta_nio_fm: fm_u<U>.
// Las corridas AFM de NiO son las de nio.json (sección 8); no se repiten.
// Usa los mismos lectores que la app (siesta/index.js).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const APP = process.env.DFTLAB_JS || '/mnt/project-files/DFT_App/app/dftlab/static/js';
const S = await import(pathToFileURL(path.join(APP, 'siesta/index.js')).href);
const [feDir, nioDir, nioJson, outFile = 'espin.json'] = process.argv.slice(2);
const rd = (f) => fs.readFileSync(f, 'utf8');
const r = (x, d) => Number(x.toFixed(d));
const exists = (f) => fs.existsSync(f);

// ---------- Fe ----------
const A_EXP = 2.866;
const feA = [2.70, 2.75, 2.80, 2.85, 2.866, 2.90, 2.95, 3.00];
const outOf = (dir, n) => S.parseOut(rd(path.join(dir, n, n + '.out')));
const eos = [];
for (const a of feA) {
  const nf = `fe_fm_${a.toFixed(3)}`, nn = `fe_nm_${a.toFixed(3)}`;
  if (!exists(path.join(feDir, nf, nf + '.out')) || !exists(path.join(feDir, nn, nn + '.out'))) continue;
  const f = outOf(feDir, nf), n = outOf(feDir, nn);
  eos.push({ a, V: r(a ** 3 / 2, 4), Efm: f.finalEnergy.Total, Enm: n.finalEnergy.Total, mom: f.spinMoment.abs, momMull: f.populations.mulliken.atoms[0].Sz,
    nscf: [f.steps.at(-1).scfIterations ?? f.scf?.length, n.steps.at(-1).scfIterations ?? n.scf?.length] });
}
// Birch–Murnaghan de tercer orden por mínimos cuadrados (ajuste cúbico en V^(-2/3) y derivación numérica)
function fitBM(V, E) {
  const x = V.map((v) => v ** (-2 / 3));
  const n = x.length, m = 4;
  const A = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  for (let i = 0; i < n; i++) for (let p = 0; p < m; p++) { b[p] += E[i] * x[i] ** p; for (let q = 0; q < m; q++) A[p][q] += x[i] ** (p + q); }
  for (let i = 0; i < m; i++) { let piv = i; for (let k = i + 1; k < m; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k; [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    for (let k = i + 1; k < m; k++) { const t = A[k][i] / A[i][i]; for (let j = i; j < m; j++) A[k][j] -= t * A[i][j]; b[k] -= t * b[i]; } }
  const c = new Array(m).fill(0); for (let i = m - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < m; j++) s -= A[i][j] * c[j]; c[i] = s / A[i][i]; }
  const Ef = (v) => { const y = v ** (-2 / 3); return c[0] + c[1] * y + c[2] * y * y + c[3] * y ** 3; };
  const lo = Math.min(...V), hi = Math.max(...V);
  let best = lo; for (let v = lo; v <= hi; v += (hi - lo) / 4000) if (Ef(v) < Ef(best)) best = v;
  const h = (hi - lo) / 200; const d2 = (Ef(best + h) - 2 * Ef(best) + Ef(best - h)) / (h * h);
  const B = best * d2 * 160.2176634;     // eV/Å³ → GPa
  return { V0: best, a0: (2 * best) ** (1 / 3), E0: Ef(best), B0: B };
}
const fitFm = fitBM(eos.map((e) => e.V), eos.map((e) => e.Efm));
const fitNm = fitBM(eos.map((e) => e.V), eos.map((e) => e.Enm));
const eAtExp = eos.find((e) => e.a === A_EXP);

function feBands(mode) {
  const n = `fe_${mode}_${A_EXP.toFixed(3)}_pdos`;
  const b = S.parseBands(rd(path.join(feDir, n, n + '.bands')));
  const ef = b.fermi;
  const sel = []; for (let ib = 0; ib < b.nBands; ib++) { const v = b.bands[0][ib]; if (v.some((e) => e - ef > -11 && e - ef < 9)) sel.push(ib); }
  const spins = b.nSpin === 2 ? [0, 1] : [0];
  const bands = spins.map((s) => sel.map((ib) => Array.from(b.bands[s][ib], (e) => r(e - ef, 3))));
  return { fermi: r(ef, 4), nk: b.nk, x: Array.from(b.x, (v) => r(v, 4)), labels: b.labels.map((l) => ({ x: r(l.x, 4), label: l.label })), up: bands[0], dn: bands[1] || bands[0] };
}
function fePdos(mode) {
  const n = `fe_${mode}_${A_EXP.toFixed(3)}_pdos`;
  const p = S.parsePDOS(rd(path.join(feDir, n, n + '.PDOS')));
  const ef = p.fermi, ns = p.nspin;
  const idx = []; for (let i = 0; i < p.energy.length; i++) { const e = p.energy[i] - ef; if (e >= -9 && e <= 6.0001) idx.push(i); }
  const E = idx.map((i) => r(p.energy[i] - ef, 3));
  const out = { fermi: r(ef, 4), E, nspin: ns };
  const grp = (spin) => Object.fromEntries(S.groupPDOS(p, ['species', 'l'], spin).map((g) => [g.label, g.data]));
  const up = ns === 2 ? grp('up') : grp('total'), dn = ns === 2 ? grp('down') : null;
  out.up = {}; out.dn = {};
  for (const l of ['s', 'p', 'd']) {
    out.up[l] = idx.map((i) => r(up['Fe-' + l][i] * (ns === 2 ? 1 : 0.5), 4));
    out.dn[l] = idx.map((i) => r((dn ? dn['Fe-' + l] : up['Fe-' + l])[i] * (dn ? 1 : 0.5), 4));
  }
  return out;
}
const fe = { eos, fitFm, fitNm, aExp: A_EXP, bands: { fm: feBands('fm'), nm: feBands('nm') }, pdos: { fm: fePdos('fm'), nm: fePdos('nm') } };
// magnitudes derivadas de la PDOS
{
  const c = (P, key, lo, hi) => { let s0 = 0, s1 = 0; const dE = P.E[1] - P.E[0]; P.E.forEach((e, i) => { if (e >= lo && e <= hi) { s0 += P[key].d[i]; s1 += P[key].d[i] * e; } }); return { N: s0 * dE, c: s1 / s0 }; };
  const P = fe.pdos.fm;
  const up = c(P, 'up', -9, 0), dn = c(P, 'dn', -9, 0), upA = c(P, 'up', -9, 6), dnA = c(P, 'dn', -9, 6);
  const Nnm = fe.pdos.nm; const iF = Nnm.E.findIndex((e) => e >= 0);
  const avg = (arr, w) => { let s = 0, n = 0; Nnm.E.forEach((e, i) => { if (Math.abs(e) <= w) { s += arr[i]; n++; } }); return s / n; };
  // PDOS en nm es por espín (ya dividida entre 2)
  const NEF = ['s', 'p', 'd'].reduce((t, l) => t + avg(Nnm.up[l], 0.1), 0);
  fe.derived = { dOccUp: r(up.N, 3), dOccDn: r(dn.N, 3), cUp: r(upA.c, 3), cDn: r(dnA.c, 3), exchSplit: r(dnA.c - upA.c, 3), cUpOcc: r(up.c, 3), cDnOcc: r(dn.c, 3), exchSplitOcc: r(dn.c - up.c, 3), dTotUp: r(upA.N, 3), dTotDn: r(dnA.N, 3), NEFperSpin: r(NEF, 3) };
}
fe.fdf = rd(path.join(feDir, `fe_fm_${A_EXP.toFixed(3)}_pdos`, `fe_fm_${A_EXP.toFixed(3)}_pdos.fdf`));

// ---------- NiO ----------
const nio = JSON.parse(rd(nioJson));
const scan = [];
for (const s of nio.scan) {
  const U = s.U, n = `fm_u${U}`;
  if (!exists(path.join(nioDir, n, n + '.out'))) continue;
  const o = outOf(nioDir, n);
  const eig = S.parseEIG(rd(path.join(nioDir, n, n + '.EIG')), exists(path.join(nioDir, n, n + '.KP')) ? rd(path.join(nioDir, n, n + '.KP')) : null);
  const g = S.analyzeGap(eig);
  const sz = o.populations.mulliken.atoms;
  const ref = g.metallic ? g.fermi : g.vbm.e;
  let pd = null;
  const pf = path.join(nioDir, n, n + '.PDOS');
  if (exists(pf)) {
    const p = S.parsePDOS(rd(pf));
    const up = Object.fromEntries(S.groupPDOS(p, ['species', 'l'], 'up').map((q) => [q.label, q.data]));
    const dn = Object.fromEntries(S.groupPDOS(p, ['species', 'l'], 'down').map((q) => [q.label, q.data]));
    const E = s.E; // misma rejilla que la corrida AFM (E − borde de valencia)
    const interp = (arr) => E.map((e) => { const x = e + ref; let j = 0; while (j < p.energy.length - 2 && p.energy[j + 1] < x) j++; const t = (x - p.energy[j]) / (p.energy[j + 1] - p.energy[j]); return r(arr[j] * (1 - t) + arr[j + 1] * t, 4); });
    pd = { 'Ni1-d': { up: interp(up['Ni1-d']), dn: interp(dn['Ni1-d']) }, 'O-p': { up: interp(up['O-p']), dn: interp(dn['O-p']) } };
  }
  scan.push({ U, afm: { etot: s.etot, gap: r(s.gap, 3), type: s.type, mom: r(s.mom, 3), pdos: s.pdos ? { 'Ni1-d': s.pdos['Ni1-d'], 'O-p': s.pdos['O-p'] } : null },
    fm: { etot: o.finalEnergy.Total, gap: r(g.gap, 3), metallic: !!g.metallic, type: g.type, mom: r(sz[0].Sz, 3), momNi2: r(sz[1].Sz, 3), S: o.spinMoment.abs, nscf: o.steps.at(-1).scfIterations, pdos: pd },
    dE: r(o.finalEnergy.Total - s.etot, 4) });
}
const res = { fe, nio: { E: nio.scan[0].E, scan, fdfFm: null } };
const f8 = path.join(nioDir, 'fm_u8', 'fm_u8.fdf'); if (exists(f8)) res.nio.fdfFm = rd(f8);
fs.writeFileSync(outFile, JSON.stringify(res));
console.log('escrito', outFile, (fs.statSync(outFile).size / 1024).toFixed(0) + ' KB');
console.log('Fe FM  a0 %s  B0 %s GPa  E0 %s', r(fitFm.a0, 4), r(fitFm.B0, 0), r(fitFm.E0, 4));
console.log('Fe NM  a0 %s  B0 %s GPa  E0 %s', r(fitNm.a0, 4), r(fitNm.B0, 0), r(fitNm.E0, 4));
console.log('Fe a=2.866: Efm-Enm', eAtExp ? r(eAtExp.Efm - eAtExp.Enm, 4) : '-', 'mom', eAtExp?.mom, JSON.stringify(fe.derived));
console.log(JSON.stringify(scan.map((s) => [s.U, s.dE, s.afm.gap, s.fm.gap, s.fm.metallic, s.afm.mom, s.fm.mom, s.fm.S])));
