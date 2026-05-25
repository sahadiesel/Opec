/**
 * Retry firebase-tools deploy --only firestore:rules (handles HTTP 503 bursts).
 * Usage: node scripts/deploy-firestore-rules-cli-retry.mjs
 */
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const maxAttempts = Number(process.env.DEPLOY_RULES_MAX_ATTEMPTS || 10);

function runDeploy() {
  return spawnSync(
    'npx',
    ['firebase-tools', 'deploy', '--only', 'firestore:rules', '--non-interactive'],
    {
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: '--use-system-ca' },
      stdio: 'inherit',
      shell: true,
    },
  );
}

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\n========== firebase-tools deploy attempt ${attempt}/${maxAttempts} ==========\n`);
    const result = runDeploy();
    if (result.status === 0) {
      console.log('\nDeploy complete.');
      return;
    }
    if (attempt < maxAttempts) {
      const waitSec = Math.min(5 * attempt, 60);
      console.log(`\nDeploy failed (exit ${result.status ?? '?'}). Waiting ${waitSec}s...\n`);
      await sleep(waitSec * 1000);
    }
  }

  console.error(
    `\nGave up after ${maxAttempts} attempts. Try:\n` +
      '  npm run deploy:rules:admin\n' +
      '  Or Firebase Console → Firestore → Rules → Publish',
  );
  process.exit(1);
}

main();
