#!/usr/bin/env node
// Liberación de recursos (bloque H):  node tests/ui/run_resources_tests.mjs
// Nivel Node, sin WebGL: (1) collect/disposeAll de core/three-view.js liberan geometrías, materiales y
// texturas una sola vez y respetan los recursos compartidos; (2) core/chart.js usa un ResizeObserver
// común y deja de observar los lienzos liberados o desconectados.
// La comprobación con WebGL real y navegación está en tests/ui/browser_resources.mjs.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- doble de ResizeObserver que registra los elementos observados ---
const ros = [];
globalThis.ResizeObserver = class { constructor(f){ this.f = f; this.t = new Set(); ros.push(this); } observe(t){ this.t.add(t); } unobserve(t){ this.t.delete(t); } disconnect(){ this.t.clear(); } };
globalThis.document = { documentElement: {} };

const JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dftlab/static/js');
const imp = p => import(pathToFileURL(path.join(JS, p)).href);
const THREE = await imp('../vendor/three/three.module.js');
const { collect, disposeAll } = await imp('core/three-view.js');
const { chart, releaseChart, releaseCharts } = await imp('core/chart.js');

let pass = 0, fail = 0; const bad = [];
const check = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + ' ' + d); } };

// --- three-view: propiedad de recursos ---
{
  const count = new Map(); const track = r => { r.addEventListener('dispose', () => count.set(r, (count.get(r) || 0) + 1)); return r; };
  const geo = track(new THREE.SphereGeometry(1, 8, 6)), tex = track(new THREE.DataTexture(new Uint8Array(4), 1, 1));
  const mat = track(new THREE.MeshStandardMaterial({ map: tex })), lineMat = track(new THREE.LineBasicMaterial());
  const sharedGeo = track(new THREE.BoxGeometry()), sharedMat = track(new THREE.MeshBasicMaterial());
  const g = new THREE.Group(), sub = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, mat), sub);       // reutilizados dentro del grupo
  const lineGeo = track(new THREE.BufferGeometry()); sub.add(new THREE.Line(lineGeo, lineMat));   // anidado
  sub.add(new THREE.Mesh(sharedGeo, [sharedMat, mat]));                  // material múltiple
  const res = collect(g);
  check('collect reúne geometrías anidadas', res.has(geo) && res.has(lineGeo) && res.has(sharedGeo));
  check('collect reúne materiales (también en arreglos) y texturas', res.has(mat) && res.has(lineMat) && res.has(sharedMat) && res.has(tex));
  check('collect no duplica recursos reutilizados', res.size === 7, `(${res.size})`);
  const shared = new WeakSet([sharedGeo, sharedMat]);
  disposeAll(res, shared);
  for (const [n, r] of [['geometría', geo], ['material', mat], ['textura', tex], ['línea', lineGeo], ['material de línea', lineMat]])
    check(`${n} propia liberada una vez`, count.get(r) === 1, `(${count.get(r) || 0})`);
  check('recursos compartidos no se liberan', !count.has(sharedGeo) && !count.has(sharedMat));
}

// --- chart: un observador común y liberación ---
{
  const fake = () => { const l = {}; return { isConnected: false, offsetParent: null, addEventListener(t, f){ l[t] = f; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) }; };
  const cfg = { xlim: [0, 1], ylim: [0, 1], series: [] };
  const a = fake(), b = fake(), c = fake();
  chart(a, cfg); chart(b, cfg); chart(a, cfg);
  const ro = ros[ros.length - 1];
  check('un solo ResizeObserver para todos los gráficos', ros.length === 1, `(${ros.length})`);
  check('repintar un gráfico no lo observa dos veces', ro.t.size === 2);
  releaseChart(a); releaseChart(a);
  check('releaseChart deja de observar (idempotente)', !ro.t.has(a) && ro.t.has(b));
  chart(c, cfg);
  releaseCharts({ contains: cv => cv === c });
  check('releaseCharts libera solo los lienzos del contenedor', !ro.t.has(c) && ro.t.has(b));
  b.isConnected = false; ro.f([{ target: b }]);
  check('un lienzo desconectado deja de observarse al notificarse', !ro.t.has(b));
  chart(a, cfg);
  check('un lienzo liberado puede volver a usarse', ro.t.has(a));
}

console.log(`resources: ${pass} passed, ${fail} failed`);
if (fail) { console.log(bad.join('\n')); process.exit(1); }
