/**
 * Diagnose the admin user doc against the rules that are deployed in production.
 *
 * Reports the fields most relevant for isInternalUser() / isAdmin() / collectionGroup gates:
 *   userType, user_type, status, approvalStatus, isActive, role, assignedRoleKey,
 *   permissionProfileKey, permissionProfileKeys, roleIds, accessGroup, accessLevel
 *
 * Usage:
 *   node scripts/diag-admin-user.mjs                       # uses uid from $UID_TO_CHECK
 *   UID_TO_CHECK=ZeZczKXvoRUMt4lRMNvCblylP0oZ \
 *     node scripts/diag-admin-user.mjs
 */
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { cert, getApps, initializeApp, refreshToken } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const FIREBASE_CLI_OAUTH = {
  clientId: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  clientSecret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const projectId =
  process.env.FIREBASE_PROJECT_ID?.trim() || 'studio-9554558161-dc547';
const uid =
  process.env.UID_TO_CHECK?.trim() || 'ZeZczKXvoRUMt4lRMNvCblylP0oZ';

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
    const sa = JSON.parse(readFileSync(credPath, 'utf8'));
    initializeApp({ credential: cert(sa), projectId });
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

initAdmin();

const db = getFirestore();
const snap = await db.collection('users').doc(uid).get();

if (!snap.exists) {
  console.log(`USER /users/${uid} NOT FOUND`);
  process.exit(2);
}

const d = snap.data() ?? {};
const keys = [
  'displayName',
  'email',
  'user_type',
  'userType',
  'status',
  'approvalStatus',
  'isActive',
  'role',
  'assignedRoleKey',
  'assignedRoleKeys',
  'permissionProfileKey',
  'permissionProfileKeys',
  'roleId',
  'roleIds',
  'accessGroup',
  'accessLevel',
  'dataAccess',
  'departmentGroup',
  'department',
  'level',
  'portalRole',
];

console.log(`USER /users/${uid}`);
for (const k of keys) {
  if (k in d) {
    console.log(`  ${k.padEnd(22)} = ${JSON.stringify(d[k])}`);
  }
}
console.log('  ---');
console.log(`  All field names present: ${Object.keys(d).sort().join(', ')}`);

const isInternalType =
  (d.user_type === 'internal' || d.user_type === 'INTERNAL') ||
  (typeof d.userType === 'string' && d.userType.toLowerCase() === 'internal') ||
  (!('user_type' in d) && !('userType' in d));
const isCustomerPortal =
  d.user_type === 'customer_portal' ||
  d.user_type === 'CUSTOMER_PORTAL' ||
  d.userType === 'customer_portal';
const statusActive =
  d.status === 'active' || d.status === 'ACTIVE' ||
  d.approvalStatus === 'ACTIVE' || d.approvalStatus === 'APPROVED' || d.approvalStatus === 'active' ||
  ((!('status' in d) || d.status == null) && (!('approvalStatus' in d) || d.approvalStatus == null) && d.isActive === true);

console.log('\nProduction-rule gate evaluation:');
console.log(`  isInternalTypeData = ${isInternalType && !isCustomerPortal}`);
console.log(`  isActiveStatus     = ${statusActive}`);
console.log(`  ⇒ isInternalUser   = ${isInternalType && !isCustomerPortal && statusActive}`);
console.log(`  ⇒ isInternalStaffDoc = ${isInternalType && !isCustomerPortal}`);

process.exit(0);
