#!/usr/bin/env node
// Regresiones de navegador sobre dist/dftlab.html (red bloqueada):  node scripts/build.mjs && node tests/ui/browser_regressions.mjs
// Cubre: A (calculadora no se bloquea con campos vacíos/ceros) y E (metadatos y nombres de archivo hostiles se muestran como texto).
// Necesita las dependencias locales fijadas: npm ci && npm run browser:install. Si faltan, falla.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(HERE, '../../dist/dftlab.html');
if (!fs.existsSync(HTML)) { console.log('Falta dist/dftlab.html: ejecute "node scripts/build.mjs".'); process.exit(1); }

let pass = 0, fail = 0; const bad = [];
const check = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + ' ' + d); } };
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const newPage = async () => {
  const p = await browser.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/*', r => /^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort()); // sin red
  p.errs = errs; return p;
};
const url = pathToFileURL(HTML).href;

try {

// ---- A: calculadora ----
{
  const p = await newPage(); await p.goto(url + '#calc'); await p.waitForSelector('#c_a');
  for (const sel of ['#c_a', '#ang_g', '#c_dk', '#c_ec']) {
    const orig = await p.inputValue(sel);
    for (const v of ['', '0', '-5']) {
      await p.fill(sel, v); await p.dispatchEvent(sel, 'input');
      const t = (await p.textContent('#cellOut')).replace(/\s+/g, ' ');
      check(`calc ${sel}=${JSON.stringify(v)}: mensaje y sin resultado`, /completa todos|no válida/.test(t) && !/malla k/.test(t) && (await p.textContent('#cellPre')) === '', t);
    }
    await p.fill(sel, orig); await p.dispatchEvent(sel, 'input');
    check(`calc ${sel}: se recupera con valor válido`, /malla k/.test(await p.textContent('#cellOut')));
  }
  check('calc sin excepciones', p.errs.length === 0, p.errs.join('|'));
  await p.close();
}

// ---- E: postproceso con metadatos y nombres hostiles ----
{
  const D = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../dftlab/static/js/data/out_fe.json'), 'utf8'));
  const label = '<b data-audit-label="yes">audit</b><img src=x onerror="window.__pwned=1">';
  const text = D.text.replace(/^reinit: System Label:.*$/m, 'reinit: System Label: ' + label)
    .replace(/^(\s*)(XC\.functional|XC.authors).*$/mi, '$1XC.functional <i data-audit-xc="yes">GGA</i>');
  const fname = `a"b'c<i data-audit-file="yes">.out`;
  // FilePayload covers hostile names even when Windows forbids those names on disk.
  const payload = name => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  const safe = payload('plain.out');
  for (const f of [payload(fname), safe]) {
    const p = await newPage(); await p.goto(url + '#post'); await p.waitForSelector('input[type=file]', { state: 'attached' });
    await p.setInputFiles('input[type=file]', f); await p.waitForSelector('#sum0', { timeout: 10000 });
    const bad1 = await p.evaluate(() => ({
      injected: document.querySelectorAll('#view [data-audit-label], #view [data-audit-xc], #view [data-audit-file], #view img[src="x"]').length,
      onerr: [...document.querySelectorAll('#view *')].filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).length,
      pwned: window.__pwned === 1,
      text: document.querySelector('#sum0')?.textContent || '',
    }));
    const tag = f.name.startsWith('plain') ? 'nombre simple' : 'nombre con comillas';
    check(`post (${tag}): sin elementos ni manejadores inyectados`, bad1.injected === 0 && bad1.onerr === 0 && !bad1.pwned, JSON.stringify(bad1));
    check(`post (${tag}): la etiqueta aparece como texto`, bad1.text.includes('<b data-audit-label="yes">audit</b>'), bad1.text.slice(0, 200));
    check(`post (${tag}) sin excepciones`, p.errs.length === 0, p.errs.join('|'));
    await p.close();
  }
  // lector anotado: la nota del SystemLabel
  const p = await newPage(); await p.goto(url + '#lectura'); await p.waitForSelector('input[type=file]', { state: 'attached' });
  await p.setInputFiles('input[type=file]', safe); await p.waitForTimeout(1500);
  const lect = await p.evaluate(() => ({ injected: document.querySelectorAll('#view [data-audit-label], #view img[src="x"]').length, pwned: window.__pwned === 1 }));
  check('lectura: sin elementos inyectados', lect.injected === 0 && !lect.pwned, JSON.stringify(lect));
  await p.close();
}

} finally { await browser.close(); }
console.log(`browser regressions: ${pass} passed, ${fail} failed`);
for (const b of bad) console.log('  FAIL', b);
process.exit(fail ? 1 : 0);
