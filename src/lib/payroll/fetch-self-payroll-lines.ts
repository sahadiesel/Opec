'use client';

import { useCallback, useEffect, useState } from 'react';
import { collection, collectionGroup, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type {
  OfficePayrollLine,
  OfficeStaffPayrollLineRef,
  PayrollBatchLine,
  PayrollRunStatus,
} from '@/lib/types';
import type {
  OfficeStaffSelfPayrollLineIndex,
  WorkerSelfPayrollLineIndex,
} from '@/lib/payroll/self-payroll-line-index';
import { OFFICE_RUN_STATUSES_WITH_SAVED_LINES } from '@/lib/payroll/office-month-staff-aggregate';
import { standardOfficePayrollLineDocId } from '@/lib/payroll/office-payroll-line-ids';

const OFFICE_LINE_RUN_COLLECTIONS = ['office_payroll_runs', 'executive_payroll_runs'] as const;

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

type SelfPayrollApiResult = {
  lines: OfficePayrollLine[] | PayrollBatchLine[];
  error?: string;
};

async function verifyLinkedActiveSubject(
  firestore: Firestore,
  col: 'office_staff' | 'workers',
  subjectId: string,
  linkedUserId: string,
): Promise<boolean> {
  const snap = await getDoc(doc(firestore, col, subjectId));
  if (!snap.exists()) return false;
  const data = snap.data() as { linkedUserId?: string; status?: string };
  const linked = data.linkedUserId?.trim();
  if (!linked || linked !== linkedUserId) return false;
  if (col === 'office_staff' && data.status !== 'ACTIVE' && data.status !== 'active') return false;
  return true;
}

async function fetchSelfPayrollLinesViaApi(
  kind: 'office_staff' | 'worker',
  subjectId: string,
): Promise<SelfPayrollApiResult | null> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const token = await user.getIdToken();
    const qs = new URLSearchParams({ kind, subjectId });
    const res = await fetch(`/api/my-profile/self-payroll-lines?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { lines?: unknown[]; error?: string };
    if (!res.ok) {
      return { lines: [], error: body.error || `HTTP ${res.status}` };
    }
    return {
      lines: Array.isArray(body.lines) ? (body.lines as OfficePayrollLine[] | PayrollBatchLine[]) : [],
    };
  } catch (e: unknown) {
    return { lines: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchOfficeStaffSelfPayrollIndex(
  firestore: Firestore,
  staffId: string,
  maxLines: number,
): Promise<OfficePayrollLine[]> {
  const snap = await getDocs(collection(firestore, 'office_staff', staffId, 'self_payroll_lines'));
  return snap.docs
    .map((d) => (d.data() as OfficeStaffSelfPayrollLineIndex).line)
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, maxLines);
}

async function fetchOfficeLinesByPayrollRefs(
  firestore: Firestore,
  refs: OfficeStaffPayrollLineRef[],
  maxLines: number,
): Promise<OfficePayrollLine[]> {
  const out: OfficePayrollLine[] = [];
  for (const ref of refs.slice(0, maxLines)) {
    try {
      const snap = await getDoc(
        doc(firestore, ref.runCollection, ref.runId, 'lines', ref.lineId),
      );
      if (!snap.exists()) continue;
      out.push({
        id: snap.id,
        officePayrollRunId: ref.runId,
        ...(snap.data() as object),
      } as OfficePayrollLine);
    } catch {
      /* permission or missing */
    }
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function fetchWorkerSelfPayrollIndex(
  firestore: Firestore,
  workerId: string,
  maxLines: number,
): Promise<PayrollBatchLine[]> {
  const snap = await getDocs(collection(firestore, 'workers', workerId, 'self_payroll_lines'));
  return snap.docs
    .map((d) => (d.data() as WorkerSelfPayrollLineIndex).line)
    .filter(Boolean)
    .sort((a, b) => (b.periodEndDate || '').localeCompare(a.periodEndDate || ''))
    .slice(0, maxLines);
}

async function fetchOfficeLinesByDeterministicLineGet(
  firestore: Firestore,
  staffId: string,
  staffCode: string,
): Promise<OfficePayrollLine[]> {
  const out: OfficePayrollLine[] = [];
  let runSnap;
  try {
    runSnap = await getDocs(collection(firestore, 'office_payroll_runs'));
  } catch {
    return [];
  }

  for (const runDoc of runSnap.docs) {
    const run = runDoc.data() as { status?: PayrollRunStatus };
    const st = run.status;
    if (st && !OFFICE_RUN_STATUSES_WITH_SAVED_LINES.includes(st)) continue;

    const lineId = standardOfficePayrollLineDocId(staffCode, runDoc.id);
    try {
      const lineSnap = await getDoc(
        doc(firestore, 'office_payroll_runs', runDoc.id, 'lines', lineId),
      );
      if (!lineSnap.exists()) continue;
      const data = lineSnap.data() as OfficePayrollLine;
      if (data.staffId && data.staffId !== staffId) continue;
      out.push({
        id: lineSnap.id,
        officePayrollRunId: runDoc.id,
        ...data,
      });
    } catch {
      /* permission or missing line in this run */
    }
  }

  return out;
}

async function fetchLinesByStaffIdCollectionGroup(
  firestore: Firestore,
  staffId: string,
): Promise<OfficePayrollLine[]> {
  try {
    const snap = await getDocs(
      query(collectionGroup(firestore, 'lines'), where('staffId', '==', staffId)),
    );
    return snap.docs
      .map((d) => {
        const data = d.data() as OfficePayrollLine;
        const path = d.ref.path;
        const officeRunId = path.match(/office_payroll_runs\/([^/]+)\/lines\//)?.[1];
        const execRunId = path.match(/executive_payroll_runs\/([^/]+)\/lines\//)?.[1];
        const runId = data.officePayrollRunId || officeRunId || execRunId;
        if (!runId && !officeRunId && !execRunId) return null;
        return {
          id: d.id,
          officePayrollRunId: runId,
          ...data,
        } as OfficePayrollLine;
      })
      .filter((row): row is OfficePayrollLine => row != null);
  } catch {
    return [];
  }
}

async function fetchLinesByWorkerIdCollectionGroup(
  firestore: Firestore,
  workerId: string,
): Promise<PayrollBatchLine[]> {
  try {
    const snap = await getDocs(
      query(collectionGroup(firestore, 'lines'), where('workerId', '==', workerId)),
    );
    return snap.docs.map((d) => {
      const data = d.data() as PayrollBatchLine;
      const batchId = d.ref.path.match(/payroll_batches\/([^/]+)\/lines\//)?.[1];
      return {
        id: d.id,
        payrollBatchId: data.payrollBatchId || batchId,
        ...data,
      } as PayrollBatchLine;
    });
  } catch {
    return [];
  }
}

async function fetchLinesBySubjectLinkedUserId(
  firestore: Firestore,
  linkedUserId: string,
  filter: { staffId?: string; workerId?: string },
): Promise<Record<string, unknown>[]> {
  try {
    const snap = await getDocs(
      query(collectionGroup(firestore, 'lines'), where('subjectLinkedUserId', '==', linkedUserId)),
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as object) }))
      .filter((row) => {
        if (filter.staffId && row.staffId !== filter.staffId) return false;
        if (filter.workerId && row.workerId !== filter.workerId) return false;
        return true;
      });
  } catch {
    return [];
  }
}

async function fetchOfficeStaffPayrollLinesPathScan(
  firestore: Firestore,
  staffId: string,
): Promise<OfficePayrollLine[]> {
  const out: OfficePayrollLine[] = [];
  for (const runCol of OFFICE_LINE_RUN_COLLECTIONS) {
    const runSnap = await getDocs(collection(firestore, runCol));
    for (const runDoc of runSnap.docs) {
      const run = runDoc.data() as { status?: PayrollRunStatus };
      if (runCol === 'office_payroll_runs') {
        const st = run.status;
        if (st && !OFFICE_RUN_STATUSES_WITH_SAVED_LINES.includes(st)) continue;
      }
      const lineSnap = await getDocs(
        query(collection(firestore, runCol, runDoc.id, 'lines'), where('staffId', '==', staffId)),
      );
      for (const lineDoc of lineSnap.docs) {
        out.push({
          id: lineDoc.id,
          officePayrollRunId: runDoc.id,
          ...(lineDoc.data() as object),
        } as OfficePayrollLine);
      }
    }
  }
  return out;
}

async function fetchSelfProfileOfficeLines(
  firestore: Firestore,
  staffId: string,
  linkedUserId: string,
  maxLines: number,
): Promise<{ lines: OfficePayrollLine[]; error?: string }> {
  let staffCode: string | undefined;
  let payrollLineRefs: OfficeStaffPayrollLineRef[] | undefined;

  try {
    const staffSnap = await getDoc(doc(firestore, 'office_staff', staffId));
    if (staffSnap.exists()) {
      const staffData = staffSnap.data() as {
        staffCode?: string;
        payrollLineRefs?: OfficeStaffPayrollLineRef[];
      };
      staffCode = staffData.staffCode?.trim() || undefined;
      payrollLineRefs = staffData.payrollLineRefs;
    }
  } catch {
    /* ignore */
  }

  try {
    const indexed = await fetchOfficeStaffSelfPayrollIndex(firestore, staffId, maxLines);
    if (indexed.length > 0) return { lines: indexed };
  } catch {
    /* rules/index not ready */
  }

  if (staffCode) {
    const viaDirectGet = await fetchOfficeLinesByDeterministicLineGet(firestore, staffId, staffCode);
    if (viaDirectGet.length > 0) {
      return {
        lines: viaDirectGet
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .slice(0, maxLines),
      };
    }
  }

  const byStaffId = await fetchLinesByStaffIdCollectionGroup(firestore, staffId);
  if (byStaffId.length > 0) {
    return {
      lines: byStaffId
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, maxLines),
    };
  }

  if (payrollLineRefs?.length) {
    try {
      const viaRefs = await fetchOfficeLinesByPayrollRefs(firestore, payrollLineRefs, maxLines);
      if (viaRefs.length > 0) return { lines: viaRefs };
    } catch {
      /* ignore */
    }
  }

  const grouped = await fetchLinesBySubjectLinkedUserId(firestore, linkedUserId, { staffId });
  if (grouped.length > 0) {
    return {
      lines: grouped
        .map((row) => row as OfficePayrollLine)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, maxLines),
    };
  }

  try {
    const scanned = await fetchOfficeStaffPayrollLinesPathScan(firestore, staffId);
    if (scanned.length > 0) {
      return {
        lines: scanned.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, maxLines),
      };
    }
  } catch {
    /* payroll officer only */
  }

  const api = await fetchSelfPayrollLinesViaApi('office_staff', staffId);
  if (api?.lines.length) {
    return {
      lines: (api.lines as OfficePayrollLine[])
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, maxLines),
    };
  }

  try {
    const indexedAfterApi = await fetchOfficeStaffSelfPayrollIndex(firestore, staffId, maxLines);
    if (indexedAfterApi.length > 0) return { lines: indexedAfterApi };
  } catch {
    /* ignore */
  }

  const apiErr = api?.error;
  const friendlyApiErr =
    apiErr && /default credentials|credential/i.test(apiErr)
      ? undefined
      : apiErr;

  return {
    lines: [],
    error: friendlyApiErr,
  };
}

/**
 * My Profile: self_payroll_lines → payrollLineRefs (get) → collectionGroup → Admin API (fallback)
 */
export async function fetchOfficeStaffPayrollLines(
  firestore: Firestore,
  staffId: string,
  options?: { maxLines?: number; linkedUserId?: string | null },
): Promise<OfficePayrollLine[]> {
  const maxLines = options?.maxLines ?? 100;
  if (!staffId.trim()) return [];

  if (options?.linkedUserId) {
    const ok = await verifyLinkedActiveSubject(firestore, 'office_staff', staffId, options.linkedUserId);
    if (!ok) return [];
    const result = await fetchSelfProfileOfficeLines(firestore, staffId, options.linkedUserId, maxLines);
    return result.lines;
  }

  const out = await fetchOfficeStaffPayrollLinesPathScan(firestore, staffId);
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, maxLines);
}

async function fetchWorkerPayrollLinesPathScan(
  firestore: Firestore,
  workerId: string,
): Promise<PayrollBatchLine[]> {
  const out: PayrollBatchLine[] = [];
  const batchSnap = await getDocs(collection(firestore, 'payroll_batches'));
  for (const batchDoc of batchSnap.docs) {
    const batch = batchDoc.data() as { status?: string };
    if (batch.status && !WORKER_BATCH_STATUSES_WITH_LINES.has(batch.status)) continue;
    const lineSnap = await getDocs(
      query(
        collection(firestore, 'payroll_batches', batchDoc.id, 'lines'),
        where('workerId', '==', workerId),
      ),
    );
    for (const lineDoc of lineSnap.docs) {
      out.push({
        id: lineDoc.id,
        payrollBatchId: batchDoc.id,
        ...(lineDoc.data() as object),
      } as PayrollBatchLine);
    }
  }
  return out;
}

async function fetchSelfProfileWorkerLines(
  firestore: Firestore,
  workerId: string,
  linkedUserId: string,
  maxLines: number,
): Promise<PayrollBatchLine[]> {
  try {
    const indexed = await fetchWorkerSelfPayrollIndex(firestore, workerId, maxLines);
    if (indexed.length > 0) return indexed;
  } catch {
    /* ignore */
  }

  const byWorkerId = await fetchLinesByWorkerIdCollectionGroup(firestore, workerId);
  if (byWorkerId.length > 0) {
    return byWorkerId
      .sort((a, b) => (b.periodEndDate || '').localeCompare(a.periodEndDate || ''))
      .slice(0, maxLines);
  }

  const grouped = await fetchLinesBySubjectLinkedUserId(firestore, linkedUserId, { workerId });
  if (grouped.length > 0) {
    return grouped
      .map((row) => row as PayrollBatchLine)
      .sort((a, b) => (b.periodEndDate || '').localeCompare(a.periodEndDate || ''))
      .slice(0, maxLines);
  }

  try {
    const scanned = await fetchWorkerPayrollLinesPathScan(firestore, workerId);
    if (scanned.length > 0) {
      return scanned
        .sort((a, b) => (b.periodEndDate || '').localeCompare(a.periodEndDate || ''))
        .slice(0, maxLines);
    }
  } catch {
    /* payroll officer only */
  }

  const api = await fetchSelfPayrollLinesViaApi('worker', workerId);
  if (api?.lines.length) {
    return (api.lines as PayrollBatchLine[])
      .sort((a, b) => (b.periodEndDate || '').localeCompare(a.periodEndDate || ''))
      .slice(0, maxLines);
  }

  return [];
}

export async function fetchWorkerPayrollLines(
  firestore: Firestore,
  workerId: string,
  options?: { maxLines?: number; linkedUserId?: string | null },
): Promise<PayrollBatchLine[]> {
  const maxLines = options?.maxLines ?? 100;
  if (!workerId.trim()) return [];

  if (options?.linkedUserId) {
    const ok = await verifyLinkedActiveSubject(firestore, 'workers', workerId, options.linkedUserId);
    if (!ok) return [];
    return fetchSelfProfileWorkerLines(firestore, workerId, options.linkedUserId, maxLines);
  }

  const out = await fetchWorkerPayrollLinesPathScan(firestore, workerId);
  return out.sort((a, b) => (b.periodEndDate || '').localeCompare(a.periodEndDate || '')).slice(0, maxLines);
}

export function useOfficeStaffPayrollLines(
  firestore: Firestore | null | undefined,
  staffId: string | null | undefined,
  enabled = true,
  options?: { linkedUserId?: string | null },
) {
  const linkedUserId = options?.linkedUserId ?? null;
  const [lines, setLines] = useState<OfficePayrollLine[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncHint, setSyncHint] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!firestore || !staffId?.trim() || !enabled) {
      setLines(null);
      setError(null);
      setSyncHint(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    setSyncHint(null);
    try {
      if (linkedUserId) {
        const ok = await verifyLinkedActiveSubject(firestore, 'office_staff', staffId, linkedUserId);
        if (!ok) {
          setLines([]);
          setSyncHint('ไม่พบทะเบียนที่ผูกบัญชี หรือสถานะไม่ใช่ ACTIVE — ติดต่อ HR');
          return;
        }
        const result = await fetchSelfProfileOfficeLines(firestore, staffId, linkedUserId, 100);
        setLines(result.lines);
        if (result.lines.length === 0) {
          setSyncHint(
            result.error
              ? `ยังไม่พบสลิปของคุณ (${result.error})`
              : 'ยังไม่พบสลิปของคุณ — ให้ HR/Payroll เปิดงวดจ่ายแล้วกด «อัปเดต My Profile» หรือคำนวณงวดอีกครั้ง',
          );
        }
        if (result.error && result.lines.length > 0) setError(result.error);
        return;
      }
      const rows = await fetchOfficeStaffPayrollLines(firestore, staffId);
      setLines(rows);
    } catch (e: unknown) {
      console.error('[useOfficeStaffPayrollLines]', e);
      setLines([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [firestore, staffId, enabled, linkedUserId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { lines, isLoading, error, syncHint, reload };
}

export function useWorkerPayrollLines(
  firestore: Firestore | null | undefined,
  workerId: string | null | undefined,
  enabled = true,
  options?: { linkedUserId?: string | null },
) {
  const linkedUserId = options?.linkedUserId ?? null;
  const [lines, setLines] = useState<PayrollBatchLine[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!firestore || !workerId?.trim() || !enabled) {
      setLines(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const rows = await fetchWorkerPayrollLines(firestore, workerId, { linkedUserId });
      setLines(rows);
    } catch (e: unknown) {
      console.error('[useWorkerPayrollLines]', e);
      setLines([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [firestore, workerId, enabled, linkedUserId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { lines, isLoading, error, reload };
}

export async function syncSelfOfficePayrollLines(
  staffId: string,
): Promise<{ lines: OfficePayrollLine[]; error?: string }> {
  const api = await fetchSelfPayrollLinesViaApi('office_staff', staffId);
  return {
    lines: (api?.lines as OfficePayrollLine[]) ?? [],
    error: api?.error,
  };
}
