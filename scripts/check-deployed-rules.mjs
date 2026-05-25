/**
 * Inspect currently deployed Firestore rules via Firebase Admin SDK.
 * Auth uses the same path as deploy-firestore-rules.mjs (Firebase CLI refresh token).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { cert, getApps, initializeApp, refreshToken } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { createHash } from 'crypto';

const FIREBASE_CLI_OAUTH = {
  clientId: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  clientSecret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const localPath = resolve(root, 'firestore.rules');
const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || 'studio-9554558161-dc547';

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
    } catch {}
  }
  return null;
}

function initAdmin() {
  if (getApps().length > 0) return;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf8'))), projectId });
    return;
  }
  const cliRefresh = loadFirebaseCliRefreshToken();
  if (cliRefresh) {
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
  initializeApp({ projectId });
}

function sha(s) {
  return createHash('sha256').update(s).digest('hex');
}

async function main() {
  initAdmin();
  const sr = getSecurityRules();
  console.log(`Project: ${projectId}`);
  console.log('Fetching active Firestore ruleset...');
  const ruleset = await sr.getFirestoreRuleset();
  const file = ruleset.source?.[0] ?? ruleset.source?.files?.[0];
  const content = file?.content ?? '';
  console.log('');
  console.log('=== DEPLOYED RULESET ===');
  console.log(`Name        : ${ruleset.name}`);
  console.log(`Create time : ${ruleset.createTime}`);
  console.log(`Size        : ${content.length} bytes (${(content.length / 1024).toFixed(1)} KB)`);
  console.log(`Lines       : ${content.split('\n').length}`);
  console.log(`SHA-256     : ${sha(content)}`);
  console.log(`Head        : ${content.substring(0, 200).replace(/\n/g, '\\n')}`);
  console.log('');
  if (existsSync(localPath)) {
    const local = readFileSync(localPath, 'utf8');
    console.log('=== LOCAL firestore.rules ===');
    console.log(`Size        : ${local.length} bytes (${(local.length / 1024).toFixed(1)} KB)`);
    console.log(`Lines       : ${local.split('\n').length}`);
    console.log(`SHA-256     : ${sha(local)}`);
    console.log(`Head        : ${local.substring(0, 200).replace(/\n/g, '\\n')}`);
    console.log('');
    console.log(`MATCH       : ${sha(content) === sha(local) ? 'YES (deployed == local)' : 'NO (deployed differs from local)'}`);
  }
  writeFileSync(resolve(root, 'firestore.rules.deployed.txt'), content);
  console.log('');
  console.log(`Wrote deployed copy: firestore.rules.deployed.txt`);
}

main().catch((e) => {
  console.error('Error:', e?.message ?? e);
  process.exit(1);
});
