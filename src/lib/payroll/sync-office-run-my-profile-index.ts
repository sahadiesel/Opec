import {
  doc,
  getDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { OfficePayrollLine, OfficeStaff, OfficeStaffPayrollLineRef } from '@/lib/types';
import {
  buildOfficeStaffSelfPayrollLineIndex,
  normalizeOfficeStaffPayrollLineRef,
  officeStaffSelfPayrollLineIndexRef,
  sanitizeOfficeStaffPayrollLineRefs,
} from '@/lib/payroll/self-payroll-line-index';
import { stripUndefinedForFirestore } from '@/lib/firestore/strip-undefined-for-firestore';

const BATCH_LIMIT = 400;

/**
 * เขียน index สลิป My Profile สำหรับทุกบรรทัดในงวด — เรียกจากหน้า Office Payroll (payroll officer / rs0)
 * ทำให้พนักงานอ่าน `office_staff/{id}/self_payroll_lines` ได้โดยไม่ต้องใช้ Admin API
 */
export async function syncOfficeRunMyProfileIndex(
  firestore: Firestore,
  runId: string,
  lines: OfficePayrollLine[],
  runCollection: OfficeStaffPayrollLineRef['runCollection'] = 'office_payroll_runs',
  runPayrollMonth?: string,
): Promise<{ synced: number; skipped: number }> {
  let synced = 0;
  let skipped = 0;
  let batch = writeBatch(firestore);
  let ops = 0;

  const refsByStaff = new Map<string, OfficeStaffPayrollLineRef[]>();

  const flush = async () => {
    if (ops <= 0) return;
    await batch.commit();
    batch = writeBatch(firestore);
    ops = 0;
  };

  const monthFallback = (runPayrollMonth || '').trim() || undefined;

  for (const line of lines) {
    if (!line.staffId?.trim() || !line.id) {
      skipped++;
      continue;
    }

    const staffSnap = await getDoc(doc(firestore, 'office_staff', line.staffId));
    if (!staffSnap.exists()) {
      skipped++;
      continue;
    }
    const staff = { id: staffSnap.id, ...(staffSnap.data() as object) } as OfficeStaff;
    const linked = staff.linkedUserId?.trim();
    if (!linked || staff.status !== 'ACTIVE') {
      skipped++;
      continue;
    }

    const linePayrollMonth = (line.payrollMonth || monthFallback || '').trim() || undefined;
    const fullLine: OfficePayrollLine = {
      ...line,
      id: line.id,
      officePayrollRunId: line.officePayrollRunId || runId,
      payrollMonth: linePayrollMonth,
      subjectLinkedUserId: linked,
    };

    batch.set(
      officeStaffSelfPayrollLineIndexRef(firestore, line.staffId, line.id),
      buildOfficeStaffSelfPayrollLineIndex(fullLine),
    );
    ops++;

    batch.update(
      doc(firestore, runCollection, runId, 'lines', line.id),
      stripUndefinedForFirestore({ subjectLinkedUserId: linked }),
    );
    ops++;

    const ref = normalizeOfficeStaffPayrollLineRef(
      {
        runCollection,
        runId,
        lineId: line.id,
        payrollMonth: linePayrollMonth,
        updatedAt: fullLine.updatedAt || Date.now(),
      },
      monthFallback,
    );
    const prev = refsByStaff.get(line.staffId) ?? [];
    refsByStaff.set(
      line.staffId,
      [ref, ...prev.filter((r) => r.runId !== runId || r.lineId !== line.id)].slice(0, 120),
    );

    synced++;
    if (ops >= BATCH_LIMIT - 2) await flush();
  }

  for (const [staffId, newRefs] of refsByStaff) {
    const staffSnap = await getDoc(doc(firestore, 'office_staff', staffId));
    const existing = (staffSnap.data() as OfficeStaff | undefined)?.payrollLineRefs ?? [];
    const merged = sanitizeOfficeStaffPayrollLineRefs([
      ...newRefs,
      ...existing.filter((r) => !newRefs.some((m) => m.runId === r.runId && m.lineId === r.lineId)),
    ]);
    merged.sort((a, b) => b.updatedAt - a.updatedAt);
    batch.set(
      doc(firestore, 'office_staff', staffId),
      stripUndefinedForFirestore({ payrollLineRefs: merged.slice(0, 120) }),
      { merge: true },
    );
    ops++;
    if (ops >= BATCH_LIMIT) await flush();
  }

  await flush();
  return { synced, skipped };
}

/** ตรวจว่าบรรทัดใดยังไม่มี subjectLinkedUserId (ควร sync index) */
export function officeRunNeedsMyProfileIndexSync(lines: OfficePayrollLine[] | null | undefined): boolean {
  if (!lines?.length) return false;
  return lines.some((l) => !l.subjectLinkedUserId?.trim());
}
