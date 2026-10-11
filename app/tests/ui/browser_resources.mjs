#!/usr/bin/env node
// Liberación de recursos en navegador (bloque H) sobre dist/dftlab.html (red bloqueada):
//   node scripts/build.mjs && node tests/ui/browser_resources.mjs
// Comprueba, con instrumentación de ResizeObserver y WebGL:
//  - ningún ResizeObserver sigue observando un elemento desconectado tras salir de cada pantalla;
//  - ningún contexto WebGL de un lienzo desconectado sigue vivo (crear y destruir visores 3D
//    repetidamente no agota el límite de contextos del navegador);
//  - dentro de una pantalla montada, repintar (tema, cursor sobre ε₂, cargar otro ejemplo) no
//    acumula buffers ni texturas WebGL ni visores.
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
  console.log(`browser resources: SKIPPED (${e.message}). Defina REQUIRE_BROWSER=1 para que sea un fallo.`);
  process.exit(need ? 1 : 0);
}
if (!fs.existsSync(HTML)) { console.log('Falta dist/dftlab.html: ejecute "node scripts/build.mjs".'); process.exit(1); }

const INSTRUMENT = () => {
  // ResizeObserver: elementos observados por instancia
  const RO = window.ResizeObserver, observed = new Set();
  window.ResizeObserver = class extends RO {
    constructor(cb){ super(cb); this.__t = new Set(); observed.add(this); }
    observe(t, o){ this.__t.add(t); return super.observe(t, o); }
    unobserve(t){ this.__t.delete(t); return super.unobserve(t); }
    disconnect(){ this.__t.clear(); return super.disconnect(); }
  };
  // WebGL: contextos creados y buffers/texturas vivos por contexto
  const ctxs = [];
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) {
    const c = gc.call(this, type, ...a);
    if (c && /webgl/.test(type) && !c.__dl) { c.__dl = { buffers: 0, textures: 0, made: 0 }; ctxs.push(c); }
    return c;
  };
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean).map(C => C.prototype)) {
    for (const [mk, rm, k] of [['createBuffer', 'deleteBuffer', 'buffers'], ['createTexture', 'deleteTexture', 'textures']]) {
      const c0 = P[mk], d0 = P[rm];
      P[mk] = function (...a) { const r = c0.apply(this, a); if (r && this.__dl){ this.__dl[k]++; if (k === 'buffers') this.__dl.made++; } return r; };
      P[rm] = function (x) { if (x && this.__dl) this.__dl[k]--; return d0.call(this, x); };
    }
  }
  window.__res = () => {
    let roTargets = 0, roDetached = 0;
    for (const o of observed) for (const t of o.__t) { roTargets++; if (!t.isConnected) roDetached++; }
    const live = ctxs.filter(c => !c.isContextLost());
    return {
      roTargets, roDetached,
      glCreated: ctxs.length, glLive: live.length,
      glDetached: live.filter(c => !c.canvas.isConnected).length,
      glAttached: live.filter(c => c.canvas.isConnected).map(c => ({ ...c.__dl })),
    };
  };
};

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**/*', r => /^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort()); // sin red
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  const errors = [], warnings = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console: ${m.text()} ${m.location()?.url || ''}`);
    if (/WebGL contexts|CONTEXT_LOST/i.test(m.text())) warnings.push(m.text());
  });
  await page.goto(pathToFileURL(HTML).href + '#inicio');
  await page.waitForSelector('#themeBtn');
  const ids = await page.$$eval('.navgrp a', as => as.map(a => a.dataset.id));
  const res = () => page.evaluate(() => window.__res());
  const go = async id => {
    await page.evaluate(h => { location.hash = h; }, id);
    await page.waitForFunction(h => document.querySelector('#topTitle')?.textContent && location.hash === '#' + h, id);
    await page.waitForTimeout(80);
  };
  const toggle = async () => { await page.click('#themeBtn'); await page.waitForTimeout(80); };
  const example = async (btn) => { await page.click(btn); await page.waitForSelector('#view #sum0', { timeout: 20000 }); await page.waitForTimeout(250); };

  const gl0 = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); c?.getExtension('WEBGL_lose_context')?.loseContext(); return !!c; });
  check(gl0, 'WebGL disponible en el navegador de prueba');

  // 1. Cada pantalla: al volver a inicio no queda ningún ResizeObserver sobre elementos desconectados
  for (const id of ids.filter(i => i !== 'inicio')) {
    await go(id);
    if (id === 'post') await example('#exRelax');
    await go('inicio');
    const r = await res();
    check(r.roDetached === 0, `#${id}: ResizeObserver liberados al salir (${r.roDetached} elementos desconectados aún observados)`);
    check(r.glDetached === 0, `#${id}: contextos WebGL liberados al salir (${r.glDetached} vivos en lienzos desconectados)`);
  }

  // 2. Crear y destruir visores 3D repetidamente
  const views3d = ['bandas', 'estructura', 'fonones', 'fuerzas'];
  for (let i = 0; i < 5; i++) for (const id of views3d) { await go(id); await go('inicio'); }
  let r = await res();
  check(r.glDetached === 0 && r.glLive === 0, `5 ciclos por ${views3d.length} pantallas 3D: sin contextos WebGL vivos en #inicio (vivos ${r.glLive}, creados ${r.glCreated})`);
  check(warnings.length === 0, `sin avisos de demasiados contextos WebGL${warnings.length ? ' — ' + warnings[0] : ''}`);
  check(r.roTargets === 0, `sin ResizeObserver activos en #inicio (${r.roTargets})`);

  // 3. Postproceso: cargar otro ejemplo sustituye el visor de geometría en vez de acumularlo
  await go('post'); await example('#exRelax');
  const p1 = await res();
  await example('#exFe'); await example('#exRelax');
  const p2 = await res();
  check(p2.glDetached === 0 && p2.glLive === p1.glLive, `post: recargar ejemplos no acumula visores (vivos ${p1.glLive} → ${p2.glLive}, desconectados ${p2.glDetached})`);
  check(p2.roDetached === 0, `post: los gráficos sustituidos dejan de observarse (${p2.roDetached})`);
  await go('inicio');

  // 4. Fonones: cambiar el tema reconstruye la escena sin acumular buffers WebGL
  await go('fonones'); await toggle(); await toggle(); await page.waitForTimeout(300);
  const f1 = (await res()).glAttached;
  for (let i = 0; i < 10; i++) await toggle();
  await page.waitForTimeout(300);
  const f2 = (await res()).glAttached;
  check(f1.length === 1 && f2.length === 1 && f2[0].buffers <= f1[0].buffers, `fonones: 10 cambios de tema sin acumular buffers (${f1[0]?.buffers} → ${f2[0]?.buffers})`);
  await go('inicio');

  // 5. Bandas: recorrer ε₂ con el cursor reconstruye la nube de puntos k sin acumular buffers
  await go('bandas');
  await page.locator('#view #cE').scrollIntoViewIfNeeded();
  const box = await page.locator('#view #cE').boundingBox();
  const sweep = async () => { for (let i = 1; i <= 120; i++) { await page.mouse.move(box.x + 52 + i * (box.width - 66) / 121, box.y + box.height / 2); await page.waitForTimeout(16); } await page.waitForTimeout(250); };
  await sweep();
  const b1 = (await res()).glAttached;
  await sweep();
  const b2 = (await res()).glAttached;
  check(b2[0]?.made > b1[0]?.made, `bandas: el barrido reconstruye la nube de puntos k (${b2[0]?.made - b1[0]?.made} buffers creados)`);
  check(b1.length === 1 && b2.length === 1 && b2[0].buffers <= b1[0].buffers, `bandas: barrer ε₂ con el cursor no acumula buffers (${b1[0]?.buffers} → ${b2[0]?.buffers})`);
  await go('inicio');

  check(errors.length === 0, `sin errores de página${errors.length ? ' — ' + errors[0] : ''}`);
} finally { await browser.close(); }

console.log(failures.length ? `\n${failures.length} resource check(s) failed` : '\nAll resource checks passed');
process.exit(failures.length ? 1 : 0);
