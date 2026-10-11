// Local preview of the compiled standalone files; Node only, loopback only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--port')) {
  console.error('Uso: npm run serve -- --port 8000');
  process.exit(1);
}
const rawPort = args.length ? args[1] : '8000';
if (!/^\d+$/.test(rawPort) || Number(rawPort) > 65535) {
  console.error('El puerto debe ser un entero entre 0 y 65535.');
  process.exit(1);
}
if (!fs.existsSync(path.join(dist, 'dftlab.html'))) {
  console.error('Falta dist/dftlab.html. Ejecuta npm run build primero.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  // Only deliver the two known build outputs, never source or directory listings.
  const name = pathname === '/' ? 'dftlab.html' : pathname.slice(1);
  if (!['dftlab.html', 'dftlab_artifact.html'].includes(name)) {
    res.writeHead(404); res.end(); return;
  }
  const file = path.join(dist, name);
  let stat;
  try { stat = fs.statSync(file); }
  catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(Number(rawPort), '127.0.0.1', () => {
  console.log(`DFT Lab: http://127.0.0.1:${server.address().port}/`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
