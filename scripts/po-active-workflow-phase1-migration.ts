/**
 * เฟส 1 — PO Active workflow: backfill `poActiveBundleId` + default `mobCycleNumber` บน mobilizations
 * + เติม `mobCycleId` เมื่อยังว่าง (เฟส 0 additive)
 * และ sync `poActiveBundleId` บน `daily_timesheets` จาก PO ปัจจุบัน
 *
 * Auth (เลือกอย่างใดอย่างหนึ่ง):
 * - แนะนำ: โหลด JSON จาก Firebase Console → Project settings → Service accounts → Generate new private key
 *   แล้วใส่ path จริงของไฟล์ (ห้าม copy ชื่อแบบตัวอย่าง your-project-xxxx… จากคู่มือ):
 *   npm run migrate:po-active-phase1 -- --credentials=C:\Users\sahad\Downloads\<ชื่อไฟล์จริง>.json --dry-run
 * - ถ้าเคยตั้ง GOOGLE_APPLICATION_CREDENTIALS ผิด path — ใน PowerShell เซสชันนี้เคลียร์ได้:
 *     $env:GOOGLE_APPLICATION_CREDENTIALS=$null
 * - (ทางเลือก) ติดตั้ง Google Cloud SDK แล้วรัน gcloud auth application-default login — ไม่บังคับถ้ามีไฟล์ JSON แล้ว
 *
 * Usage:
 *   npx tsx scripts/po-active-workflow-phase1-migration.ts --dry-run
 *   npx tsx scripts/po-active-workflow-phase1-migration.ts
 *   npx tsx scripts/po-active-workflow-phase1-migration.ts --mob-only
 *   npx tsx scripts/po-active-workflow-phase1-migration.ts --daily-only
 */

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  getFirestore,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from 'firebase-admin/firestore';
import { existsSync, readFileSync } from 'node:fs';
import { buildMobCycleDocId } from '../src/lib/ops/mob-cycle-ids';
import { resolvePoActiveBundleKeyForPo } from '../src/lib/ops/po-active-bundle';
import type { PurchaseOrder } from '../src/lib/types';
import { resolveFirebaseProjectId } from './resolve-firebase-project-id';

/** ถ้า GOOGLE_APPLICATION_CREDENTIALS ชี้ไฟล์ที่ไม่มี (เช่น copy จาก tutorial) ให้ละทิ้งเพื่อให้ลอง ADC จาก gcloud */
function sanitizeGoogleApplicationCredentialsEnv(): void {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!raw) return;
  if (existsSync(raw)) return;
  console.warn(
    [
      '[migrate] GOOGLE_APPLICATION_CREDENTIALS ชี้ไปที่ไฟล์ที่ไม่มีในเครื่อง:',
      `  ${raw}`,
      'จะไม่ใช้ค่านี้ในรอบนี้ — ตั้ง path ไฟล์ JSON จริง หรือเคลียร์ด้วย: $env:GOOGLE_APPLICATION_CREDENTIALS=$null แล้วใช้ --credentials=...',
    ].join('\n'),
  );
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length).trim() || undefined;
  return undefined;
}

function printCredentialHelp(projectId: string | undefined): void {
  console.error(
    [
      '',
      '[migrate] ยังไม่มี credential ที่ใช้ได้',
      'วิธีหลัก (ไม่ต้องติดตั้ง gcloud):',
      '  • Firebase Console → Project settings → Service accounts → Generate new private key',
      '  • รัน (แทนที่ path ด้วยไฟล์จริงบนเครื่องคุณ — ชื่อมักมี firebase-adminsdk และลงท้าย .json):',
      '      npm run migrate:po-active-phase1 -- --credentials=C:\\Users\\<คุณ>\\Downloads\\....json --dry-run',
      '  • ค้นหาไฟล์ใน Downloads (PowerShell):',
      '      Get-ChildItem $env:USERPROFILE\\Downloads\\*.json | Select-Object FullName',
      '',
      'ถ้าต้องการใช้ gcloud แทนไฟล์: ติดตั้ง Google Cloud SDK แล้วรัน gcloud auth application-default login',
      projectId ? `  projectId: ${projectId}` : '  (แนะนำตั้ง default project ใน .firebaserc หรือ GOOGLE_CLOUD_PROJECT)',
      '',
    ].join('\n'),
  );
}

