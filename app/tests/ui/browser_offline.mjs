// A copied HTML must work without sibling assets, a server or any network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  for (const name of ['dftlab.html', 'dftlab_artifact.html']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dftlab-offline-'));
    const file = path.join(dir, name);
    fs.copyFileSync(path.join(app, 'dist', name), file);
    const ctx = await browser.newContext({ offline: true, acceptDownloads: true });
    try {
      const url = pathToFileURL(file).href;
      const unexpected = [], errors = [];
      await ctx.route('**/*', route => {
        const requested = route.request().url().split('#')[0];
        if (requested === url || /^(data|blob):/.test(requested)) return route.continue();
        unexpected.push(requested);
        return route.abort();
      });
      const page = await ctx.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(url + '#estructura');
      await page.waitForFunction(() => /\(227\)/.test(document.querySelector('#stKv')?.textContent || ''), null, { timeout: 30_000 });
      assert.match(await page.textContent('#kNote'), /cF2/);
      assert.ok(await page.locator('#st3 canvas').count(), 'Offline WebGL viewer mounted');
      const downloadReady = page.waitForEvent('download');
      await page.click('#dlFdf');
      const download = await downloadReady;
      const input = fs.readFileSync(await download.path(), 'utf8');
      assert.match(input, /%block BandLines/);
      assert.match(input, /NumberOfAtoms\s+2/);
      for (const id of ['inicio','ks','pseudos','xc','base','scf','solvers','bandas','dftu','densidad','potencial','espin','lectura','fonones','fuerzas','beyond','calc','post']) {
        await page.locator('a[data-id="'+id+'"]').click();
        await page.waitForFunction(id => document.querySelector('[data-view="'+id+'"]')?.children.length>0, id, {timeout:30_000});
        assert.equal(await page.locator('.callout.warn').filter({hasText:'Esta sección no pudo cargarse'}).count(),0,'Offline view '+id+' loads');
      }
      assert.equal(await page.locator('[data-operative-access], [data-remote-group]').count(),0,'Portable build has no remote SDK shell');
      assert.deepEqual(unexpected, [], 'No network or sibling asset requests');
      assert.deepEqual(errors, [], 'No offline page or console errors');
      console.log(`${name}: isolated file://, inline WASM SG 227, cF2 path, WebGL and FDF download passed (network disabled).`);
    } finally {
      await ctx.close();
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    }
  }
} finally { await browser.close(); }
