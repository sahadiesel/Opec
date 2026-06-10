/**
 * ปิด AR ค้างซ้ำ (AR-COM หลังออกใบกำกับ / AR ใบกำกับหลังออกใบเสร็จ)
 *
 * Auth (เลือกอย่างใดอย่างหนึ่ง):
 * - แนะนำ: Firebase Console → Service accounts → Generate new private key
 *   npm run migrate:reconcile-ar -- --credentials=C:\path\to\service-account.json --dry-run
 * - GOOGLE_APPLICATION_CREDENTIALS หรือ FIREBASE_SERVICE_ACCOUNT_PATH
 * - gcloud auth application-default login
 *
 * Usage:
 *   npm run migrate:reconcile-ar -- --dry-run
 *   npm run migrate:reconcile-ar -- --apply
 *   npm run migrate:reconcile-ar -- --credentials=C:\path\to\sa.json --apply
 */

import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  applyReconcileDuplicateCommercialAr,
  scanReconcileDuplicateCommercialAr,
} from '../src/lib/migrations/reconcile-duplicate-commercial-ar';
import { resolveFirebaseProjectId } from './resolve-firebase-project-id';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length).trim() || undefined;
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function sanitizeGoogleApplicationCredentialsEnv(): void {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!raw || existsSync(raw)) return;
  console.warn(`[migrate] GOOGLE_APPLICATION_CREDENTIALS ไม่พบไฟล์: ${raw} — ข้ามค่านี้`);
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

function printCredentialHelp(projectId: string | undefined): void {
  console.error(
    [
      '',
      '[migrate] ยังไม่มี credential ที่ใช้ได้',
      '  Firebase Console → Project settings → Service accounts → Generate new private key',
      '  npm run migrate:reconcile-ar -- --credentials=C:\\Users\\<คุณ>\\Downloads\\....json --apply',
      projectId ? `  projectId: ${projectId}` : '',
      '',
    ].join('\n'),
  );
}

function initFromServiceAccountJson(path: string, projectId: string | undefined): void {
  if (!existsSync(path)) {
    console.error(`[migrate] ไม่พบไฟล์ credentials: ${path}`);
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { project_id?: string } & Record<string, unknown>;
  const pid = projectId || (typeof parsed.project_id === 'string' ? parsed.project_id : undefined);
  initializeApp({
    credential: cert(parsed as ServiceAccount),
    ...(pid ? { projectId: pid } : {}),
  });
}

function initFirebaseAdmin(): void {
  if (getApps().length) return;
  sanitizeGoogleApplicationCredentialsEnv();
  const projectId = resolveFirebaseProjectId();
  const credArg = argValue('credentials');

  try {
    if (credArg) {
      initFromServiceAccountJson(credArg, projectId);
      return;
    }
    const envPath =
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
    if (envPath && existsSync(envPath)) {
      initFromServiceAccountJson(envPath, projectId);
      return;
    }
    initializeApp({
      credential: applicationDefault(),
      ...(projectId ? { projectId } : {}),
    });
  } catch (e) {
    printCredentialHelp(projectId);
    throw e;
  }
}

async function main() {
  const dryRun = hasFlag('dry-run') || !hasFlag('apply');

  initFirebaseAdmin();
  const db = getFirestore();

  try {
    await db.collection('accounts_receivable').limit(1).get();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/default credentials|credential|Could not load/i.test(msg)) {
      printCredentialHelp(resolveFirebaseProjectId());
    }
    throw e;
  }

  const scan = await scanReconcileDuplicateCommercialAr(db);
  const allPlans = [...scan.commercialArPlans, ...scan.taxArPlans];

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Commercial AR (AR-COM) to close: ${scan.commercialArPlans.length}`);
  for (const p of scan.commercialArPlans) {
    console.log(`  - ${p.documentNo}: ${p.reason}`);
  }
  console.log(`Tax invoice AR to close: ${scan.taxArPlans.length}`);
  for (const p of scan.taxArPlans) {
    console.log(`  - ${p.documentNo}: ${p.reason}`);
  }

  if (dryRun) {
    console.log('\nNo changes written. Re-run with --apply to update Firestore.');
    return;
  }

  const applied = await applyReconcileDuplicateCommercialAr(db, allPlans, false);
  console.log(`\nUpdated ${applied} AR document(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
