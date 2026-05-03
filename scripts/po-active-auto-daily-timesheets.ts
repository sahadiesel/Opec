/**
 * เฟส 4 — Admin: ซิงค์ daily_timesheets แบบ PO Active auto (work_day) สำหรับ mobilizations ที่เข้าเงื่อนไข
 *
 * Auth เหมือน migrate อื่น — ดู scripts/po-active-workflow-phase1-migration.ts
 *
 * Usage:
 *   npm run migrate:po-active-auto-daily -- --dry-run
 *   npm run migrate:po-active-auto-daily -- --assignment=MOB_DOC_ID
 *   npm run migrate:po-active-auto-daily -- --credentials=C:\\path\\service.json
 */

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  getFirestore,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { existsSync, readFileSync } from 'node:fs';
import { DailyTimesheetSchema } from '../src/lib/validations/timesheet-schemas';
import { resolvePoActiveBundleKeyForPo } from '../src/lib/ops/po-active-bundle';
import {
  buildPoActiveAutoDailyRowPayload,
  computePoActiveAutoDailyRange,
  eachYmdInRange,
  isAssignmentEligibleForPoActiveAutoDaily,
  poActiveDailyTimesheetDocId,
} from '../src/lib/timesheet/po-active-auto-daily-build';
import type { Assignment, DailyTimesheet, LaborCostContractTerm, POLine, PurchaseOrder, Worker } from '../src/lib/types';
import { resolveFirebaseProjectId } from './resolve-firebase-project-id';

const BATCH_LIMIT = 450;
const ACTOR_LABEL = 'admin-script:po-active-auto-daily';

function sanitizeGoogleApplicationCredentialsEnv(): void {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!raw) return;
  if (existsSync(raw)) return;
  console.warn(
    [
      '[po-active-auto-daily] GOOGLE_APPLICATION_CREDENTIALS ชี้ไฟล์ที่ไม่มี — จะข้ามค่านี้',
      `  ${raw}`,
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

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function printCredentialHelp(projectId: string | undefined): void {
  console.error(
    [
      '',
      '[po-active-auto-daily] ไม่มี credential',
      '  npm run migrate:po-active-auto-daily -- --credentials=C:\\Users\\<คุณ>\\Downloads\\....json --dry-run',
      '  หรือ gcloud auth application-default login',
      projectId ? `  projectId: ${projectId}` : '',
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
  console.error(`[po-active-auto-daily] ไม่พบไฟล์ credential:\n  ${path}\n`);
  process.exit(1);
}

function initFirebaseAdminFromServiceAccountJson(path: string, projectId: string | undefined): void {
  if (!existsSync(path)) exitCredentialFileNotFound(path);
  let parsed: { project_id?: string } & Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as { project_id?: string } & Record<string, unknown>;
  } catch {
    console.error(`[po-active-auto-daily] อ่าน JSON ไม่ได้: ${path}`);
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
        console.error('[po-active-auto-daily] --credentials ดูเหมือน path ตัวอย่าง — ใช้ไฟล์ JSON จริงจาก Firebase');
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

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k as keyof T] === undefined) delete out[k as keyof T];
  }
  return out;
}

function isTimesheetFinanciallyImmutable(status: string | undefined): boolean {
  return ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED'].includes(status || '');
}

function pickLaborCostTermIdForDate(terms: LaborCostContractTerm[], date: string): string | undefined {
  const hit = terms.find((t) => t.effectiveDate <= date && t.endDate >= date);
  if (hit) return hit.id;
  return terms[0]?.id;
}

async function loadLaborCostTermsForPoAdmin(db: Firestore, purchaseOrderId: string): Promise<LaborCostContractTerm[]> {
  const snap = await db
    .collection('labor_cost_contract_terms')
    .where('relatedPurchaseOrderId', '==', purchaseOrderId)
    .where('status', '==', 'ACTIVE')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as LaborCostContractTerm));
}

