#!/usr/bin/env node
// Regresión de navegador de G sobre dist/dftlab.html (red bloqueada):  node scripts/build.mjs && node tests/ui/browser_bands.mjs
// Las bandas de Postproceso no unen tramos desconectados del camino k: U|K en el .bands de Si (SIESTA da un
// solo paso recto entre U y K) y U|K, H|P en los paquetes .dftlab.json. Se registran las líneas que el
// gráfico traza en el canvas; el CSV y el informe declaran los tramos. El Fe .bands (camino continuo) no se corta.
// Necesita Playwright + Chromium locales fijados. Si faltan, falla, igual que las demás suites F.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(HERE, '../../dist/dftlab.html');
const FX = path.resolve(HERE, '../siesta/fixtures');
if (!fs.existsSync(HTML)) { console.log('Falta dist/dftlab.html: ejecute "node scripts/build.mjs".'); process.exit(1); }

let pass = 0, fail = 0; const bad = [];
const check = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + ' ' + d); } };
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const url = pathToFileURL(HTML).href;
const file = (name) => ({ name: path.basename(name), mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.join(FX, name)) });

// registra cada lineTo del canvas con su color y el punto de partida
const RECORDER = () => {
  const P = CanvasRenderingContext2D.prototype, mv = P.moveTo, ln = P.lineTo;
  window.__lines = [];
  P.moveTo = function (x, y) { this.__cur = [x, y]; return mv.call(this, x, y); };
  P.lineTo = function (x, y) {
    if (this.canvas && this.canvas.id && this.__cur) window.__lines.push({ id: this.canvas.id, style: String(this.strokeStyle), x0: this.__cur[0], x1: x });
    this.__cur = [x, y]; return ln.call(this, x, y);
  };
};
async function open(files) {
  const p = await browser.newPage({ acceptDownloads: true, viewport: { width: 1200, height: 900 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/*', (r) => /^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort());
  await p.addInitScript(RECORDER);
  await p.goto(url + '#post'); await p.waitForSelector('input[type=file]', { state: 'attached' });
  await p.setInputFiles('input[type=file]', files);
  const names = files.map((f) => f.name);
  await p.waitForFunction((n) => { const r = [...document.querySelectorAll('#fileTab tbody tr td:first-child')].map((t) => t.textContent); return n.every((x) => r.includes(x)); }, names, { timeout: 15000 });
  await p.waitForTimeout(300);
  // redibujo limpio: el cambio de rango de energía vuelve a trazar todas las bandas
  await p.evaluate(() => { window.__lines = []; const e = document.querySelector('#eMin'); e.value = '-8'; e.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(200);
  p.errs = errs; return p;
}
// líneas de banda (color de la primera serie) que unen x_a con x_b en el canvas `id`
const joins = (p, id, xa, xb) => p.evaluate(([id, xa, xb]) => {
  const cv = document.getElementById(id), m = cv._map, cols = new Set(cv._cfg.series.map((s) => s.color));
  const A = m.X(xa), B = m.X(xb), lo = Math.min(A, B), hi = Math.max(A, B);
  const band = window.__lines.filter((l) => l.id === id && [...cols].some((c) => { const t = document.createElement('canvas').getContext('2d'); t.strokeStyle = c; return t.strokeStyle === l.style; }));
  return { n: band.length, across: band.filter((l) => Math.min(l.x0, l.x1) <= lo + 1e-9 && Math.max(l.x0, l.x1) >= hi - 1e-9).length };
}, [id, xa, xb]);
const cfgOf = (p, id) => p.evaluate((id) => { const c = document.getElementById(id)._cfg; return { ticks: c.xticks.map((t) => [t.x, t.label]), csv: c.csv(), read: document.getElementById(id.replace('cv_', 'rd_')).textContent }; }, id);
async function report(p) {
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#repMd')]);
  return fs.readFileSync(await dl.path(), 'utf8');
}

try {
// ---------------- .bands de SIESTA (Si, salto U|K) y Fe (continuo) ----------------
{
  const p = await open([file('si/si.bands'), file('fe/fe.bands')]);
  const si = await cfgOf(p, 'cv_bd0'), fe = await cfgOf(p, 'cv_bd1');
  const xU = si.ticks.find((t) => t[1] === 'U')[0], xK = si.ticks.find((t) => t[1] === 'K')[0];
  const j = await joins(p, 'cv_bd0', xU, xK);
  check('Si .bands: se trazan bandas', j.n > 1000, j.n);
  check('Si .bands: ninguna banda une U con K', j.across === 0, `${j.across} líneas cruzan U→K`);
  const rows = si.csv.split('\n').filter((l) => /^[0-9]/.test(l));
  check('Si .bands: CSV con columna de tramo', /^x,segment,s1b1/m.test(si.csv) && rows.length === 182 && rows[60].split(',')[1] === '1' && rows[61].split(',')[1] === '2', rows[60] + ' / ' + rows[61]);
  check('Si .bands: CSV conserva x de U y K', Math.abs(+rows[60].split(',')[0] - xU) < 1e-12 && Math.abs(+rows[61].split(',')[0] - xK) < 1e-12);
  check('Si .bands: el salto se lee en pantalla', /U\|K/.test(si.read), si.read);
  // Fe: camino continuo; entre H y N hay líneas (no se inventa un corte)
  const xH = fe.ticks.find((t) => t[1] === 'H')[0], xN = fe.ticks.find((t) => t[1] === 'N')[0];
  const jf = await joins(p, 'cv_bd1', xH, xH + (xN - xH) * 0.02);
  check('Fe .bands: el camino continuo sigue unido', jf.across > 0 && !/segment,.*\n.*,2,/.test(fe.csv) && !/\|/.test(fe.read), jf.across);
  const md = await report(p);
  check('informe: tramos y salto declarados', /camino k: 2 tramo\(s\); Saltos declarados en BandLines[^\n]*U\|K/.test(md) && /camino k: 1 tramo\(s\)\n/.test(md), md.match(/camino k[^\n]*/g)?.join(' / '));
  check('.bands sin excepciones', p.errs.length === 0, p.errs.join('|'));
  await p.close();
}

// ---------------- paquetes: U|K (Si) y H|P (Fe, dos canales de espín) ----------------
for (const [name, lab, nch] of [['si/si.dftlab.json', 'U|K', 1], ['fe/fe.dftlab.json', 'H|P', 2]]) {
  const p = await open([file(name)]);
  const c = await cfgOf(p, 'cv_pb0');
  const xb = c.ticks.find((t) => t[1] === lab)?.[0];
  check(`paquete ${lab}: etiqueta en el eje`, xb != null, JSON.stringify(c.ticks));
  // un salto en la misma x se vería como una línea vertical en x_b: ninguna banda la traza
  const v = await p.evaluate(([xb]) => {
    const cv = document.getElementById('cv_pb0'), X = cv._map.X(xb);
    const t = document.createElement('canvas').getContext('2d'); const cols = new Set(cv._cfg.series.map((s) => { t.strokeStyle = s.color; return t.strokeStyle; }));
    return window.__lines.filter((l) => l.id === 'cv_pb0' && cols.has(l.style) && l.x0 === l.x1 && Math.abs(l.x0 - X) < 1).length;
  }, [xb]);
  check(`paquete ${lab}: ninguna banda une el final y el nuevo inicio`, v === 0, `${v} líneas verticales en ${lab}`);
  const nan = await p.evaluate(() => document.getElementById('cv_pb0')._cfg.series.map((s) => s.d.filter((q) => !Number.isFinite(q[1])).length));
  check(`paquete ${lab}: un separador por banda y canal`, nan.length > 0 && nan.every((k) => k === 1), JSON.stringify(nan.slice(0, 4)));
  const seg2 = c.csv.split('\n').filter((l) => /^[0-9]/.test(l)).map((l) => l.split(',')[1]);
  check(`paquete ${lab}: CSV con tramos 1 y 2`, seg2[0] === '1' && seg2.at(-1) === '2' && new Set(seg2).size === 2);
  check(`paquete ${lab}: salto en pantalla`, c.read.includes(lab), c.read);
  check(`paquete ${lab}: ${nch} canal(es)`, (await p.evaluate(() => new Set(document.getElementById('cv_pb0')._cfg.series.map((s) => s.color)).size)) === nch);
  check(`paquete ${lab}: sin excepciones`, p.errs.length === 0, p.errs.join('|'));
  await p.close();
}

} finally { await browser.close(); }
console.log(`browser bands (G): ${pass} passed, ${fail} failed`);
bad.forEach((b) => console.log('  FAIL', b));
process.exit(fail ? 1 : 0);
