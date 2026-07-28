'use client';

import { useMemo } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import type {
  AccountsPayable,
  CashAdvanceRequest,
  OfficePayrollRun,
  PayrollBatch,
  PurchaseVendorBill,
  User,
} from '@/lib/types';
import { canSeeAccountingPillarUi } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';

const AP_PENDING_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as const;
const VENDOR_BILL_PENDING_STATUSES = ['SUBMITTED', 'PARTIALLY_PAID'] as const;
const WORKER_PAYROLL_PENDING_STATUSES = ['FINANCE_PREPARED', 'PAYMENT_EXPORTED'] as const;

export function useAccountingSidebarAlerts(user: User | null | undefined) {
  const firestore = useFirestore();
  const enabled = useMemo(
    () => !!user && (isSystemAdmin(user) || canSeeAccountingPillarUi(user, null)),
    [user],
  );

  const workerPayrollQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, 'payroll_batches'),
      where('status', 'in', [...WORKER_PAYROLL_PENDING_STATUSES]),
      limit(1),
    );
  }, [firestore, enabled]);

  const officePayrollQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, 'office_payroll_runs'),
      where('status', '==', 'HR_APPROVED'),
      limit(1),
    );
  }, [firestore, enabled]);

  const apQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, 'accounts_payable'),
      where('status', 'in', [...AP_PENDING_STATUSES]),
      limit(8),
    );
  }, [firestore, enabled]);

  const vendorBillQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, 'purchase_vendor_bills'),
      where('status', 'in', [...VENDOR_BILL_PENDING_STATUSES]),
      limit(1),
    );
  }, [firestore, enabled]);

  const rentalPayableQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(collection(firestore, 'rental_payables'), where('status', '==', 'PENDING'), limit(1));
  }, [firestore, enabled]);

  const cashAdvanceQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, 'cash_advance_requests'),
      where('status', '==', 'PENDING_PAYMENT'),
      limit(1),
    );
  }, [firestore, enabled]);

  const { data: workerPending } = useCollection<PayrollBatch>(workerPayrollQ as any);
  const { data: officePending } = useCollection<OfficePayrollRun>(officePayrollQ as any);
  const { data: apPending } = useCollection<AccountsPayable>(apQ as any);
  const { data: vendorBillsPending } = useCollection<PurchaseVendorBill>(vendorBillQ as any);
  const { data: rentalPayablesPending } = useCollection<{ id: string }>(rentalPayableQ as any);
  const { data: cashAdvancesPending } = useCollection<CashAdvanceRequest>(cashAdvanceQ as any);

  const officePayrollAlert = (officePending?.length ?? 0) > 0;
  const workerPayrollAlert = (workerPending?.length ?? 0) > 0;
  const cashAdvanceAlert = (cashAdvancesPending?.length ?? 0) > 0;
  const vendorBillAlert =
    (vendorBillsPending?.length ?? 0) > 0 || (rentalPayablesPending?.length ?? 0) > 0;

  const payrollAlert =
    officePayrollAlert || workerPayrollAlert || cashAdvanceAlert || vendorBillAlert;

  const apAlert = useMemo(() => {
    const apItems = apPending ?? [];
    const hasApOutstanding = apItems.some((item) => (Number(item.outstandingAmount) || 0) > 0.005);
    return hasApOutstanding || vendorBillAlert;
  }, [apPending, vendorBillAlert]);

  return {
    payrollAlert,
    apAlert,
    officePayrollAlert,
    workerPayrollAlert,
    cashAdvanceAlert,
    vendorBillAlert,
    enabled,
  };
}
