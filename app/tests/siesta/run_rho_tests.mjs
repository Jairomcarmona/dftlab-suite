#!/usr/bin/env node
// Pruebas del lector de mallas (siesta/rho.js):  node tests/siesta/run_rho_tests.mjs
// Contra fixtures_grid/reference.json (numpy, make_rho_reference.py) y contra mallas sintéticas (little y big endian).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../dftlab/static/js/siesta/index.js';
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures_grid');
const REF = JSON.parse(fs.readFileSync(path.join(F, 'reference.json'), 'utf8'));
let pass = 0, fail = 0; const bad = [];
const check = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + ' ' + d); } };
const close = (n, a, b, tol = 1e-6) => check(n, Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `got ${a} want ${b}`);

for (const name of ['mgo.RHO', 'mgo.DRHO']) {
  const ref = REF[name], buf = fs.readFileSync(path.join(F, name));
  const g = S.parseGrid(buf, name);
  check(name + ' mesh', JSON.stringify(g.mesh) === JSON.stringify(ref.mesh));
  check(name + ' nspin', g.nspin === ref.nspin);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(`${name} cell[${i}][${j}]`, g.cellBohr[i][j], ref.cellBohr[i][j], 1e-12);
  close(name + ' integral', S.gridIntegral(g), ref.integral, 1e-9);
  let mn = Infinity, mx = -Infinity; for (const x of g.data[0]) { mn = Math.min(mn, x); mx = Math.max(mx, x); }
  close(name + ' min', mn, ref.vmin, 1e-9); close(name + ' max', mx, ref.vmax, 1e-9);
  const [nx, ny] = g.mesh;
  for (const s of ref.samples) close(`${name} ${s.i}`, g.data[0][s.i[0] + nx * (s.i[1] + ny * s.i[2])], s.v, 1e-9);
  const pa = S.planarAverage(g, 2); ref.avgZ.forEach((v, i) => close(`${name} avgZ[${i}]`, pa[i][1], v, 1e-9));
  const d = S.detectAndParse(name, buf); check(name + ' detectAndParse', d.kind === 'grid' && d.data && d.data.mesh[0] === ref.mesh[0], JSON.stringify(d).slice(0, 80));
  const m = S.parseMany([{ name, content: buf }]); check(name + ' parseMany', m[0].kind === 'grid' && !!m[0].data);
}
check('units RHO', S.parseGrid(fs.readFileSync(path.join(F, 'mgo.RHO')), 'x.RHO').units === 'e/Bohr³');
check('units VH', S.parseGrid(fs.readFileSync(path.join(F, 'mgo.RHO')), 'x.VH').units === 'Ry');

// synthetic: ρ(r) = 1 + cos(2π x) on a 8×6×4 cubic box of 2 Bohr, 2 spins, both endiannesses
function synth(le) {
  const nx = 8, ny = 6, nz = 4, ns = 2, L = 2;
  const parts = []; const rec = (bytes) => { const h = new DataView(new ArrayBuffer(4)); h.setInt32(0, bytes.byteLength, le); parts.push(new Uint8Array(h.buffer), new Uint8Array(bytes), new Uint8Array(h.buffer)); };
  let b = new DataView(new ArrayBuffer(72)); [L, 0, 0, 0, L, 0, 0, 0, L].forEach((x, i) => b.setFloat64(8 * i, x, le)); rec(b.buffer);
  b = new DataView(new ArrayBuffer(16)); [nx, ny, nz, ns].forEach((x, i) => b.setInt32(4 * i, x, le)); rec(b.buffer);
  for (let s = 0; s < ns; s++) for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    b = new DataView(new ArrayBuffer(4 * nx)); for (let i = 0; i < nx; i++) b.setFloat32(4 * i, (s + 1) * (1 + Math.cos(2 * Math.PI * i / nx)), le); rec(b.buffer);
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
for (const le of [true, false]) {
  const g = S.parseGrid(synth(le), 'syn.RHO'), tag = le ? 'LE' : 'BE';
  check(tag + ' mesh', JSON.stringify(g.mesh) === '[8,6,4]' && g.nspin === 2);
  close(tag + ' integral spin0', S.gridIntegral(g, 0), 8, 1e-6); close(tag + ' integral spin1', S.gridIntegral(g, 1), 16, 1e-6);
  close(tag + ' cell Å', g.cell[2][2], 2 * 0.529177210903, 1e-12);
  close(tag + ' sampleFrac node', S.sampleFrac(g, [0, 0.5, 0.25]), 2, 1e-6);
  close(tag + ' sampleFrac mid', S.sampleFrac(g, [1 / 16, 0, 0]), (2 + (1 + Math.cos(2 * Math.PI / 8))) / 2, 1e-6);   // linear between nodes
  close(tag + ' periodic wrap', S.sampleFrac(g, [1.25, -3.5, 7.0]), S.sampleFrac(g, [0.25, 0.5, 0]), 1e-9);
  const pl = S.planeSlice(g, { origin: [0, 0, 0], e1: [1, 0, 0], e2: [0, 1, 0], len1: g.cell[0][0] * 7 / 8, len2: g.cell[1][1], n1: 8, n2: 3 });
  close(tag + ' plane(0,0)', pl.values[0], 2, 1e-6); close(tag + ' plane(4,*)', pl.values[4], 0, 1e-6);
  const pa = S.planarAverage(g, 0); close(tag + ' planar x[0]', pa[0][1], 2, 1e-6); close(tag + ' planar x[4]', pa[4][1], 0, 1e-6);
  const ln = S.lineProfile(g, [0, 0, 0], [g.cell[0][0] * 7 / 8, 0, 0], 8); close(tag + ' line end', ln[7][1], 1 + Math.cos(2 * Math.PI * 7 / 8), 1e-6);
}
// errors never crash silently
let threw = false; try { S.parseGrid(new Uint8Array(200), 'bad.RHO'); } catch (e) { threw = true; } check('rejects garbage', threw);
const bad2 = S.detectAndParse('bad.RHO', new Uint8Array(200)); check('detectAndParse reports error', bad2.data === null && !!bad2.error);
const tr = synth(true).slice(0, 300); threw = false; try { S.parseGrid(tr, 'trunc.RHO'); } catch (e) { threw = true; } check('rejects truncated', threw);

console.log(`rho tests: ${pass} passed, ${fail} failed`); if (fail) { console.log(bad.join('\n')); process.exit(1); }
