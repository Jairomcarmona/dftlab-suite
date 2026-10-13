import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercise the actual view handler without importing the browser JSON/bundle.
const source = fs.readFileSync(new URL('../../dftlab/static/js/views/calc.js', import.meta.url), 'utf8');
const begin = source.indexOf('  function doMass(){');
const end = source.indexOf("  seg($('#mSel'", begin);
assert.ok(begin >= 0 && end > begin);
const handler = source.slice(begin, end);
for (const mode of ['hh', 'hl']) {
  const nodes = {}, pts = [[0, 0], [0.1, -0.01], [0.2, -0.04]];
  let plotted;
  const run = new Function('MS', 'bandPts', '$', 'chart', 'css', 'polyfit', 'root', `${handler}\n doMass();`);
  run({ mode, win: 0.1 }, () => ({ pts, sign: -1, title: mode }),
    id => nodes[id] ??= {}, (_node, spec) => { plotted = spec; }, x => x,
    () => { throw new Error('Degenerate valence band must never be fitted'); }, {});
  assert.equal(nodes['#mOut'].textContent, 'NOT_ESTABLISHED · DEGENERATE_EXTREMUM');
  assert.equal(plotted.series.length, 1);
  assert.deepEqual(plotted.series[0].d, pts);
  assert.equal(plotted.series[0].label, mode);
  assert.equal(plotted.shade, undefined);
}
console.log('Si triple-Gamma mass preview: 2 modes passed; no fit or mass');
