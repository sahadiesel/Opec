'use client';

import { useMemo } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import type {
  CashAdvanceRequest,
  OfficePayrollRun,
  PayrollBatch,
  PurchaseVendorBill,
  User,
} from '@/lib/types';
import { canSeeAccountingPillarUi } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';

const VENDOR_BILL_PENDING_STATUSES = ['SUBMITTED', 'PARTIALLY_PAID'] as const;

/** ใบรับวางบิลที่ยังมีงวดรอจ่าย — ใบที่ยกเลิกหรือจ่ายครบทุกงวดไม่นับ */
function vendorBillHasUnpaidInstallment(bill: PurchaseVendorBill): boolean {
  if (bill.cancellationSettlement) return false;
  if (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') return false;
  const plan = bill.paymentInstallments;
  if (plan && plan.length > 0) {
    return plan.some((row) => row.payStatus === 'PENDING' && (Number(row.amountInclVat) || 0) > 0.005);
  }
  return true;
}

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

  const vendorBillQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(
      collection(firestore, 'purchase_vendor_bills'),
      where('status', 'in', [...VENDOR_BILL_PENDING_STATUSES]),
      limit(40),
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
  const { data: vendorBillsPending } = useCollection<PurchaseVendorBill>(vendorBillQ as any);
  const { data: rentalPayablesPending } = useCollection<{ id: string }>(rentalPayableQ as any);
  const { data: cashAdvancesPending } = useCollection<CashAdvanceRequest>(cashAdvanceQ as any);

  const officePayrollAlert = (officePending?.length ?? 0) > 0;
  const workerPayrollAlert = (workerPending?.length ?? 0) > 0;
  const cashAdvanceAlert = (cashAdvancesPending?.length ?? 0) > 0;
  const vendorBillAlert =
    (vendorBillsPending ?? []).some(vendorBillHasUnpaidInstallment) ||
    (rentalPayablesPending?.length ?? 0) > 0;

  const payrollAlert =
    officePayrollAlert || workerPayrollAlert || cashAdvanceAlert || vendorBillAlert;

  /** ไฟที่ระบบเจ้าหนี้ = มีงวดรอจ่ายจริง ไม่ใช้ยอดเจ้าหนี้ที่ค้างจากใบที่ยกเลิกแล้ว */
  const apAlert = vendorBillAlert;

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
