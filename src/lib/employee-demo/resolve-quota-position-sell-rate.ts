import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs, query, where, limit } from 'firebase/firestore';
import { effectiveSellOffshore, effectiveSellOnshore } from '@/lib/commercial/position-rate-sell';
import type { EmployeeQuotaDocument, JobMode, PositionRate, PurchaseOrder } from '@/lib/types';

/**
 * หาราคาขายตามตำแหน่งจากสัญญาของ PO ในเอกสารโควต้า (ลำดับ PO ในเอกสาร — ใช้สัญญาแรกที่มีอัตรา active)
 */
export async function resolveSellRateForQuotaPosition(
  db: Firestore,
  quotaDoc: Pick<EmployeeQuotaDocument, 'purchaseOrderIds' | 'quotaJobMode'>,
  positionId: string,
): Promise<{
  sellRate: number;
  billingUnit: string;
  contractId: string;
  positionRateId: string;
} | null> {
  const mode: JobMode = quotaDoc.quotaJobMode;

  for (const poId of quotaDoc.purchaseOrderIds) {
    const poSnap = await getDoc(doc(db, 'purchase_orders', poId));
    if (!poSnap.exists()) continue;
    const po = { id: poSnap.id, ...poSnap.data() } as PurchaseOrder;
    const cid = po.contractId?.trim();
    if (!cid) continue;

    const ratesQ = query(
      collection(db, 'main_contracts', cid, 'position_rates'),
      where('positionId', '==', positionId),
      limit(10),
    );
    const ratesSnap = await getDocs(ratesQ);
    for (const d of ratesSnap.docs) {
      const rate = { id: d.id, ...d.data() } as PositionRate;
      if (rate.active === false) continue;
      const sell =
        mode === 'OFFSHORE' ? effectiveSellOffshore(rate) : effectiveSellOnshore(rate);
      if (!Number.isFinite(sell) || sell <= 0) continue;
      return {
        sellRate: sell,
        billingUnit: rate.billingUnit || 'daily',
        contractId: cid,
        positionRateId: rate.id,
      };
    }
  }

  return null;
}
