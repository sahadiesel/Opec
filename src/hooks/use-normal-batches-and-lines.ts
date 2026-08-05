'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { PayrollBatch, PayrollBatchLine, PayrollBatchStatus } from '@/lib/types';
import {
  payrollBatchChronologyMs,
  type PriorPaidPayrollSlipRef,
} from '@/lib/payroll/payslip-model';

/** งวดที่จ่ายจริงแล้ว — ใช้หักจากสลิปชุดหลัง (ไม่นับแค่เตรียมจ่าย) */
const PRIOR_PAID_BATCH_STATUSES: ReadonlySet<PayrollBatchStatus | string> = new Set([
  'PAID',
  'LOCKED',
]);

/**
 * โหลดงวด NORMAL ใน payrollPeriodId เดียวกัน
 * - SUPPLEMENTAL: ใช้เป็นงวดปกติอ้างอิง
 * - NORMAL: โหลดงวดอื่นที่จ่ายแล้วของคนงาน (หักยอดที่ชำระไปแล้วบนสลิปชุดหลัง)
 * - หักเฉพาะงวดที่เกิด/จ่ายก่อนงวดปัจจุบันเท่านั้น
 */
export function useNormalBatchesAndLines(
  payrollPeriodId: string | undefined | null,
  options?: {
    isSupplemental?: boolean;
    /** เมื่อเป็น NORMAL — โหลดงวดอื่นที่จ่ายแล้วเพื่อหักบนสลิป */
    includePriorPaidForNormal?: boolean;
    currentBatchId?: string | null;
    /** สถานะงวดปัจจุบัน (ไม่ใช้แช่แข็ง prior ที่นี่แล้ว — กรองตามลำดับเวลา) */
    currentBatchStatus?: PayrollBatchStatus | string | null;
    /** createdAt / financePreparedAt ของงวดปัจจุบัน — กรองงวดก่อนหน้า */
    currentBatchChronologyMs?: number | null;
    workerId?: string | null;
  },
) {
  const firestore = useFirestore();
  const isSupplemental = options?.isSupplemental === true;
  const includePriorPaid = options?.includePriorPaidForNormal === true;
  const currentBatchId = (options?.currentBatchId || '').trim();
  const currentBatchChronologyMs = options?.currentBatchChronologyMs ?? null;
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
        const currentMs =
          currentBatchChronologyMs != null && Number.isFinite(currentBatchChronologyMs)
            ? Number(currentBatchChronologyMs)
            : null;

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
              const priorMs = payrollBatchChronologyMs(nb);
              /** หักเฉพาะงวดที่มาก่อนงวดปัจจุบัน — ไม่หักงวดที่สร้าง/จ่ายทีหลังย้อนเข้าสลิปเก่า */
              if (currentMs != null && priorMs > 0 && priorMs >= currentMs) return;
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
  }, [
    firestore,
    payrollPeriodId,
    isSupplemental,
    includePriorPaid,
    currentBatchId,
    currentBatchChronologyMs,
    workerId,
  ]);

  return { normalBatches, normalLines, priorPaidRefs, loading };
}
