/**
 * Quick probe: post a minimal rules file to test if Firebase Rules API is responsive.
 * Helps determine if 503 is global API outage vs. content-related.
 */
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { cert, getApps, initializeApp, refreshToken } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';

const FIREBASE_CLI_OAUTH = {
  clientId: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  clientSecret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
};
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || 'studio-9554558161-dc547';

function loadFirebaseCliRefreshToken() {
  for (const p of [
    join(homedir(), '.config', 'configstore', 'firebase-tools.json'),
    join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ]) {
    if (!p || !existsSync(p)) continue;
    try {
      const rt = JSON.parse(readFileSync(p, 'utf8'))?.tokens?.refresh_token;
      if (typeof rt === 'string' && rt.length > 0) return rt;
    } catch {}
  }
  return null;
}

function initAdmin() {
  if (getApps().length > 0) return;
  const rt = loadFirebaseCliRefreshToken();
  if (rt) {
    initializeApp({
      credential: refreshToken({
        clientId: FIREBASE_CLI_OAUTH.clientId,
        clientSecret: FIREBASE_CLI_OAUTH.clientSecret,
        refreshToken: rt,
        type: 'authorized_user',
      }),
      projectId,
    });
    return;
  }
  initializeApp({ projectId });
}

const tests = [
  { name: 'MINIMAL (38 fns, 21 KB)', source: readFileSync(resolve(root, 'firestore.rules.minimal'), 'utf8') },
];

async function main() {
  initAdmin();
  const sr = getSecurityRules();
  for (const t of tests) {
    console.log(`\n--- ${t.name} (${t.source.length} bytes) ---`);
    const start = Date.now();
    try {
      const rs = await sr.createRuleset(sr.createRulesFileFromSource('firestore.rules', t.source));
      console.log(`createRuleset OK in ${Date.now() - start}ms: ${rs.name}`);
      console.log('NOT releasing (probe only). Delete it from Console if you want to clean up.');
    } catch (err) {
      console.log(`createRuleset FAILED in ${Date.now() - start}ms: ${err?.code ?? ''} ${err?.message ?? err}`);
    }
  }
}

main().catch((e) => {
  console.error('Top-level error:', e?.message ?? e);
  process.exit(1);
});
