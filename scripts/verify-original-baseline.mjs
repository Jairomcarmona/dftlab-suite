// Verify the immutable historical snapshot, not the current evolving sources.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tag = 'baseline-v1';
function git(args, input) {
  const result = spawnSync('git', args, {
    cwd: root, input, shell: false, maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString('utf8'));
  return result.stdout;
}
const manifest = JSON.parse(git(['show', `${tag}:docs/migration/original-file-manifest.json`]).toString('utf8'));
if (manifest.schema_version !== '1.0.0' || !Array.isArray(manifest.files)) {
  throw new Error('Unsupported baseline manifest.');
}
const seen = new Set();
for (const file of manifest.files) {
  if (seen.has(file.path) || /[\r\n]/.test(file.path) || !Number.isSafeInteger(file.size_bytes)) {
    throw new Error(`Invalid manifest entry: ${file.path}`);
  }
  seen.add(file.path);
}
const refs = manifest.files.map((file) => `${tag}:${file.path}`).join('\n') + '\n';
const blobs = git(['cat-file', '--batch'], refs);
let offset = 0;
let total = 0;
for (const file of manifest.files) {
  const end = blobs.indexOf(10, offset);
  if (end < 0) throw new Error(`Missing object header: ${file.path}`);
  const header = blobs.subarray(offset, end).toString('utf8');
  const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
  if (!match) throw new Error(`Missing or non-blob object: ${file.path}`);
  const size = Number(match[1]);
  offset = end + 1;
  const contents = blobs.subarray(offset, offset + size);
  const digest = createHash('sha256').update(contents).digest('hex');
  if (size !== file.size_bytes || contents.length !== size || digest !== file.sha256) {
    throw new Error(`Baseline integrity mismatch: ${file.path}`);
  }
  offset += size;
  if (blobs[offset++] !== 10) throw new Error(`Malformed batch delimiter: ${file.path}`);
  total += size;
}
if (offset !== blobs.length) throw new Error('Unexpected extra baseline objects.');
console.log(`Verified ${manifest.files.length} historical files (${total} bytes), SHA-256 matches ${tag}.`);
