// Exercise the actual Node preview process, including its boundary and CLI.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(app, 'scripts/serve.mjs');
const server = spawn(process.execPath, [script, '--port', '0'], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] });
const closed = once(server, 'close');
let diagnostics = '';
server.stderr.on('data', chunk => { diagnostics += chunk; });
try {
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview startup timed out')), 10_000);
    let text = '';
    server.stdout.on('data', chunk => {
      text += chunk;
      const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(text);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Preview exited ${code}: ${diagnostics}`)); });
  });
  const request = (route, options = {}) => fetch(url + route, { ...options, signal: AbortSignal.timeout(10_000) });
  for (const route of ['', 'dftlab.html', 'dftlab_artifact.html']) {
    const response = await request(route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html; charset=utf-8$/);
    assert.ok((await response.text()).includes('DFT Lab'));
  }
  const head = await request('', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), statSync(path.join(app, 'dist/dftlab.html')).size);
  assert.equal(await head.text(), '');
  for (const route of ['missing', '../package.json', '%2e%2e%2fpackage.json', '.git/config']) {
    const response = await request(route);
    assert.equal(response.status, 404, route);
    await response.text();
  }
  assert.equal((await request('', { method: 'POST' })).status, 405);
} finally {
  server.kill();
  await closed;
}
const badPort = spawnSync(process.execPath, [script, '--port', '-1'], { timeout: 10_000, encoding: 'utf8' });
assert.equal(badPort.status, 1);
assert.match(badPort.stderr, /puerto/);
console.log('Node preview: build outputs, HEAD, missing files, traversal, method and invalid port passed.');
