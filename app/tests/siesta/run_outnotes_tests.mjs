#!/usr/bin/env node
// Pruebas de la lectura anotada (siesta/outnotes.js):  node tests/siesta/run_outnotes_tests.mjs
// Contra el .out real de Fe FM empaquetado en js/data/out_fe.json y contra casos sintéticos (SCF fallido, relajación, archivo truncado).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeOut, segment, BLOCKS } from '../../dftlab/static/js/siesta/outnotes.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dftlab/static/js/data');
const D = JSON.parse(fs.readFileSync(path.join(root, 'out_fe.json'), 'utf8'));
let pass = 0, fail = 0; const bad = [];
const check = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + ' ' + d); } };
const A = analyzeOut(D.text, { example: true });
const ids = A.blocks.map(b => b.id);
check('bloques en orden', ['header', 'fdf', 'pseudo', 'basis', 'geom', 'params', 'kmesh', 'step', 'scf', 'conv', 'forces', 'pop', 'eig', 'efinal', 'stress', 'pop', 'cite', 'timer', 'end'].join() === ids.join(), ids.join());
check('bloques cubren todas las líneas sin huecos', A.blocks[0].from === 0 && A.blocks.every((b, i) => i === 0 || b.from === A.blocks[i - 1].to + 1) && A.blocks.at(-1).to === A.lines.length - 1);
check('todo bloque tiene título', A.blocks.every(b => BLOCKS[b.id] && b.title));
check('tolerancias leídas', A.ctx.tolDM === 1e-5 && A.ctx.tolH === 1e-3 && A.ctx.maxScf === 300, JSON.stringify([A.ctx.tolDM, A.ctx.tolH]));
check('malla leída', A.ctx.meshReq === 300 && Math.abs(A.ctx.meshUsed - 387.616) < 1e-9 && A.ctx.nkpt === 2192 && A.ctx.nspin === 2);
const L = (re) => A.lines.findIndex(l => re.test(l));
const note = re => A.notes[L(re)];
check('nota de iteración SCF con tolerancia', /dDmax = 3\.0×10⁻⁶/.test(note(/scf:\s+23 /).h) && /bajo la tolerancia/.test(note(/scf:\s+23 /).h), note(/scf:\s+23 /).h);
check('iteración 1 sobre la tolerancia', /sobre la tolerancia/.test(note(/scf:\s+1 /).h));
check('nota convergencia', note(/SCF cycle converged/).k === 'ok' && /23 iteraciones/.test(note(/SCF cycle converged/).h));
check('estrés → presión −70.40', /−70\.40 kbar/.test(note(/Stress tensor Voigt/).h), note(/Stress tensor Voigt/).h);
check('nota k-points', /2192/.test(note(/Kpoints in/).h));
check('nota E_F', /−4\.003|-4\.003/.test(note(/Fermi energy/).h));
check('Mulliken carga: la fila resumen no se confunde con Qorb', /carga neta/.test(note(/^\s+1\s+-0\.000000\s+16\.0/).h));
check('timer fila', /diagon/.test(note(/^diagon\s/).h) && /93\.28/.test(note(/^diagon\s/).h));
check('nota del ejemplo en timer', /143\.6 s/.test(note(/Elapsed wall time/).x));
const ck = (b, re) => A.checks.some(c => c.block === b && re.test(c.title));
check('diag: terminó', ck('end', /terminó/)); check('diag: SCF convergido', ck('conv', /SCF convergido/));
check('diag: suma de energías', ck('efinal', /suma de los términos coincide/));
check('diag: presión', ck('stress', /Presión −70\.40/));
check('diag: salto de dDmax detectado', ck('scf', /salta hacia arriba 1/));
check('diag: Mulliken suma 16', ck('pop', /16\.000/));
check('diag: orbitales 19 / 16 e', ck('basis', /19 orbitales para 16/));

// SCF no convergido y sin "Job completed"
const bad1 = D.text.replace('SCF cycle converged after 23 iterations', 'SCF cycle did NOT converge after 300 iterations').replace(/Job completed/g, '');
const B = analyzeOut(bad1);
check('SCF fallido → bad', B.checks.some(c => c.level === 'bad' && /no convergió/.test(c.title)));
check('sin Job completed → bad', B.checks.some(c => c.level === 'bad' && c.block === 'end'));
// archivo truncado a mitad del SCF
const T = analyzeOut(D.text.split('\n').slice(0, 500).join('\n'));
check('truncado: no lanza y avisa', T.checks.some(c => c.level !== 'ok' && c.block === 'end'));
// vacío / basura
const E = analyzeOut('hola\nmundo\n');
check('basura: un bloque header', E.blocks.length === 1 && E.blocks[0].id === 'header' && E.checks.some(c => c.level === 'bad'));
// relajación sintética: dos pasos
const lines = D.text.split('\n'); const s0 = lines.findIndex(l => /^\s*={10,}/.test(l)); const sEnd = lines.findIndex(l => /^siesta: Eigenvalues/.test(l));
const two = [...lines.slice(0, sEnd), ...lines.slice(s0, sEnd).map(l => l.replace('Single-point calculation', 'Begin CG opt. move =      1')), ...lines.slice(sEnd)].join('\n').replace('Single-point calculation', 'Begin CG opt. move =      0');
const R2 = segment(two.split('\n'));
check('relajación: dos bloques de paso', R2.filter(b => b.id === 'step').length === 2, R2.map(b => b.id).join());
console.log(`${pass} pruebas pasan, ${fail} fallan`);
if (fail) { console.log(bad.join('\n')); process.exit(1); }
