'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { normalizeIncomeSegments } from '@/lib/payroll/payslip-model';
import type { PayrollBatchLine } from '@/lib/types';

/**
 * โหลดชื่อลูกค้า (หรือรหัส PO) ต่อ purchaseOrderId — ใช้แทน Firestore id บนสลิป
 */
export function usePoPartyLabels(
  lines: readonly Pick<PayrollBatchLine, 'incomeSegments'>[] | null | undefined,
  extraPoIds?: readonly string[],
) {
  const firestore = useFirestore();
  const [metaById, setMetaById] = useState<Map<string, { poCode: string; customerName?: string }>>(
    () => new Map(),
  );

  const poIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const line of lines ?? []) {
      for (const seg of normalizeIncomeSegments(line.incomeSegments)) {
        const id = String(seg.purchaseOrderId || '').trim();
        if (id) ids.add(id);
      }
    }
    for (const id of extraPoIds ?? []) {
      const t = String(id || '').trim();
      if (t) ids.add(t);
    }
    return [...ids].sort().join(',');
  }, [lines, extraPoIds]);

  useEffect(() => {
    if (!firestore || !poIdsKey) {
      setMetaById(new Map());
      return;
    }
    const ids = poIdsKey.split(',').filter(Boolean);
    let cancelled = false;
    void (async () => {
      const m = new Map<string, { poCode: string; customerName?: string }>();
      await Promise.all(
        ids.map(async (pid) => {
          try {
            const poSnap = await getDoc(doc(firestore, 'purchase_orders', pid));
            if (!poSnap.exists()) {
              m.set(pid, { poCode: pid });
              return;
            }
            const po = poSnap.data() as { poCode?: string; customerId?: string };
            const poCode = (po.poCode || '').trim() || pid;
            let customerName: string | undefined;
            const cid = (po.customerId || '').trim();
            if (cid) {
              const cSnap = await getDoc(doc(firestore, 'customers', cid));
              if (cSnap.exists()) {
                customerName = String((cSnap.data() as { name?: string }).name || '').trim() || undefined;
              }
            }
            m.set(pid, { poCode, customerName });
          } catch {
            m.set(pid, { poCode: pid });
          }
        }),
      );
      if (!cancelled) setMetaById(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, poIdsKey]);

  const poPartyLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const line of lines ?? []) {
      for (const seg of normalizeIncomeSegments(line.incomeSegments)) {
        const id = String(seg.purchaseOrderId || '').trim();
        if (!id) continue;
        const cust = seg.customerNameSnapshot?.trim();
        const po = seg.poCodeSnapshot?.trim();
        if (cust) m.set(id, cust);
        else if (po && !m.has(id)) m.set(id, po);
      }
    }
    for (const [id, meta] of metaById) {
      if (meta.customerName?.trim()) m.set(id, meta.customerName.trim());
      else if (!m.has(id) && meta.poCode?.trim()) m.set(id, meta.poCode.trim());
    }
    return m;
  }, [lines, metaById]);

  return poPartyLabelById;
}
