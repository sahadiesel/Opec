'use client';

import { useMemo } from 'react';
import { doc } from 'firebase/firestore';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import type { PayrollPolicyRecord } from '@/lib/types';
import { HR_WORKER_GLOBAL_LABOR_POLICY_ID } from '@/lib/payroll/d8/hr-statutory-policy-ids';
import type { PayrollRestDaySchedule } from '@/lib/payroll/package-labor-cost';
import {
  workerGlobalLaborContextFromPolicy,
  workerGlobalLaborToPayrollRestSchedule,
} from '@/lib/payroll/worker-global-labor-policy';

/**
 * ปฏิทินวันหยุด + รูปแบบหยุดประจำสัปดาห์จาก HR Settings
 * ใช้แยกค่าแรงวันหยุดบนสลิปให้เหมือนกันทุกคนในงวด
 */
export function useWorkerPayrollRestSchedule(): PayrollRestDaySchedule | undefined {
  const firestore = useFirestore();
  const policyRef = useMemoFirebase(
    () =>
      firestore ? doc(firestore, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID) : null,
    [firestore],
  );
  const { data } = useDoc<PayrollPolicyRecord>(policyRef as any);
  return useMemo(() => {
    if (!data) return undefined;
    return workerGlobalLaborToPayrollRestSchedule(workerGlobalLaborContextFromPolicy(data));
  }, [data]);
}
