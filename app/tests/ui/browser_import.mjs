#!/usr/bin/env node
// Regresiones de navegador de C y D sobre dist/dftlab.html (red bloqueada):  node scripts/build.mjs && node tests/ui/browser_import.mjs
// C: .EIG y .KP dan el mismo resultado en cualquier orden y se recalculan al quitar o sustituir el .KP.
// D: mallas binarias (.RHO) leídas como bytes y visualizadas; .dftlab.json con bandas, DOS y estructura,
//    nombrando lo que no se visualiza; archivos truncados o malformados dan un error visible.
// Necesita Playwright + Chromium. Sin ellos se OMITE de forma visible (exit 0) salvo REQUIRE_BROWSER=1, que lo convierte en fallo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(HERE, '../../dist/dftlab.html');
const FX = path.resolve(HERE, '../siesta/fixtures');
const need = process.env.REQUIRE_BROWSER === '1';
let chromium;
try {
  const req = createRequire(import.meta.url);
  const roots = [undefined, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
  for (const r of roots) { try { chromium = (r ? createRequire(path.join(r, 'x.js'))('playwright') : req('playwright')).chromium; break; } catch {} }
  if (!chromium) throw new Error('playwright no instalado');
} catch (e) {
  console.log(`browser import: SKIPPED (${e.message}). Defina REQUIRE_BROWSER=1 para que sea un fallo.`);
  process.exit(need ? 1 : 0);
}
if (!fs.existsSync(HTML)) { console.log('Falta dist/dftlab.html: ejecute "node scripts/build.mjs".'); process.exit(1); }

let pass = 0, fail = 0; const bad = [];
const check = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + ' ' + d); } };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const url = pathToFileURL(HTML).href;
const file = (name, buffer) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) });
const EIG = fs.readFileSync(path.join(FX, 'si/si.EIG')), KP = fs.readFileSync(path.join(FX, 'si/si.KP'), 'utf8');
const nk = parseInt(KP, 10);
const KPW = [KP.split('\n')[0], ...KP.split('\n').slice(1, nk + 1).map((l, i) => {   // pesos no uniformes; el primero 0.005
  const t = l.trim().split(/\s+/); t[4] = (i === 0 ? 0.005 : (1 - 0.005) / (nk - 1)).toExponential(9); return '  ' + t.join('  ');
})].join('\n') + '\n';

