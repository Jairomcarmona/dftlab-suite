#!/usr/bin/env node
// Ciclo de vida de vistas en navegador (bloque B) sobre dist/dftlab.html (red bloqueada):
//   node scripts/build.mjs && node tests/ui/browser_lifecycle.mjs
// Recorre las 19 pantallas: montar, cambiar tema, volver a #inicio y cambiar tema; repite xc <-> inicio
// y abandona el postproceso mientras carga un ejemplo. Falla con errores de página o de consola,
// suscripciones de tema que sobreviven a su vista o bucles de animación que siguen tras salir.
// Necesita Playwright + Chromium. Sin ellos se OMITE de forma visible (exit 0) salvo REQUIRE_BROWSER=1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(HERE, '../../dist/dftlab.html');
const need = process.env.REQUIRE_BROWSER === '1';
let chromium;
try {
  const req = createRequire(import.meta.url);
  const roots = [undefined, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
  for (const r of roots) { try { chromium = (r ? createRequire(path.join(r, 'x.js'))('playwright') : req('playwright')).chromium; break; } catch {} }
  if (!chromium) throw new Error('playwright no instalado');
} catch (e) {
  console.log(`browser lifecycle: SKIPPED (${e.message}). Defina REQUIRE_BROWSER=1 para que sea un fallo.`);
  process.exit(need ? 1 : 0);
}
if (!fs.existsSync(HTML)) { console.log('Falta dist/dftlab.html: ejecute "node scripts/build.mjs".'); process.exit(1); }

// Count live observers/listeners that watch the theme: MutationObservers observing data-theme on
// <html> and 'change' listeners on the prefers-color-scheme media query.
const INSTRUMENT = () => {
  const live = new Set(); let mq = 0;
  const obs = MutationObserver.prototype.observe, disc = MutationObserver.prototype.disconnect;
  MutationObserver.prototype.observe = function (t, o) {
    if (t === document.documentElement && o?.attributeFilter?.includes('data-theme')) live.add(this);
    return obs.call(this, t, o);
  };
  MutationObserver.prototype.disconnect = function () { live.delete(this); return disc.call(this); };
  const mm = window.matchMedia.bind(window);
  window.matchMedia = q => {
    const m = mm(q);
    if (/prefers-color-scheme/.test(q)) {
      const add = m.addEventListener.bind(m), rem = m.removeEventListener.bind(m);
      m.addEventListener = (t, f, o) => { if (t === 'change') mq++; return add(t, f, o); };
      m.removeEventListener = (t, f, o) => { if (t === 'change') mq--; return rem(t, f, o); };
    }
    return m;
  };
  window.__themeSubs = () => ({ observers: live.size, media: mq });
  // frames pedidos: un visor 3D o animación que sobrevive a su vista sigue pidiéndolos
  let frames = 0; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = f => { frames++; return raf(f); };
  window.__frames = () => frames;
};

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**/*', r => /^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort()); // sin red
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(pathToFileURL(HTML).href + '#inicio');
  await page.waitForSelector('#themeBtn');
  const ids = await page.$$eval('.navgrp a', as => as.map(a => a.dataset.id));
  check(ids.length === 19, `sidebar lists 19 screens (got ${ids.length})`);
  const base = await page.evaluate(() => window.__themeSubs());

  const go = async id => {
    await page.evaluate(h => { location.hash = h; }, id);
    await page.waitForFunction(h => document.querySelector('#topTitle')?.textContent && location.hash === '#' + h, id);
    await page.waitForTimeout(150);
  };
  const toggle = async () => { await page.click('#themeBtn'); await page.waitForTimeout(80); };
  const framesIn = async ms => { const a = await page.evaluate(() => window.__frames()); await page.waitForTimeout(ms); return (await page.evaluate(() => window.__frames())) - a; };

  for (const id of ids.filter(i => i !== 'inicio')) {
    errors.length = 0;
    await go(id); await toggle();
    const mountErrors = errors.splice(0);
    await go('inicio'); await toggle(); await toggle();
    const subs = await page.evaluate(() => window.__themeSubs());
    const idle = await framesIn(400);
    check(idle <= 2, `#${id}: no quedan bucles de animación tras salir (${idle} frames en 400 ms en #inicio)`);
    check(mountErrors.length === 0, `#${id}: no errors while mounted${mountErrors.length ? ' — ' + mountErrors[0] : ''}`);
    check(errors.length === 0, `#${id} -> #inicio -> Tema: no errors${errors.length ? ' — ' + errors[0] : ''}`);
    check(subs.observers === base.observers && subs.media === base.media,
      `#${id}: theme subscriptions released on leave (observers ${subs.observers}, media ${subs.media}; base ${base.observers}/${base.media})`);
  }

  errors.length = 0;
  for (let i = 0; i < 10; i++) { await go('xc'); await go('inicio'); }
  await go('xc'); await toggle(); await toggle();
  const onXc = await page.evaluate(() => window.__themeSubs());
  await go('inicio'); await toggle();
  const after = await page.evaluate(() => window.__themeSubs());
  check(errors.length === 0, `10× xc <-> inicio + Tema: no errors${errors.length ? ' — ' + errors[0] : ''}`);
  check(onXc.observers <= base.observers + 1 && onXc.media <= base.media + 1, `one mounted xc holds at most one theme subscription (observers ${onXc.observers}, media ${onXc.media})`);
  check(after.observers === base.observers && after.media === base.media, `no accumulated subscriptions after cycling (observers ${after.observers}, media ${after.media})`);

  // abandonar el postproceso mientras se lee un ejemplo: la lectura tardía no debe crear visores ni paneles
  errors.length = 0;
  await go('post'); await page.click('#exRelax'); await go('inicio');
  await page.waitForTimeout(1500);
  const late = await framesIn(400);
  const stray = await page.evaluate(() => document.querySelectorAll('#view canvas, #view #geo3').length);
  check(errors.length === 0, `post: salir durante la carga no produce errores${errors.length ? ' — ' + errors[0] : ''}`);
  check(late <= 2 && stray === 0, `post: la lectura tardía no crea visor ni paneles (${late} frames, ${stray} nodos)`);
  // y al volver la pantalla funciona
  await go('post'); await page.click('#exRelax'); await page.waitForSelector('#view #sum0', { timeout: 15000 });
  check(errors.length === 0, `post: al volver, el ejemplo carga sin errores${errors.length ? ' — ' + errors[0] : ''}`);
} finally { await browser.close(); }

console.log(failures.length ? `\n${failures.length} lifecycle check(s) failed` : '\nAll lifecycle checks passed');
process.exit(failures.length ? 1 : 0);
