#!/usr/bin/env node
// Medición (bloque H), no es una prueba de aprobado/fallo: tiempo de hilo principal de los lectores
// y del cálculo de cortes/isosuperficies con corridas reales de SIESTA 5.4.2 de corridas/*.tar.gz.
//   node --expose-gc app/tests/perf/measure_parsers.mjs [carpeta-temporal]
// Extrae con `tar` solo los archivos medidos. Imprime una tabla Markdown (mediana de 5 repeticiones).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const JS = path.join(ROOT, 'app/dftlab/static/js');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'dftlab-perf-'));
fs.mkdirSync(out, { recursive: true });
const SETS = {
  'dens.tar.gz': ['./h2o/h2o.RHO', './si/si.RHO', './h2o/h2o.out'],
  'espin.tar.gz': ['espin/fm_u4/fm_u4.PDOS'],
  'conv.tar.gz': ['conv/k_14/k_14.EIG', 'conv/k_14/k_14.out'],
  'solv2.tar.gz': ['solv2/ordern_4/ordern_4.out'],
};
for (const [tgz, members] of Object.entries(SETS)) {
  const r = spawnSync('tar', ['xzf', path.join(ROOT, 'corridas', tgz), '-C', out, ...members], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`no se pudo extraer ${tgz}`); process.exit(1); }
}
const { detectAndParse } = await import(pathToFileURL(path.join(JS, 'siesta/index.js')).href);
const { planeSlice, planarAverage } = await import(pathToFileURL(path.join(JS, 'siesta/rho.js')).href);
const { isoSurface } = await import(pathToFileURL(path.join(JS, 'core/three-view.js')).href);

const heap = () => { globalThis.gc?.(); return process.memoryUsage().heapUsed; };
function measure(label, f, n = 5) {
  const t = []; let r; const h0 = heap();
  for (let i = 0; i < n; i++) { const a = performance.now(); r = f(); t.push(performance.now() - a); }
  const h1 = heap(); t.sort((a, b) => a - b);
  rows.push([label, t[n >> 1].toFixed(1), t[n - 1].toFixed(1), ((h1 - h0) / 2 ** 20).toFixed(1)]);
  return r;
}
const rows = [];
const file = p => path.join(out, p);
const size = p => (fs.statSync(file(p)).size / 2 ** 20).toFixed(2) + ' MB';
const bytes = p => { const b = fs.readFileSync(file(p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const text = p => fs.readFileSync(file(p), 'utf8');

const grid = measure(`parseGrid h2o.RHO (${size('h2o/h2o.RHO')})`, () => detectAndParse('h2o.RHO', bytes('h2o/h2o.RHO')).data);
measure(`parseGrid si.RHO (${size('si/si.RHO')})`, () => detectAndParse('si.RHO', bytes('si/si.RHO')).data);
for (const p of ['espin/fm_u4/fm_u4.PDOS', 'conv/k_14/k_14.EIG', 'conv/k_14/k_14.out', 'solv2/ordern_4/ordern_4.out', 'h2o/h2o.out'])
  measure(`${path.basename(p)} (${size(p)})`, () => detectAndParse(path.basename(p), text(p)));
const dims = grid.mesh || grid.dims || grid.n;
const cell = grid.cell;
measure(`planarAverage h2o.RHO (malla ${dims?.join?.('×')})`, () => planarAverage(grid, 2));
measure('planeSlice h2o.RHO 200×200', () => planeSlice(grid, { origin: [0, 0, 0], e1: cell[0].map(v => v / Math.hypot(...cell[0])), e2: cell[1].map(v => v / Math.hypot(...cell[1])), len1: Math.hypot(...cell[0]), len2: Math.hypot(...cell[1]), n1: 200, n2: 200 }));
const V = grid.data?.[0] || grid.values?.[0] || grid.rho?.[0];
if (V && dims) {
  let mx = 0; for (const v of V) mx = Math.max(mx, v);
  const [M0, M1, M2] = dims, re = new Float32Array(M0 * M1 * M2);
  for (let i = 0; i < M0; i++) for (let j = 0; j < M1; j++) for (let k = 0; k < M2; k++) re[(i * M1 + j) * M2 + k] = V[(k * M1 + j) * M0 + i];
  measure(`isoSurface h2o.RHO (${dims.join('×')}, 10 % del máximo)`, () => isoSurface(re, dims, (i, j, k) => [i, j, k], 0.1 * mx, () => [1, 1, 1]), 3);
}
console.log(`Node ${process.version}, ${os.cpus()[0]?.model || 'CPU'} × ${os.cpus().length}, ${os.platform()}\n`);
console.log('| operación | mediana (ms) | máx (ms) | Δheap (MB) |\n|---|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
