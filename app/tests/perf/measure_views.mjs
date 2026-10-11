#!/usr/bin/env node
// Medición (bloque H), no es una prueba de aprobado/fallo: bloqueo del hilo principal y memoria en
// navegador sobre dist/dftlab.html (red bloqueada), con los datos que trae la aplicación y una malla
// real de corridas/dens.tar.gz (h2o.RHO, 108³). Bloqueo = tareas largas (>50 ms) medidas por
// PerformanceObserver; TBT = Σ(duración − 50 ms). Memoria = montón JS tras recolección forzada (CDP).
//   node app/scripts/build.mjs && node app/tests/perf/measure_views.mjs
// Necesita Playwright + Chromium (como las pruebas de navegador). Imprime tablas Markdown.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const HTML = path.resolve(HERE, '../../dist/dftlab.html');
let chromium;
const req = createRequire(import.meta.url);
for (const r of [undefined, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)]) {
  try { chromium = (r ? createRequire(path.join(r, 'x.js'))('playwright') : req('playwright')).chromium; break; } catch {}
}
if (!chromium) { console.log('measure_views: falta Playwright'); process.exit(1); }
if (!fs.existsSync(HTML)) { console.log('Falta dist/dftlab.html: ejecute "node app/scripts/build.mjs".'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dftlab-perf-'));
spawnSync('tar', ['xzf', path.join(ROOT, 'corridas/dens.tar.gz'), '-C', tmp, './h2o/h2o.RHO'], { stdio: 'inherit' });
const RHO = path.join(tmp, 'h2o/h2o.RHO');

const INSTRUMENT = () => {
  window.__lt = [];
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const rows = [], mem = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**/*', r => /^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort());
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const heapMB = async () => { await cdp.send('HeapProfiler.collectGarbage'); const h = await cdp.send('Runtime.getHeapUsage'); return (h.usedSize / 2 ** 20).toFixed(1); };
  const t0 = Date.now();
  await page.goto(pathToFileURL(HTML).href + '#inicio');
  await page.waitForSelector('#themeBtn');
  const loadMs = Date.now() - t0;
  const ids = await page.$$eval('.navgrp a', as => as.map(a => a.dataset.id));
  // ejecuta una acción y mide las tareas largas que produce hasta que la página queda quieta
  const measure = async (label, act, settle = 1200) => {
    const since = await page.evaluate(() => performance.now());
    const a = Date.now(); await act(); const wall = Date.now() - a;
    await page.waitForTimeout(settle);
    const lt = await page.evaluate(s => window.__lt.filter(([t]) => t >= s), since);
    const tbt = lt.reduce((s, [, d]) => s + Math.max(0, d - 50), 0), max = lt.reduce((m, [, d]) => Math.max(m, d), 0);
    rows.push([label, lt.length, Math.round(max), Math.round(tbt), wall]);
  };
  const go = id => page.evaluate(h => { location.hash = h; }, id).then(() => page.waitForFunction(h => location.hash === '#' + h && document.querySelector('.viewhost')?.dataset.view === h, id));

  mem.push(['carga inicial (#inicio)', await heapMB()]);
  for (const id of ids.filter(i => i !== 'inicio')) { await measure(`montar #${id}`, () => go(id)); await go('inicio'); }
  mem.push(['tras recorrer las 18 pantallas, en #inicio', await heapMB()]);

  await go('ks');
  await page.selectOption('#ksZ', '54'); await page.waitForTimeout(300);
  await measure('ks: resolver Xe (Z = 54)', async () => { await page.click('#ksRun'); await page.waitForFunction(() => /ms/.test(document.querySelector('#ksStat')?.textContent || ''), null, { timeout: 60000 }); });
  await go('bandas');
  await page.locator('#cB').scrollIntoViewIfNeeded();
  const bb = await page.locator('#cB').boundingBox();
  await measure('bandas: clic en una banda (función de onda, isosuperficie)', () => page.mouse.click(bb.x + bb.width * 0.3, bb.y + bb.height * 0.45), 2500);
  await go('post');
  await measure('post: ejemplo relajación Si₈', async () => { await page.click('#exRelax'); await page.waitForSelector('#view #sum0', { timeout: 30000 }); });
  await measure('post: ejemplo Fe bcc con espín', async () => { await page.click('#exFe'); await page.waitForSelector('#view #sum0', { timeout: 30000 }); });
  await go('densidad');
  await measure(`densidad: leer h2o.RHO (${(fs.statSync(RHO).size / 2 ** 20).toFixed(1)} MB, 108³)`, async () => { await page.setInputFiles('#fileIn', RHO); await page.waitForFunction(() => /108 × 108 × 108/.test(document.querySelector('#userInfo')?.textContent || ''), null, { timeout: 30000 }); }, 2500);
  await go('inicio');

  for (let i = 0; i < 3; i++) for (const id of ids.filter(i => i !== 'inicio')) { await go(id); await page.waitForTimeout(100); }
  await go('inicio');
  mem.push(['tras 3 recorridos más de las 18 pantallas, en #inicio', await heapMB()]);
  console.log(`Chromium ${browser.version()} (SwiftShader, sin GPU), ${os.cpus()[0]?.model || 'CPU'} × ${os.cpus().length}, ${os.platform()}; carga de dftlab.html ${loadMs} ms\n`);
  console.log('| acción | tareas largas | máx (ms) | TBT (ms) | duración (ms) |\n|---|---:|---:|---:|---:|');
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
  console.log('\n| momento | montón JS (MB) |\n|---|---:|');
  for (const r of mem) console.log(`| ${r.join(' | ')} |`);
} finally { await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
