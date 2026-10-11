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
  'app/tests/crystal/run_tests.mjs',
  'app/tests/ui/run_calc_tests.mjs',
  'app/scripts/build.mjs',
];

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
console.log('\nAll reference suites and the build completed.');
