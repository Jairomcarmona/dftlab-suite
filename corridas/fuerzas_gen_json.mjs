// Genera app/dftlab/static/js/data/fuerzas.json a partir de las corridas de «Fuerzas, estrés y relajación» (SIESTA 5.4.2).
//   node fuerzas_gen_json.mjs <carpeta fuerzas extraída> <salida.json>
// La carpeta contiene hf/ (H₂O: barrido O–H, egg-box, DM.Tolerance), h2o/ (relajaciones CG, Broyden y FIRE),
// vac/ (Si 64 átomos, vacancia sin relajar y relajada con CG) y eos/ (Si de 2 átomos: E(a) con estrés y celda variable).
// Usa el mismo lector que la app (siesta/out.js a través de siesta/index.js).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const APP = process.env.DFTLAB_JS || '/mnt/project-files/DFT_App/app/dftlab/static/js';
const S = await import(pathToFileURL(path.join(APP, 'siesta/index.js')).href);
const [dir, outFile = 'fuerzas.json'] = process.argv.slice(2);
const rd = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const out = (f) => { const t = rd(f); if (!/End of run/.test(t) && !(process.env.PREVIEW && /vac_relax/.test(f))) throw new Error('corrida incompleta: ' + f); return S.parseOut(t); };
const r = (x, n = 6) => +(+x).toFixed(n);
const E = (s) => s.freeEnergy ?? s.etot;
const P = (s) => s.pressure?.total?.kbar ?? s.pressure?.static?.kbar ?? s.pressure?.fromVoigt?.kbar;
const sub = (a, b) => a.map((x, i) => x - b[i]), dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0), nrm = (a) => Math.hypot(...a);
// en una corrida de un solo punto el .out no repite las coordenadas ni las fuerzas por átomo dentro del paso: se toman las iniciales y las finales
const cart = (o, s) => { const c = s.coordinates; if (!c) return o.initialGeometry.positions;
  if (c.unit === 'ang') return c.coords; if (c.unit === 'bohr') return c.coords.map((p) => p.map((x) => x * 0.529177210903));
  if (c.unit === 'fractional'){ const L = s.cell || o.cell; return c.coords.map((f) => [0, 1, 2].map((k) => f[0] * L[0][k] + f[1] * L[1][k] + f[2] * L[2][k])); }
  throw new Error('coordenadas en unidades ' + c.unit); };
const fat = (o, s) => (s.forces.atoms.length ? s.forces.atoms : o.forces.atoms);
const wall = (o) => o.timers?.wallTime;
const files = (d, re) => fs.readdirSync(path.join(dir, d)).filter((f) => re.test(f)).sort();

// ---- 1. Fuerza frente a −dE/dr: H₂O, se estira el O–H del primer H ----
const hf = {};
for (const tag of ['dzp300', 'dzp60', 'sz300']) {
  const rows = files('hf', new RegExp('^' + tag + '_r[\\d.]+\\.out$')).map((f) => {
    const o = out('hf/' + f), s = o.steps.at(-1), c = cart(o, s), u = sub(c[1], c[0]), un = u.map((x) => x / nrm(u));
    return { r: +f.match(/_r([\d.]+)\.out/)[1], E: E(s), F: dot(fat(o, s)[1], un), Fnet: nrm(s.forces.total) };
  });
  hf[tag] = { r: rows.map((x) => x.r), E: rows.map((x) => r(x.E)), F: rows.map((x) => r(x.F, 5)), Fnet: rows.map((x) => r(x.Fnet, 5)) };
}
// ---- 2. Egg-box: la molécula entera se traslada en x ----
const egg = {};
for (const m of [60, 300]) {
  let mesh = null;
  const rows = files('hf', new RegExp('^egg' + m + '_s[\\d.]+\\.out$')).map((f) => {
    const o = out('hf/' + f), s = o.steps.at(-1); mesh = o.mesh;
    return { s: +f.match(/_s([\d.]+)\.out/)[1], E: E(s), Fx: s.forces.total[0], FH: fat(o, s)[1] };
  });
  egg['m' + m] = { mesh: mesh.mesh, cutoffUsed: mesh.cutoffUsed, h: r(10 / mesh.mesh[0], 4), s: rows.map((x) => x.s), E: rows.map((x) => r(x.E)), Fnet: rows.map((x) => r(x.Fx, 5)) };
}
// ---- 3. Tolerancia del SCF ----
const tol = files('hf', /^tol_1e-\d\.out$/).map((f) => { const o = out('hf/' + f), s = o.steps.at(-1);
  return { tol: +('1e-' + f.match(/1e-(\d)/)[1]), E: r(E(s)), F: fat(o, s)[1].map((x) => r(x, 6)), it: s.scfIterations }; });
