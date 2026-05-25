/**
 * Deploy firestore.rules via Admin SDK (bypasses firebase-tools :test step).
 * Auth (first match): GOOGLE_APPLICATION_CREDENTIALS | Firebase CLI login refresh token | ADC
 *
 * Usage: node scripts/deploy-firestore-rules.mjs
 *        FIREBASE_PROJECT_ID=your-project node scripts/deploy-firestore-rules.mjs
 */
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { cert, getApps, initializeApp, refreshToken } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';

/** Public OAuth client used by firebase-tools CLI (open source). */
const FIREBASE_CLI_OAUTH = {
  clientId: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  clientSecret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const rulesPath = resolve(root, 'firestore.rules');
const projectId =
  process.env.FIREBASE_PROJECT_ID?.trim() || 'studio-9554558161-dc547';
const maxAttempts = Number(process.env.DEPLOY_RULES_MAX_ATTEMPTS || 12);

function isRetryable(err) {
  const msg = `${err?.code ?? ''} ${err?.message ?? err}`.toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('429') ||
    msg.includes('deadline')
  );
}

function loadFirebaseCliRefreshToken() {
  const paths = [
    join(homedir(), '.config', 'configstore', 'firebase-tools.json'),
    join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ];
  for (const p of paths) {
    if (!p || !existsSync(p)) continue;
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'));
      const rt = data?.tokens?.refresh_token;
      if (typeof rt === 'string' && rt.length > 0) return rt;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function initAdmin() {
  if (getApps().length > 0) return;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    console.log('Auth: GOOGLE_APPLICATION_CREDENTIALS');
    const sa = JSON.parse(readFileSync(credPath, 'utf8'));
    initializeApp({ credential: cert(sa), projectId });
    return;
  }
  const cliRefresh = loadFirebaseCliRefreshToken();
  if (cliRefresh) {
    console.log('Auth: Firebase CLI refresh token (configstore/firebase-tools.json)');
    initializeApp({
      credential: refreshToken({
        clientId: FIREBASE_CLI_OAUTH.clientId,
        clientSecret: FIREBASE_CLI_OAUTH.clientSecret,
        refreshToken: cliRefresh,
        type: 'authorized_user',
      }),
      projectId,
    });
    return;
  }
  console.log('Auth: application default credentials');
  initializeApp({ projectId });
}

async function main() {
  const source = readFileSync(rulesPath, 'utf8');
  const kb = (Buffer.byteLength(source, 'utf8') / 1024).toFixed(1);
  console.log(`Project: ${projectId}`);
  console.log(`Rules:   ${rulesPath} (${kb} KB)`);

  initAdmin();
  const securityRules = getSecurityRules();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`\nAttempt ${attempt}/${maxAttempts} — releaseFirestoreRulesetFromSource...`);
      const ruleset = await securityRules.releaseFirestoreRulesetFromSource(source);
      console.log(`\nDeploy complete. Ruleset: ${ruleset.name}`);
      console.log('Propagation may take 1–2 minutes.');
      return;
    } catch (err) {
      console.error(`\nFailed: ${err?.message ?? err}`);
      if (!isRetryable(err) || attempt === maxAttempts) {
        console.error(
          '\nIf auth failed: run `npm run firebase:login` or set GOOGLE_APPLICATION_CREDENTIALS.\n' +
            'Or publish manually: Firebase Console → Firestore → Rules → Publish',
        );
        process.exit(1);
      }
      const waitSec = Math.min(5 * attempt, 60);
      console.log(`Retrying in ${waitSec}s (Google Rules API often returns 503)...`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
}

main();
