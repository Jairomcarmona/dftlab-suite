#!/usr/bin/env node
// Pruebas del ciclo de vida de vistas (bloque B):  node tests/ui/run_lifecycle_tests.mjs
// Nivel Node con dobles mínimos de matchMedia/MutationObserver: onTheme devuelve una desuscripción
// idempotente y el ámbito de vista (core/lifecycle.js) libera todo una sola vez.
// El recorrido de las 19 pantallas en navegador está en tests/ui/browser_lifecycle.mjs.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- dobles: una media query y MutationObserver que registran suscripciones vivas ---
const mq = { listeners: new Set(), addEventListener(t, f){ if (t === 'change') this.listeners.add(f); }, removeEventListener(t, f){ if (t === 'change') this.listeners.delete(f); } };
const observers = new Set();
globalThis.document = { documentElement: {} };
globalThis.matchMedia = () => mq;
globalThis.MutationObserver = class { constructor(f){ this.f = f; } observe(){ observers.add(this); } disconnect(){ observers.delete(this); } };
const fireTheme = () => { for (const o of [...observers]) o.f(); for (const f of [...mq.listeners]) f(); };

const JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dftlab/static/js');
const imp = p => import(pathToFileURL(path.join(JS, p)).href);
const { onTheme } = await imp('core/ui.js');
const { createViewScope } = await imp('core/lifecycle.js');

let pass = 0, fail = 0; const bad = [];
const check = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + ' ' + d); } };
const live = () => observers.size + mq.listeners.size;

// onTheme
{
  let n = 0; const off = onTheme(() => n++);
  check('onTheme devuelve una función', typeof off === 'function');
  check('onTheme registra observador y listener', observers.size === 1 && mq.listeners.size === 1);
  fireTheme(); check('el callback recibe el cambio de tema', n === 2, String(n));
  off(); check('la desuscripción libera ambos', live() === 0);
  fireTheme(); check('tras desuscribir no se llama', n === 2, String(n));
  let threw = false; try { off(); } catch { threw = true; }
  check('la desuscripción es idempotente', !threw && live() === 0);
}

// ámbito de vista
{
  const v = createViewScope(); let calls = 0, order = [];
  v.onTheme(() => calls++);
  v.add(() => order.push('a')); v.add(() => order.push('b'));
  v.add(() => { throw new Error('limpieza que falla'); });
  v.add(() => order.push('c'));
  const ro = { n: 0, disconnect(){ this.n++; } }; v.observer(ro);
  const res = { n: 0, destroy(){ this.n++; } }; v.own(res);
  check('vigente al crearse', v.alive === true);
  fireTheme(); check('onTheme del ámbito actúa mientras está vigente', calls === 2);
  const origErr = console.error; console.error = () => {};
  v.dispose(); console.error = origErr;
  check('dispose marca la vista como no vigente', v.alive === false);
  check('dispose libera la suscripción de tema', live() === 0);
  check('limpiezas en orden inverso y una que falla no corta las demás', order.join('') === 'cba', order.join(''));
  check('observador desconectado y recurso propio destruido', ro.n === 1 && res.n === 1);
  check('signal abortada', v.signal?.aborted === true);
  fireTheme(); check('sin callbacks tras salir', calls === 2);
  v.dispose(); check('dispose es idempotente', ro.n === 1 && res.n === 1 && order.length === 3);
  let late = 0; v.add(() => late++); check('lo registrado tras salir (p. ej. después de un await) se libera al instante', late === 1);
  v.onTheme(() => calls++); check('onTheme tras salir no deja suscripción', live() === 0);
  let g = 0; const cb = v.guard(() => ++g); check('guard no ejecuta tras salir', cb() === undefined && g === 0);
}

// timers: la vista abandonada no ejecuta tareas diferidas
{
  const v = createViewScope(); let t = 0, i = 0;
  v.timeout(() => t++, 5); v.interval(() => i++, 5); v.dispose();
  await new Promise(r => setTimeout(r, 40));
  check('timeout e interval cancelados al salir', t === 0 && i === 0, `${t}/${i}`);
}

// navegación repetida: N montajes y salidas no acumulan suscripciones
{
  let calls = 0;
  for (let k = 0; k < 50; k++) { const v = createViewScope(); v.onTheme(() => calls++); v.dispose(); }
  const cur = createViewScope(); cur.onTheme(() => calls++);
  fireTheme();
  check('50 montajes/salidas: solo la vista vigente recibe el tema', calls === 2 && live() === 2, `calls=${calls} live=${live()}`);
  cur.dispose(); check('y se libera al salir', live() === 0);
}

console.log(`lifecycle: ${pass} ok, ${fail} fallos`);
if (fail) { bad.forEach(b => console.log('  FALLO ' + b)); process.exit(1); }
