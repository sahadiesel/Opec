import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { PayrollBatch, PayrollBatchLine, PayrollBatchStatus } from '@/lib/types';
import type { PriorPaidPayrollSlipRef } from '@/lib/payroll/payslip-model';

/** สถานะที่ถือว่าบัญชีจ่าย/ผูกจ่ายไปแล้ว — ใช้หักจากสลิปรอบหลัง */
const PRIOR_PAID_BATCH_STATUSES: ReadonlySet<PayrollBatchStatus | string> = new Set([
  'PAID',
  'PAYMENT_EXPORTED',
  'FINANCE_PREPARED',
  'LOCKED',
]);

/**
 * โหลดงวด NORMAL ใน payrollPeriodId เดียวกัน
 * - SUPPLEMENTAL: ใช้เป็นงวดปกติอ้างอิง
 * - NORMAL: โหลดงวดอื่นที่จ่ายแล้วของคนงาน (หักยอดที่ชำระไปแล้วบนสลิป)
 */
export function useNormalBatchesAndLines(
  payrollPeriodId: string | undefined | null,
  options?: {
    isSupplemental?: boolean;
    /** เมื่อเป็น NORMAL — โหลดงวดอื่นที่จ่ายแล้วเพื่อหักบนสลิป */
    includePriorPaidForNormal?: boolean;
    currentBatchId?: string | null;
    workerId?: string | null;
  },
) {
  const firestore = useFirestore();
  const isSupplemental = options?.isSupplemental === true;
  const includePriorPaid = options?.includePriorPaidForNormal === true;
  const currentBatchId = (options?.currentBatchId || '').trim();
  const workerId = (options?.workerId || '').trim();

  const [normalBatches, setNormalBatches] = useState<PayrollBatch[]>([]);
  const [normalLines, setNormalLines] = useState<PayrollBatchLine[]>([]);
  const [priorPaidRefs, setPriorPaidRefs] = useState<PriorPaidPayrollSlipRef[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const shouldLoad = !!firestore && !!payrollPeriodId && (isSupplemental || includePriorPaid);
    if (!shouldLoad) {
      setNormalBatches([]);
      setNormalLines([]);
      setPriorPaidRefs([]);
      setLoading(false);
      return;
    }

    let mounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(firestore!, 'payroll_batches'),
          where('payrollPeriodId', '==', payrollPeriodId),
        );
        const batchSnaps = await getDocs(q);
        const batches: PayrollBatch[] = [];
        batchSnaps.forEach((d) => {
          const data = d.data() as PayrollBatch;
          if (!data.batchType || data.batchType === 'NORMAL') {
            batches.push({ ...data, id: d.id });
          }
        });

        if (mounted) setNormalBatches(batches);

        const allLines: PayrollBatchLine[] = [];
        const prior: PriorPaidPayrollSlipRef[] = [];

        for (const nb of batches) {
          const lq = collection(firestore!, 'payroll_batches', nb.id, 'lines');
          const lineSnaps = await getDocs(lq);
          lineSnaps.forEach((d) => {
            const line = { id: d.id, ...d.data() } as PayrollBatchLine;
            allLines.push(line);
            if (
              includePriorPaid &&
              nb.id !== currentBatchId &&
              PRIOR_PAID_BATCH_STATUSES.has(nb.status) &&
              (!workerId || line.workerId === workerId)
            ) {
              prior.push({ line, batch: nb });
            }
          });
        }

        if (mounted) {
          setNormalLines(allLines);
          setPriorPaidRefs(prior);
        }
      } catch (err) {
        console.warn('[useNormalBatchesAndLines] failed', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void fetchData();

    return () => {
      mounted = false;
    };
  }, [firestore, payrollPeriodId, isSupplemental, includePriorPaid, currentBatchId, workerId]);

  return { normalBatches, normalLines, priorPaidRefs, loading };
}
