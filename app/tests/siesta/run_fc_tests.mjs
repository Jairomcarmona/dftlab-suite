#!/usr/bin/env node
// Pruebas del lector .FC (siesta/fc.js) y de la matriz dinámica (physics/phonon.js):  node tests/siesta/run_fc_tests.mjs
// Contra fixtures_fc/reference.json (numpy, make_fc_reference.py: supercelda completa diagonalizada en Γ) y contra un modelo analítico.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../dftlab/static/js/siesta/index.js';
import * as P from '../../dftlab/static/js/physics/phonon.js';
import { readFDF } from '../../dftlab/static/js/crystal/formats.js';
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures_fc');
const REF = JSON.parse(fs.readFileSync(path.join(F, 'reference.json'), 'utf8'));
let pass = 0, fail = 0; const bad = [];
const check = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + ' ' + d); } };
const close = (n, a, b, tol = 1e-6) => check(n, Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `got ${a} want ${b}`);

// --- lector ---
const text = fs.readFileSync(path.join(F, 'si_fc.FC'), 'utf8');
const fc = S.parseFC(text);
check('nAtoms', fc.nAtoms === REF.nAtoms); check('nDisplaced', fc.nDisplaced === REF.nDisplaced); close('displ', fc.displ, 0.02, 1e-12);
const rows = S.fcRows(fc);
for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { close(`phi00[${a}][${b}]`, rows[0].rows[a][b], REF.phi00[a][b], 1e-9); close(`phi01[${a}][${b}]`, rows[0].rows[a][3 + b], REF.phi01[a][b], 1e-9); }
check('detectKind .FC', S.detectKind('x.FC', text) === 'fc'); check('detectKind contenido', S.detectKind('fuerzas.dat', text) === 'fc');
const dp = S.detectAndParse('si_fc.FC', text); check('detectAndParse', dp.kind === 'fc' && dp.data && dp.data.nAtoms === 16, JSON.stringify(dp).slice(0, 80));
let thrown = false; try { S.parseFC(text.split('\n').slice(0, 20).join('\n')); } catch (e) { thrown = true; } check('archivo truncado → error', thrown);
thrown = false; try { S.parseFC('hola\n1 2 3'); } catch (e) { thrown = true; } check('no es .FC → error', thrown);
const old = text.replace(/^.*\n/, 'Force constants matrix\n'); const fo = S.parseFC(old, { nAtoms: 16 }); check('encabezado antiguo con nAtoms', fo.nAtoms === 16 && fo.displ === null);

// --- Si: puntos conmensurados contra la supercelda completa ---
const cell = readFDF(fs.readFileSync(path.join(F, 'si_fc.fdf'), 'utf8'));
const M = P.phononModel({ superCell: cell, n: [2, 2, 2], masses: cell.numbers.map(() => 28.085), phi: rows });
check('base de 2 átomos', M.nb === 2 && M.ncell === 8);
const got = [];
for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) got.push(...P.frequencies(M, P.qCart(M, [a / 2, b / 2, c / 2])).nu);
got.sort((x, y) => x - y);
REF.superGammaTHz.forEach((v, i) => close(`Γ supercelda ν[${i}]`, got[i], v, 2e-5));
const X = P.qCart(M, [0.5, 0, 0.5]), a0 = Math.hypot(...cell.lattice[0]) * Math.SQRT2 / 2;
close('|X| = 2π/a', Math.hypot(...X), 2 * Math.PI / a0, 1e-9);
const L = P.qCart(M, [0.5, 0.5, 0.5]); close('|L| = √3π/a', Math.hypot(...L), Math.sqrt(3) * Math.PI / a0, 1e-9);
const g = P.frequencies(M, [0, 0, 0]).nu; check('acústicas en Γ = 0 con ASR', Math.max(...g.slice(0, 3).map(Math.abs)) < 1e-4, g.join(','));
const fx = P.frequencies(M, X).nu; check('degeneración TA en X', Math.abs(fx[0] - fx[1]) < 1e-3, fx.join(','));
const q = P.qCart(M, [0.13, 0.31, 0.07]), d1 = P.frequencies(M, q).nu, d2 = P.frequencies(M, q.map(x => -x)).nu;
d1.forEach((v, i) => close(`ω(q) = ω(−q) [${i}]`, v, d2[i], 1e-8));
const ev = P.frequencies(M, q, true); check('autovectores normalizados', ev.vecs.every(v => Math.abs(v.reduce((s, [x, y]) => s + x * x + y * y, 0) - 1) < 1e-9));
const dos = P.phononDOS(M, { m: 6, sigma: 0.2, de: 0.01 }); close('DOS integra 6 modos', dos.g.reduce((s, x) => s + x, 0) * 0.01, 6, 2e-3);

// --- modelo analítico: cúbica simple con resortes isótropos a primeros vecinos, supercelda 4×4×4 ---
// ω² = (2k/M) Σ_α (1 − cos q_α a), triplemente degenerada; exacta para todo q con imágenes de Wigner–Seitz.
const n4 = 4, a = 3, k = 2.5, Mm = 10, N = n4 ** 3, pos = [];
for (let i = 0; i < n4; i++) for (let j = 0; j < n4; j++) for (let l = 0; l < n4; l++) pos.push([i / n4, j / n4, l / n4]);
const sc = { lattice: [[n4 * a, 0, 0], [0, n4 * a, 0], [0, 0, n4 * a]], positions: pos, numbers: pos.map(() => 1) };
const lines = ['Force constants matrix. n_atoms, displacement [Ang]: ' + N + ' 0.01'];
for (let al = 0; al < 3; al++) for (const sgn of [-1, 1]) for (let j = 0; j < N; j++) {
  const f = pos[j].map(x => Math.round(((x + 0.5) % 1 - 0.5) * n4)), nn = Math.abs(f[0]) + Math.abs(f[1]) + Math.abs(f[2]);
  const v = [0, 0, 0]; if (j === 0) v[al] = 6 * k; else if (nn === 1) v[al] = -k; lines.push(v.map(x => x.toExponential(9)).join('  '));
}
const fcS = S.parseFC(lines.join('\n')); const MS = P.phononModel({ superCell: sc, n: [n4, n4, n4], masses: pos.map(() => Mm), phi: S.fcRows(fcS) });
for (const qf of [[0.1, 0, 0], [0.37, 0.12, 0.05], [0.5, 0.5, 0.5], [0.21, 0.44, 0.33]]) {
  const qc = P.qCart(MS, qf), w2 = (2 * k / Mm) * qc.reduce((s, x) => s + 1 - Math.cos(x * a), 0), nu = Math.sqrt(w2) * P.THZ;
  P.frequencies(MS, qc).nu.forEach((v, i) => close(`cúbica simple q=${qf} [${i}]`, v, nu, 1e-8));
}
// primitiveMap rechaza una supercelda inconsistente
thrown = false; try { P.primitiveMap(sc, [3, 3, 3]); } catch (e) { thrown = true; } check('supercelda inconsistente → error', thrown);

console.log(`fc: ${pass} pasan, ${fail} fallan`); if (fail) { console.log(bad.slice(0, 20).join('\n')); process.exit(1); }
