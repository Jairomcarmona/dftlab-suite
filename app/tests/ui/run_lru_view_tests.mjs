import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lruView } from '../../dftlab/static/js/application/lru-view.js';

const vectors = JSON.parse(readFileSync(new URL('../../../docs/scientific-protocols/vectors/lru-view.cases.json', import.meta.url), 'utf8'));
assert.equal(vectors.cases.length, 22);
for (const vector of vectors.cases) {
  assert.deepStrictEqual(lruView(vector.input), vector.expect, vector.id);
}
console.log(`LR-U view vectors: ${vectors.cases.length}/${vectors.cases.length} PASS`);
