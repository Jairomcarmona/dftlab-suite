import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFDF, readFDF, readStructure } from '../../dftlab/static/js/crystal/formats.js';
import { resolve } from '../../../docs/scientific-protocols/vectors/fdf-oracle.mjs';

const doc = JSON.parse(fs.readFileSync(new URL('../../../docs/scientific-protocols/vectors/preflight.cases.json', import.meta.url)));
let count = 0;
for (const c of doc.cases) {
  // Resolution only. Units, the keyword registry and scientific validation belong to QRAFT.
  const expected = resolve(c.files, c.root);
  const got = parseFDF(c.files[c.root], { files: c.files, root: c.root });
  if (expected.error) {
    assert.equal(got.error, expected.error, c.id);
    assert.equal(got.status, expected.error === 'INCLUDE_NOT_FOUND' ? 'NOT_CHECKED' : 'FAIL', c.id);
  } else {
    assert.equal(got.error, undefined, c.id);
    const values = {}, blocks = {};
    for (const [key, entry] of Object.entries(expected.values)) {
      if (entry.kind === 'block') blocks[key] = entry.rows;
      else values[key] = entry.tokens.join(' ');
    }
    assert.deepEqual(got.values, values, c.id);
    assert.deepEqual(got.blocks, blocks, c.id);
  }
  count++;
}
assert.deepEqual(parseFDF('X 1\n%block x\n2\n%endblock x\n').values, { x: '1' });
assert.deepEqual(parseFDF('%block X\n1\n%endblock X\nx 2\n').blocks, { x: ['1'] });
assert.equal(parseFDF('%include missing.fdf\nMeshCutoff 300 Ry\n').status, 'NOT_CHECKED');
assert.deepEqual(parseFDF('%block X < rows.dat\nY 3', { files: { 'rows.dat': '1 # comment\n2' } }).values, { y: '3' });
assert.equal(parseFDF('X < missing.fdf').status, 'NOT_CHECKED');
const geometry = doc.cases.find(c => c.id === 'pf-block-redirect');
assert.deepEqual(readStructure(geometry.files[geometry.root], {
  format: 'fdf', root: geometry.root, files: geometry.files,
}).lattice, geometry.expect.rows);
for (const reader of [readFDF, text => readStructure(text, { format: 'fdf' })]) {
  assert.throws(() => reader(geometry.files[geometry.root]), error =>
    error.code === 'NOT_CHECKED' && error.cause.error === 'INCLUDE_NOT_FOUND');
  assert.throws(() => reader('%include input.fdf'), error => error.code === 'FAIL' && error.cause.error === 'CYCLIC_INCLUDE');
}
console.log(`FDF preview: ${count} normative resolutions, 5 parser and 5 reader regressions passed`);
