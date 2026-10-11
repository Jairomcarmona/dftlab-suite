// All browser checks are mandatory here; no global packages or silent skips.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const task of [
  'tests/ui/browser_regressions.mjs',
  'tests/ui/browser_lifecycle.mjs',
  'tests/ui/browser_offline.mjs',
  'tests/crystal/browser_smoke.mjs',
]) {
  console.log(`\nBrowser: ${task}`);
  const result = spawnSync(process.execPath, [path.join(app, task)], {
    cwd: app, stdio: 'inherit', shell: false,
    env: { ...process.env, REQUIRE_BROWSER: '1' },
    timeout: 120_000,
  });
  if (result.error) {
    console.error(`${task}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nAll mandatory browser suites passed.');
