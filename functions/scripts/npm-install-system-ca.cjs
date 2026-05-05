/**
 * Workaround for: npm ERR! UNABLE_TO_VERIFY_LEAF_SIGNATURE (corporate SSL / MITM).
 * Adds Node's --use-system-ca so Windows/macOS trust store is used (Node 20.11+ / 22+).
 *
 * Usage (from repo root or functions/):
 *   node functions/scripts/npm-install-system-ca.cjs
 * Or:
 *   npm run install:with-system-ca
 */
const path = require('path');
const { spawnSync } = require('child_process');

const functionsDir = path.join(__dirname, '..');
const extra = '--use-system-ca';
const prev = process.env.NODE_OPTIONS || '';
process.env.NODE_OPTIONS = [prev, extra].filter(Boolean).join(' ').trim();

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
    cwd: functionsDir,
  });
  if (r.status !== 0 && r.status !== null) process.exit(r.status);
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
}

console.log('[functions] NODE_OPTIONS=', process.env.NODE_OPTIONS);
run('npm', ['install']);
run('npm', ['run', 'build']);
console.log('[functions] install + build finished OK');