function looksLikeTutorialCredentialPath(p: string): boolean {
  const n = p.toLowerCase().replace(/\\/g, '/');
  return (
    n.includes('your-project') ||
    n.includes('xxxx') ||
    n.includes('path/to/') ||
    n.includes('your-service-account') ||
    n.includes('example.com')
  );
}

function exitCredentialFileNotFound(path: string): never {
  console.error(`[migrate] ไม่พบไฟล์ credential:\n  ${path}\n`);
  console.error('ดึง key จาก Firebase Console (Service accounts → Generate new private key) แล้วใส่ path เต็มของไฟล์ที่บันทึกลงดิสก์');
  console.error('ค้นหาไฟล์ .json ใน Downloads:');
  console.error('  Get-ChildItem $env:USERPROFILE\\Downloads\\*.json | Select-Object FullName');
  console.error('\nห้ามใช้ชื่อแบบตัวอย่างในเอกสาร (your-project-xxxx / xxxxx)\n');
  process.exit(1);
}

/** โหลด credential จากไฟล์ด้วย cert() — ใช้ได้ทันที ไม่รอ lazy load แบบ applicationDefault */
function initFirebaseAdminFromServiceAccountJson(path: string, projectId: string | undefined): void {
  if (!existsSync(path)) {
    exitCredentialFileNotFound(path);
  }
  let parsed: { project_id?: string } & Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as { project_id?: string } & Record<string, unknown>;
  } catch {
    console.error(`[migrate] อ่านหรือ parse JSON ไม่ได้: ${path}`);
    process.exit(1);
  }
  const pid = projectId || (typeof parsed.project_id === 'string' ? parsed.project_id : undefined);
  initializeApp({
    credential: cert(parsed),
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
      if (looksLikeTutorialCredentialPath(credArg)) {
        console.error(
          [
            '[migrate] --credentials ดูเหมือน path ตัวอย่างจากคู่มือ (เช่น your-project-xxxx / xxxxx)',
            `  ได้รับ: ${credArg}`,
            'ต้องใช้ path จริงของไฟล์ JSON ที่ Firebase ให้หลังกด Generate new private key',
            'ค้นหาใน Downloads: Get-ChildItem $env:USERPROFILE\\Downloads\\*.json | Select-Object FullName',
          ].join('\n'),
        );
        process.exit(1);
      }
      initFirebaseAdminFromServiceAccountJson(credArg, projectId);
      return;
    }
    const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (envPath && existsSync(envPath)) {
      initFirebaseAdminFromServiceAccountJson(envPath, projectId);
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

async function assertFirestoreReachable(db: Firestore, projectId: string | undefined): Promise<void> {
  try {
    await db.collection('mobilizations').limit(1).get();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/default credentials|credential|Could not load/i.test(msg)) {
      printCredentialHelp(projectId);
    }
    throw e;
  }
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function toPurchaseOrder(docId: string, data: DocumentData): PurchaseOrder {
  return { id: docId, ...(data as object) } as PurchaseOrder;
}

const BATCH_LIMIT = 450;

async function paginateCollection(
  collectionPath: string,
  onBatch: (docs: QueryDocumentSnapshot[]) => Promise<void>,
): Promise<void> {
  const db = getFirestore();
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db.collection(collectionPath).orderBy(FieldPath.documentId()).limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    await onBatch(snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
}

async function main() {
  const dryRun = hasFlag('dry-run');
  const mobOnly = hasFlag('mob-only');
  const dailyOnly = hasFlag('daily-only');

  initFirebaseAdmin();
  const projectIdResolved = resolveFirebaseProjectId();
  const db = getFirestore();
  await assertFirestoreReachable(db, projectIdResolved);
  const poCache = new Map<string, PurchaseOrder | null>();

  async function getPo(poId: string): Promise<PurchaseOrder | null> {
    const k = poId.trim();
    if (!k) return null;
    if (poCache.has(k)) return poCache.get(k) ?? null;
    const snap = await db.doc(`purchase_orders/${k}`).get();
    if (!snap.exists) {
      poCache.set(k, null);
      return null;
    }
    const po = toPurchaseOrder(snap.id, snap.data()!);
    poCache.set(k, po);
    return po;
  }

  let mobUpdated = 0;
  let mobSkipped = 0;
  let dailyUpdated = 0;
  let dailySkipped = 0;
  let mobErrors = 0;
  let dailyErrors = 0;

  async function flushBatch(batch: WriteBatch): Promise<void> {
    await batch.commit();
  }

  if (!dailyOnly) {
    console.log('[mobilizations] scanning...');
    await paginateCollection('mobilizations', async (docs) => {
      let batch = dryRun ? null : db.batch();
      let n = 0;

      for (const d of docs) {
        try {
          const data = d.data();
          const poId = typeof data.poId === 'string' ? data.poId.trim() : '';
          if (!poId) {
            mobSkipped++;
            continue;
          }
          const po = await getPo(poId);
          if (!po) {
            console.warn(`[mobilizations] ${d.id}: missing PO ${poId}`);
            mobSkipped++;
            continue;
          }
          const bundleId = resolvePoActiveBundleKeyForPo(po);
          const mobCycle =
            typeof data.mobCycleNumber === 'number' && Number.isFinite(data.mobCycleNumber) && data.mobCycleNumber >= 1
              ? data.mobCycleNumber
              : 1;

          const patch: Record<string, unknown> = {};
          if (data.poActiveBundleId !== bundleId) {
            patch.poActiveBundleId = bundleId;
          }
          if (data.mobCycleNumber !== mobCycle) {
            patch.mobCycleNumber = mobCycle;
          }

          const expectedCycleId = buildMobCycleDocId(d.id, mobCycle);
          const existingCycleId = typeof data.mobCycleId === 'string' ? data.mobCycleId.trim() : '';
          if (!existingCycleId) {
            patch.mobCycleId = expectedCycleId;
          }

          if (Object.keys(patch).length === 0) {
            mobSkipped++;
            continue;
          }

          patch.updatedAt = Date.now();
          mobUpdated++;
          if (dryRun) continue;

          batch!.update(d.ref, patch);
          n++;

          if (n >= BATCH_LIMIT) {
            await flushBatch(batch!);
            batch = db.batch();
            n = 0;
          }
        } catch (e) {
          mobErrors++;
          console.error(`[mobilizations] ${d.id}`, e);
        }
      }

      if (!dryRun && batch && n > 0) await flushBatch(batch);
    });
    console.log(`[mobilizations] updated=${mobUpdated} skipped=${mobSkipped} errors=${mobErrors}${dryRun ? ' (dry-run: no writes)' : ''}`);
  }

  if (!mobOnly) {
    console.log('[daily_timesheets] scanning...');
    await paginateCollection('daily_timesheets', async (docs) => {
      let batch = dryRun ? null : db.batch();
      let n = 0;

      for (const d of docs) {
        try {
          const data = d.data();
          const poId = typeof data.purchaseOrderId === 'string' ? data.purchaseOrderId.trim() : '';
          if (!poId) {
            dailySkipped++;
            continue;
          }
          const po = await getPo(poId);
          if (!po) {
            dailySkipped++;
            continue;
          }
          const bundleId = resolvePoActiveBundleKeyForPo(po);
          if (data.poActiveBundleId === bundleId) {
            dailySkipped++;
            continue;
          }

          dailyUpdated++;
          if (dryRun) continue;

          batch!.update(d.ref, {
            poActiveBundleId: bundleId,
            updatedAt: Date.now(),
          });
          n++;

          if (n >= BATCH_LIMIT) {
            await flushBatch(batch!);
            batch = db.batch();
            n = 0;
          }
        } catch (e) {
          dailyErrors++;
          console.error(`[daily_timesheets] ${d.id}`, e);
        }
      }

      if (!dryRun && batch && n > 0) await flushBatch(batch);
    });
    console.log(`[daily_timesheets] updated=${dailyUpdated} skipped=${dailySkipped} errors=${dailyErrors}${dryRun ? ' (dry-run: no writes)' : ''}`);
  }

  if (dryRun) {
    console.log('\nDry-run: no documents were written. Remove --dry-run to commit.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
