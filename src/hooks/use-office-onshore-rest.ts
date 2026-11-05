'use client';

import { useMemo } from 'react';
import { doc } from 'firebase/firestore';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import type { PayrollPolicyRecord } from '@/lib/types';
import {
  HR_OFFICE_ONSHORE_LABOR_POLICY_ID,
  HR_WORKER_GLOBAL_LABOR_POLICY_ID,
} from '@/lib/payroll/d8/hr-statutory-policy-ids';
import {
  resolveOfficeOnshoreRestFromPolicies,
  type OfficeOnshoreLaborContext,
} from '@/lib/payroll/office-onshore-labor-policy';

/** ปฏิทินร่วมพนักงานออฟฟิศ + ลูกจ้าง Onshore (fallback ตาราง Offshore ถ้ายังไม่มีเอกสารใหม่) */
export function useOfficeOnshoreRest(): Pick<OfficeOnshoreLaborContext, 'weeklyRestPattern' | 'calendarHolidays'> {
  const firestore = useFirestore();
  const officeRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'payroll_policies', HR_OFFICE_ONSHORE_LABOR_POLICY_ID) : null),
    [firestore],
  );
  const workerRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID) : null),
    [firestore],
  );
  const { data: officeRec } = useDoc<PayrollPolicyRecord>(officeRef as any);
  const { data: workerRec } = useDoc<PayrollPolicyRecord>(workerRef as any);
  return useMemo(
    () => resolveOfficeOnshoreRestFromPolicies(officeRec ?? null, workerRec ?? null),
    [officeRec, workerRec],
  );
}