async function paginateCollection(
  db: Firestore,
  collectionPath: string,
  onBatch: (docs: QueryDocumentSnapshot[]) => Promise<void>,
): Promise<void> {
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

type Totals = { created: number; updated: number; skipped: number };

async function syncOneMobilization(
  db: Firestore,
  assignment: Assignment,
  dryRun: boolean,
  totals: Totals,
): Promise<void> {
  if (!isAssignmentEligibleForPoActiveAutoDaily(assignment)) return;

  const poSnap = await db.collection('purchase_orders').doc(assignment.poId).get();
  if (!poSnap.exists) return;
  const po = { id: poSnap.id, ...(poSnap.data() as object) } as PurchaseOrder;

  const lineSnap = await db.collection('purchase_orders').doc(assignment.poId).collection('po_lines').doc(assignment.poLineId).get();
  if (!lineSnap.exists) return;
  const line = { id: lineSnap.id, ...(lineSnap.data() as object) } as POLine;

  const range = computePoActiveAutoDailyRange(assignment, po);
  if (!range) return;

  let workerName = (assignment.workerName || '').trim();
  if (!workerName) {
    const wSnap = await db.collection('workers').doc(assignment.workerId).get();
    if (wSnap.exists) {
      const w = wSnap.data() as Worker;
      workerName = `${w.firstName || ''} ${w.lastName || ''}`.trim();
    }
  }
  if (!workerName) workerName = assignment.workerId;

  const bundleId = resolvePoActiveBundleKeyForPo(po);
  const laborTerms = await loadLaborCostTermsForPoAdmin(db, po.id);

  let batch = db.batch();
  let batchCount = 0;
  const now = Date.now();

  const flush = async () => {
    if (batchCount === 0) return;
    if (!dryRun) await batch.commit();
    batch = db.batch();
    batchCount = 0;
  };

  for (const date of eachYmdInRange(range.start, range.end)) {
    const id = poActiveDailyTimesheetDocId(assignment.workerId, assignment.id, date);
    const dRef = db.collection('daily_timesheets').doc(id);
    const existing = await dRef.get();

    const laborCostContractTermId = pickLaborCostTermIdForDate(laborTerms, date);
    const basePayload = buildPoActiveAutoDailyRowPayload({
      assignment,
      po,
      line,
      date,
      workerNameSnapshot: workerName,
      poActiveBundleId: bundleId,
      laborCostContractTermId,
    });

    if (existing.exists) {
      const cur = existing.data() as DailyTimesheet;
      if (isTimesheetFinanciallyImmutable(cur.status)) {
        totals.skipped++;
        continue;
      }
      if (cur.poActiveAutoDaily !== true) {
        totals.skipped++;
        continue;
      }
      if (dryRun) {
        totals.updated++;
        continue;
      }
      batch.update(
        dRef,
        omitUndefined({
          ...basePayload,
          updatedAt: now,
          officeEnteredBy: ACTOR_LABEL,
          officeEnteredAt: now,
        } as Record<string, unknown>) as DocumentData,
      );
      totals.updated++;
    } else {
      if (dryRun) {
        totals.created++;
        continue;
      }
      const parsed = DailyTimesheetSchema.parse({
        ...basePayload,
        id,
        createdAt: now,
        updatedAt: now,
        officeEnteredBy: ACTOR_LABEL,
        officeEnteredAt: now,
      });
      batch.set(dRef, omitUndefined({ ...parsed } as Record<string, unknown>) as DocumentData);
      totals.created++;
    }

    batchCount++;
    if (batchCount >= BATCH_LIMIT) await flush();
  }

  await flush();
}

async function main(): Promise<void> {
  const dryRun = hasFlag('dry-run');
  const onlyId = argValue('assignment');

  initFirebaseAdmin();
  const projectIdResolved = resolveFirebaseProjectId();
  const db = getFirestore();
  await assertFirestoreReachable(db, projectIdResolved);

  const totals: Totals = { created: 0, updated: 0, skipped: 0 };

  if (onlyId) {
    const snap = await db.collection('mobilizations').doc(onlyId).get();
    if (!snap.exists) {
      console.error(`ไม่พบ mobilizations/${onlyId}`);
      process.exit(1);
    }
    const assignment = { id: snap.id, ...(snap.data() as object) } as Assignment;
    await syncOneMobilization(db, assignment, dryRun, totals);
  } else {
    await paginateCollection(db, 'mobilizations', async (docs) => {
      for (const d of docs) {
        try {
          const assignment = { id: d.id, ...(d.data() as object) } as Assignment;
          await syncOneMobilization(db, assignment, dryRun, totals);
        } catch (e) {
          console.error(`[po-active-auto-daily] skip mob ${d.id}:`, e instanceof Error ? e.message : e);
        }
      }
    });
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        assignmentFilter: onlyId ?? 'ALL',
        created: totals.created,
        updated: totals.updated,
        skipped: totals.skipped,
      },
      null,
      2,
    ),
  );
  if (dryRun) console.log('(dry-run: ไม่ได้ commit batch)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
