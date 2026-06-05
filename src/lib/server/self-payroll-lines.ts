import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type {
  OfficePayrollLine,
  OfficeStaffPayrollLineRef,
  PayrollBatchLine,
  PayrollRunStatus,
} from '@/lib/types';
import { OFFICE_RUN_STATUSES_WITH_SAVED_LINES } from '@/lib/payroll/office-month-staff-aggregate';
import {
  buildOfficeStaffSelfPayrollLineIndex,
  buildWorkerSelfPayrollLineIndex,
  normalizeOfficeStaffPayrollLineRef,
  sanitizeOfficeStaffPayrollLineRefs,
} from '@/lib/payroll/self-payroll-line-index';
import { stripUndefinedForFirestore } from '@/lib/firestore/strip-undefined-for-firestore';

const OFFICE_RUN_COLLECTIONS = new Set(['office_payroll_runs', 'executive_payroll_runs']);

const WORKER_BATCH_STATUSES_WITH_LINES = new Set([
  'GENERATED',
  'HR_REVIEW',
  'HR_REVIEWED',
  'HR_APPROVED',
  'FINANCE_PREPARED',
  'FINANCE_APPROVED',
  'PAID',
  'LOCKED',
]);

export type SelfPayrollSubjectKind = 'office_staff' | 'worker';

export async function verifySelfPayrollSubject(
  db: Firestore,
  uid: string,
  kind: SelfPayrollSubjectKind,
  subjectId: string,
): Promise<{ ok: true; linkedUserId: string } | { ok: false; status: number; error: string }> {
  const col = kind === 'office_staff' ? 'office_staff' : 'workers';
  const snap = await db.collection(col).doc(subjectId).get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: 'ไม่พบทะเบียนที่อ้างอิง' };
  }
  const data = snap.data() as { linkedUserId?: string; status?: string };
  const linked = typeof data.linkedUserId === 'string' ? data.linkedUserId.trim() : '';
  if (!linked || linked !== uid) {
    return { ok: false, status: 403, error: 'ทะเบียนนี้ไม่ได้ผูกกับบัญชีของคุณ' };
  }
  if (kind === 'office_staff' && data.status !== 'ACTIVE') {
    return { ok: false, status: 403, error: 'ทะเบียนพนักงานไม่ได้อยู่ในสถานะ ACTIVE' };
  }
  return { ok: true, linkedUserId: linked };
}

function resolveLineRunMeta(lineDoc: QueryDocumentSnapshot): {
  runCollection: string;
  runId: string;
} | null {
  const runRef = lineDoc.ref.parent.parent;
  if (!runRef) return null;
  const runCollection = runRef.parent.id;
  return { runCollection, runId: runRef.id };
}

async function payrollMonthForRun(
  db: Firestore,
  runCollection: string,
  runId: string,
  cache: Map<string, string | undefined>,
): Promise<string | undefined> {
  const key = `${runCollection}/${runId}`;
  if (cache.has(key)) return cache.get(key);
  const runSnap = await db.collection(runCollection).doc(runId).get();
  const pm = (runSnap.data() as { payrollMonth?: string } | undefined)?.payrollMonth?.trim() || undefined;
  cache.set(key, pm);
  return pm;
}

export async function fetchOfficeStaffPayrollLinesAdmin(
  db: Firestore,
  staffId: string,
  linkedUserId: string,
  maxLines = 100,
): Promise<OfficePayrollLine[]> {
  const snap = await db.collectionGroup('lines').where('staffId', '==', staffId).get();
  const out: OfficePayrollLine[] = [];
  const refs: OfficeStaffPayrollLineRef[] = [];
  const runMonthCache = new Map<string, string | undefined>();

  for (const lineDoc of snap.docs) {
    const meta = resolveLineRunMeta(lineDoc);
    if (!meta || !OFFICE_RUN_COLLECTIONS.has(meta.runCollection)) continue;

    if (meta.runCollection === 'office_payroll_runs') {
      const runSnap = await db.collection(meta.runCollection).doc(meta.runId).get();
      const st = (runSnap.data() as { status?: PayrollRunStatus } | undefined)?.status;
      if (st && !OFFICE_RUN_STATUSES_WITH_SAVED_LINES.includes(st)) continue;
    }

    const raw = lineDoc.data() as Record<string, unknown>;
    const runPayrollMonth = await payrollMonthForRun(db, meta.runCollection, meta.runId, runMonthCache);
    const linePayrollMonth =
      (typeof raw.payrollMonth === 'string' ? raw.payrollMonth.trim() : '') || runPayrollMonth || undefined;
    const line = {
      id: lineDoc.id,
      officePayrollRunId: meta.runId,
      payrollMonth: linePayrollMonth,
      ...(raw as object),
    } as OfficePayrollLine;

    if (!raw.subjectLinkedUserId) {
      await lineDoc.ref.update(stripUndefinedForFirestore({ subjectLinkedUserId: linkedUserId }));
    }

    await db
      .collection('office_staff')
      .doc(staffId)
      .collection('self_payroll_lines')
      .doc(lineDoc.id)
      .set(buildOfficeStaffSelfPayrollLineIndex(line));

    refs.push(
      normalizeOfficeStaffPayrollLineRef(
        {
          runCollection: meta.runCollection as OfficeStaffPayrollLineRef['runCollection'],
          runId: meta.runId,
          lineId: lineDoc.id,
          payrollMonth: linePayrollMonth,
          updatedAt: line.updatedAt || Date.now(),
        },
        runPayrollMonth,
      ),
    );
    out.push(line);
  }

  refs.sort((a, b) => b.updatedAt - a.updatedAt);
  await db.collection('office_staff').doc(staffId).set(
    stripUndefinedForFirestore({ payrollLineRefs: sanitizeOfficeStaffPayrollLineRefs(refs).slice(0, maxLines) }),
    { merge: true },
  );

  return out
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, maxLines);
}

export async function fetchWorkerPayrollLinesAdmin(
  db: Firestore,
  workerId: string,
  linkedUserId: string,
  maxLines = 100,
): Promise<PayrollBatchLine[]> {
  const snap = await db.collectionGroup('lines').where('workerId', '==', workerId).get();
  const out: PayrollBatchLine[] = [];

  for (const lineDoc of snap.docs) {
    const batchRef = lineDoc.ref.parent.parent;
    if (!batchRef || batchRef.parent.id !== 'payroll_batches') continue;

    const batchSnap = await batchRef.get();
    const batch = batchSnap.data() as { status?: string } | undefined;
    if (batch?.status && !WORKER_BATCH_STATUSES_WITH_LINES.has(batch.status)) continue;

    const raw = lineDoc.data() as Record<string, unknown>;
    const line = {
      id: lineDoc.id,
      payrollBatchId: batchRef.id,
      ...(raw as object),
    } as PayrollBatchLine;

    if (!raw.subjectLinkedUserId) {
      await lineDoc.ref.update({ subjectLinkedUserId: linkedUserId });
    }

    await db
      .collection('workers')
      .doc(workerId)
      .collection('self_payroll_lines')
      .doc(lineDoc.id)
      .set(buildWorkerSelfPayrollLineIndex(line));

    out.push(line);
  }

  return out
    .sort((a, b) => (b.periodEndDate || '').localeCompare(a.periodEndDate || ''))
    .slice(0, maxLines);
}
