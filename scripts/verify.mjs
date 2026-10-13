// Use the existing scientific reference suites, without changing tolerances.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tasks = [
  'app/tests/siesta/run_tests.mjs',
  'app/tests/siesta/run_rho_tests.mjs',
  'app/tests/siesta/run_outnotes_tests.mjs',
  'app/tests/siesta/run_fc_tests.mjs',
  'app/tests/siesta/run_import_tests.mjs',
  'app/tests/siesta/run_bands_path_tests.mjs',
  'app/tests/crystal/run_tests.mjs',
  'app/tests/crystal/run_slabs_tests.mjs',
  'app/tests/crystal/run_presets_tests.mjs',
  'app/tests/ui/run_calc_tests.mjs',
  'app/tests/ui/run_escape_tests.mjs',
  'app/tests/ui/run_lifecycle_tests.mjs',
  'app/tests/ui/run_resources_tests.mjs',
  'app/tests/ui/run_scope_store_tests.mjs',
  'app/scripts/check-contract-validators.mjs',
  'app/tests/ui/run_contract_tests.mjs',
  'app/tests/ui/run_sdk_tests.mjs',
  'app/scripts/check-import-boundaries.mjs',
  'app/scripts/build.mjs',
  'app/tests/tooling/run_serve_tests.mjs',
  'contracts/scripts/check-contracts.mjs',
  'scripts/check-protocol-vectors.mjs',
  'docs/inventory/audit.mjs',
];

if (process.argv.includes('--browser')) tasks.push('app/scripts/test-browser.mjs');

for (const task of tasks) {
  console.log(`\nRunning ${task}`);
  const result = spawnSync(process.execPath, [path.join(root, task)], {
    cwd: root, stdio: 'inherit', shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`${task} failed (exit ${result.status}, signal ${result.signal}).`);
    process.exit(result.status || 1);
  }
}
console.log(`\nAll reference suites, tooling and the build completed${process.argv.includes('--browser') ? ', including browser checks' : ' (browser checks not requested)'}.`);