// ---- 4. Relajación de H₂O ----
const h2o = {};
for (const m of ['cg', 'broyden', 'fire']) {
  const o = out(`h2o/relax_${m}.out`);
  h2o[m] = { nscf: o.steps.reduce((a, s) => a + s.scfIterations, 0), wall: wall(o),
    steps: o.steps.map((s) => ({ E: r(E(s)), F: r(s.maxForce, 5), pos: cart(o, s).map((p) => p.map((x) => r(x, 5))) })) };
}
// ---- 5. Vacancia en Si ----
const bulk = out('vac/bulk64.out'), unrel = out('vac/vac_unrel.out'), vr = out('vac/vac_relax.out');
const L = vr.cell;
const vacSteps = vr.steps.map((s) => ({ E: r(E(s)), F: r(s.maxForce, 4), pos: cart(vr, s).map((p) => p.map((x) => r(x, 4))) }));
const ideal = unrel.initialGeometry.positions;
const vac = { cell: L.map((v) => v.map((x) => r(x, 5))), nAtoms: vr.nAtoms, Ebulk: r(E(bulk.steps.at(-1))), Eunrel: r(E(unrel.steps.at(-1))),
  wall: { bulk: wall(bulk), unrel: wall(unrel), relax: wall(vr) }, nscf: vr.steps.reduce((a, s) => a + s.scfIterations, 0),
  ideal: ideal.map((p) => p.map((x) => r(x, 4))), steps: vacSteps, Pbulk: r(P(bulk.steps.at(-1)), 3), Pvac: r(P(vr.steps.at(-1)), 3) };
// ---- 6. E(a) con estrés y celda variable ----
const eos = {};
for (const tag of ['dzp300', 'dzp100', 'sz300']) {
  const rows = files('eos', new RegExp('^' + tag + '_a[\\d.]+\\.out$')).map((f) => { const o = out('eos/' + f), s = o.steps.at(-1);
    return { a: +f.match(/_a([\d.]+)\.out/)[1], E: E(s), P: P(s), V: o.volume }; });
  eos[tag] = { a: rows.map((x) => x.a), V: rows.map((x) => r(x.V, 4)), E: rows.map((x) => r(x.E)), P: rows.map((x) => r(x.P, 3)) };
}
const vc = out('eos/vc_cg.out');
eos.vc = { wall: wall(vc), steps: vc.steps.map((s) => ({ a: r(Math.cbrt(4 * s.volume), 5), V: r(s.volume, 4), E: r(E(s)), P: r(P(s), 3), sh: r(Math.max(...s.stressVoigtKbar.slice(3).map(Math.abs)), 2), F: r(s.maxForce ?? 0, 5) })) };

const v = (/Version\s*:\s*(\S+)/.exec(rd('eos/vc_cg.out')) || [])[1] || '5.4.2';
const D = {
  meta: { version: v, xc: 'LDA (Ceperley–Alder, Perdew–Zunger)', basis: 'DZP', mesh: 300,
    pseudo: { Si: 'Si.psf (Troullier–Martins)', O: 'O.psml (ONCVPSP 3.3.1, biblioteca de DFT Lab)', H: 'H.psml (ONCVPSP 3.3.1, biblioteca de DFT Lab)' } },
  hf, egg, tol, h2o, vac, eos,
  fdf: { h2o: rd('h2o/relax_cg.fdf'), vac: rd('vac/vac_relax.fdf'), vc: rd('eos/vc_cg.fdf') },
};
fs.writeFileSync(outFile, JSON.stringify(D));
console.log(outFile, (fs.statSync(outFile).size / 1024).toFixed(1), 'KB');