async function open() {
  const p = await browser.newPage({ acceptDownloads: true }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/*', (r) => /^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort());
  await p.goto(url + '#post'); await p.waitForSelector('input[type=file]', { state: 'attached' });
  p.errs = errs; return p;
}
const rows = (p) => p.$$eval('#fileTab tbody tr', (r) => r.length);
async function drop(p, files) {
  const before = await rows(p);
  const names = files.map((f) => f.name);
  await p.setInputFiles('input[type=file]', files);
  // espera a que la tabla incluya los archivos y termine el redibujado
  await p.waitForFunction(([n, b]) => { const r = [...document.querySelectorAll('#fileTab tbody tr td:first-child')].map((t) => t.textContent); return n.every((x) => r.includes(x)) && r.length >= Math.min(b, 1); }, [names, before], { timeout: 15000 });
  await p.waitForTimeout(300);
}
async function exportJson(p) {
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#repJson')]);
  return JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
}
const status = (p, name) => p.evaluate((n) => [...document.querySelectorAll('#fileTab tbody tr')].find((r) => r.cells[0].textContent === n)?.cells[3].textContent || '', name);

// ---------------- C ----------------
const orders = {
  'EIG→KP': [[file('si.EIG', EIG)], [file('si.KP', KPW)]],
  'KP→EIG': [[file('si.KP', KPW)], [file('si.EIG', EIG)]],
  'juntos': [[file('si.EIG', EIG), file('si.KP', KPW)]],
};
const results = {};
for (const [tag, steps] of Object.entries(orders)) {
  const p = await open();
  for (const s of steps) await drop(p, s);
  const j = await exportJson(p); const e = j.files.find((f) => f.kind === 'eig');
  results[tag] = e;
  check(`C ${tag}: pesos del .KP`, e && e.data.weightsFromKP === true && Math.abs(e.data.weights[0] - 0.005) < 1e-12, JSON.stringify({ w: e?.data.weights[0], fromKP: e?.data.weightsFromKP }));
  check(`C ${tag}: coordenadas k conservadas`, e && Array.isArray(e.data.kpoints) && e.data.kpoints.length === nk);
  check(`C ${tag}: origen de pesos en la exportación`, e && e.link && e.link.weights === 'si.KP' && e.link.kpoints === 'si.KP', JSON.stringify(e?.link));
  check(`C ${tag}: origen de pesos visible`, /pesos\s*si\.KP/.test(await p.textContent('#rd_eg0').catch(() => '')));
  check(`C ${tag}: sin excepciones`, p.errs.length === 0, p.errs.join('|'));
  if (tag === 'EIG→KP') {
    // quitar el .KP → pesos uniformes
    await p.click(`#fileTab tr:has(td:text-is("si.KP")) [data-rm]`); await p.waitForTimeout(300);
    const e2 = (await exportJson(p)).files.find((f) => f.kind === 'eig');
    check('C quitar .KP: vuelve a pesos uniformes', e2.data.weightsFromKP === false && e2.data.kpoints === null && Math.abs(e2.data.weights[0] - 1 / nk) < 1e-12, JSON.stringify({ w: e2.data.weights[0] }));
    // sustituir por el .KP original (pesos uniformes 1/256 en el archivo)
    await drop(p, [file('si.KP', KPW)]); await drop(p, [file('si.KP', KP)]);
    const e3 = (await exportJson(p)).files.find((f) => f.kind === 'eig');
    check('C sustituir .KP: recalcula con el nuevo', e3.data.weightsFromKP === true && Math.abs(e3.data.weights[0] - 0.00390625) < 1e-12, e3.data.weights[0]);
  }
  await p.close();
}
check('C mismo resultado en todos los órdenes', Object.values(results).every((e) => e && JSON.stringify(e.data) === JSON.stringify(results['juntos'].data)));
{
  const p = await open();
  await drop(p, [file('si.EIG', EIG)]); await drop(p, [file('si.KP', fs.readFileSync(path.join(FX, 'fe/fe.KP')))]);
  const e = (await exportJson(p)).files.find((f) => f.kind === 'eig');
  check('C .KP de otra malla: no se empareja', e.data.weightsFromKP === false);
  check('C .KP de otra malla: motivo visible', /no corresponden/.test(await status(p, 'si.EIG')), await status(p, 'si.EIG'));
  await p.close();
}

// ---------------- D ----------------
{
  const p = await open();
  await drop(p, [file('mgo.RHO', fs.readFileSync(path.resolve(HERE, '../siesta/fixtures_grid/mgo.RHO')))]);
  const st = await status(p, 'mgo.RHO');
  check('D .RHO leído (sin «demasiado corto»)', /visualizado/.test(st) && !/corto/.test(st), st);
  check('D .RHO con panel y gráfica', await p.$('#gr0 canvas') !== null && /∫ sobre la celda/.test(await p.textContent('#gr0')));
  if (await p.$('#grAx0')) await p.click('#grAx0 [data-v="0"]');   // cambiar de eje no debe fallar
  await drop(p, [file('trunc.RHO', fs.readFileSync(path.resolve(HERE, '../siesta/fixtures_grid/mgo.RHO')).subarray(0, 5000))]);
  check('D .RHO truncado: error visible', /registro|corto|marcadores|malla/i.test(await status(p, 'trunc.RHO')) && !/visualizado/.test(await status(p, 'trunc.RHO')), await status(p, 'trunc.RHO'));
  await drop(p, [file('bad.VH', Buffer.alloc(400, 7))]);
  check('D malla malformada: error visible', /no es un archivo de malla/.test(await status(p, 'bad.VH')), await status(p, 'bad.VH'));
  check('D mallas sin excepciones', p.errs.length === 0, p.errs.join('|'));
  await p.close();
}
{
  const p = await open();
  await drop(p, [file('si.dftlab.json', fs.readFileSync(path.join(FX, 'si/si.dftlab.json')))]);
  const out = await p.textContent('#ppOut');
  check('D paquete: no dice «sin lector gráfico»', !/Ninguno de los archivos/.test(out), out.slice(0, 120));
  check('D paquete: bandas, DOS y geometría', (await p.$('#pb0 canvas')) && (await p.$('#pk0 canvas')) && (await p.$('#geo')) !== null);
  const miss = await p.textContent('[data-pack-missing]').catch(() => '');
  check('D paquete: nombra lo que no se visualiza', /fatbands/.test(miss) && /COOP/.test(miss) && /funciones de onda \(3 estados\)/.test(miss), miss);
  check('D paquete: estado distingue leído de visualizado', /visualizado: bandas, DOS, estructura, gap/.test(await status(p, 'si.dftlab.json')), await status(p, 'si.dftlab.json'));
  const raw = fs.readFileSync(path.join(FX, 'si/si.dftlab.json'), 'utf8');
  await drop(p, [file('trunc.dftlab.json', raw.slice(0, raw.length >> 1))]);
  check('D paquete truncado: error visible', /JSON|Unexpected|Unterminated|position/i.test(await status(p, 'trunc.dftlab.json')), await status(p, 'trunc.dftlab.json'));
  await drop(p, [file('otro.dftlab.json', '{"dftlab":"otro"}')]);
  check('D JSON que no es paquete: error visible', /siesta-pack/.test(await status(p, 'otro.dftlab.json')), await status(p, 'otro.dftlab.json'));
  await drop(p, [file('si.out', fs.readFileSync(path.join(FX, 'si/si.out')))]);
  check('D textual (.out) sigue su lector', /resumen/.test(await status(p, 'si.out')) && (await p.$('#sum0')) !== null, await status(p, 'si.out'));
  check('D paquete sin excepciones', p.errs.length === 0, p.errs.join('|'));
  await p.close();
}

await browser.close();
console.log(`browser import (C/D): ${pass} passed, ${fail} failed`);
bad.forEach((b) => console.log('  FAIL', b));
process.exit(fail ? 1 : 0);
