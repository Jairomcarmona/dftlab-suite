#!/usr/bin/env node
// Optional browser smoke test: loads the crystal modules in headless Chromium (Playwright)
// from a local static server and checks the three moyo loading modes
// (fetch over http, 'inline' base64 module, globalThis.MOYO_WASM_BASE64).
//
//   npm ci && npm run browser:install (desde app/); node browser_smoke.mjs
//
// Fails when the pinned local Playwright/Chromium is unavailable.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../dftlab/static');

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const page = (mode) => `<!doctype html><meta charset="utf-8"><title>smoke</title>
<script type="module">
${mode === 'global' ? "import b64 from '/vendor/moyo/moyo_wasm_inline.js'; globalThis.MOYO_WASM_BASE64 = b64;" : ''}
import { initMoyo, analyze } from '/js/crystal/symmetry.js';
import { getExplicitKPath } from '/js/crystal/kpath.js';
import { brillouinZone } from '/js/crystal/bz.js';
import { writeBandLines, readCIF, writeCIF } from '/js/crystal/formats.js';
try {
  await initMoyo(${mode === 'inline' ? "'inline'" : ''});
  const a = 5.431;
  const si = { lattice: [[0, a/2, a/2], [a/2, 0, a/2], [a/2, a/2, 0]], positions: [[0,0,0],[0.25,0.25,0.25]], numbers: [14,14] };
  const d = analyze(si);
  const r = getExplicitKPath(si);
  const bz = brillouinZone(r.reciprocal_primitive_lattice);
  const back = readCIF(writeCIF(si));
  window.RESULT = { number: d.number, ext: r.bravais_lattice_extended, nk: r.explicit_kpoints_rel.length,
    bzFaces: bz.faces.length, bandLines: writeBandLines(r).split('\\n').length, cifAtoms: back.positions.length };
} catch (e) { window.RESULT = { error: String(e && e.stack || e) }; }
</script>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/page/')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page(u.pathname.slice(6)));
    return;
  }
  const f = path.join(ROOT, path.normalize(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
let fail = 0;
for (const mode of ['fetch', 'inline', 'global']) {
  const p = await browser.newPage();
  await p.goto(`http://127.0.0.1:${port}/page/${mode}`);
  await p.waitForFunction(() => window.RESULT, null, { timeout: 30000 });
  const r = await p.evaluate(() => window.RESULT);
  const ok = r.number === 227 && r.ext === 'cF2' && r.nk === 202 && r.bzFaces === 14 && r.cifAtoms === 2;
  if (!ok) fail++;
  console.log(`${mode.padEnd(7)} ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(r)}`);
  await p.close();
}
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
