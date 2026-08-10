'use client';

import { useMemo } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import type { User } from '@/lib/types';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import {
  ATTENDANCE_CORRECTION_REQUESTS_COLLECTION,
  ATTENDANCE_OVERTIME_REQUESTS_COLLECTION,
} from '@/lib/attendance/constants';

/**
 * ไฟเตือนเมนูหลัก «อนุมัติ (Approval)» — มีคิวรออนุมัติอย่างน้อย 1 รายการในศูนย์อนุมัติ
 * (รูปแบบเดียวกับ useAccountingSidebarAlerts สำหรับรายการรอทำจ่าย)
 */
export function useApprovalSidebarAlerts(user: User | null | undefined) {
  const firestore = useFirestore();
  const enabled = useMemo(
    () =>
      !!user &&
      canViewHrApprovalSubsection(user, isSystemAdmin(user) || isSimpleAdmin(user)),
    [user],
  );

  const waveQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, 'wave_month_timesheet_reviews'),
      where('status', '==', 'pending_manager_review'),
      limit(1),
    );
  }, [firestore, enabled]);

  const poMonthQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, 'po_month_timesheet_reviews'),
      where('status', '==', 'pending_manager_review'),
      limit(1),
    );
  }, [firestore, enabled]);

  const workerBatchQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(collection(firestore, 'payroll_batches'), where('status', '==', 'HR_REVIEWED'), limit(1));
  }, [firestore, enabled]);

  const officePayrollQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(collection(firestore, 'office_payroll_runs'), where('status', '==', 'HR_REVIEW'), limit(1));
  }, [firestore, enabled]);

  const cashAdvanceQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, 'cash_advance_requests'),
      where('status', '==', 'PENDING_MANAGER_APPROVAL'),
      limit(1),
    );
  }, [firestore, enabled]);

  const purchaseQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(collection(firestore, 'purchases'), where('status', '==', 'PENDING_APPROVAL'), limit(1));
  }, [firestore, enabled]);

  const purchaseRequestQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(collection(firestore, 'purchase_requests'), where('status', '==', 'PENDING_APPROVAL'), limit(1));
  }, [firestore, enabled]);

  const attendanceCorrectionQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, ATTENDANCE_CORRECTION_REQUESTS_COLLECTION),
      where('status', '==', 'PENDING_MANAGER_APPROVAL'),
      limit(1),
    );
  }, [firestore, enabled]);

  const overtimeQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION),
      where('status', '==', 'PENDING_MANAGER_APPROVAL'),
      limit(1),
    );
  }, [firestore, enabled]);

  const leaveQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(collection(firestore, 'leave_requests'), where('status', '==', 'SUBMITTED'), limit(1));
  }, [firestore, enabled]);

  const { data: wavePending } = useCollection(waveQ as any);
  const { data: poMonthPending } = useCollection(poMonthQ as any);
  const { data: workerBatchPending } = useCollection(workerBatchQ as any);
  const { data: officePayrollPending } = useCollection(officePayrollQ as any);
  const { data: cashAdvancePending } = useCollection(cashAdvanceQ as any);
  const { data: purchasePending } = useCollection(purchaseQ as any);
  const { data: purchaseRequestPending } = useCollection(purchaseRequestQ as any);
  const { data: attendanceCorrectionPending } = useCollection(attendanceCorrectionQ as any);
  const { data: overtimePending } = useCollection(overtimeQ as any);
  const { data: leavePending } = useCollection(leaveQ as any);

  const approvalAlert =
    (wavePending?.length ?? 0) > 0 ||
    (poMonthPending?.length ?? 0) > 0 ||
    (workerBatchPending?.length ?? 0) > 0 ||
    (officePayrollPending?.length ?? 0) > 0 ||
    (cashAdvancePending?.length ?? 0) > 0 ||
    (purchasePending?.length ?? 0) > 0 ||
    (purchaseRequestPending?.length ?? 0) > 0 ||
    (attendanceCorrectionPending?.length ?? 0) > 0 ||
    (overtimePending?.length ?? 0) > 0 ||
    (leavePending?.length ?? 0) > 0;

  return { approvalAlert, enabled };
}
