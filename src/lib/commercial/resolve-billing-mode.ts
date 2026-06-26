import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type { ContractBillingMode, MainContract, PurchaseOrder } from '@/lib/types';

/** PO override → สัญญาหลัก → default MONTHLY (Guangzhou / legacy) */
export async function resolveBillingMode(
  db: Firestore,
  po: Pick<PurchaseOrder, 'id' | 'contractId' | 'billingMode'>,
): Promise<ContractBillingMode> {
  if (po.billingMode === 'TRIP' || po.billingMode === 'MONTHLY') return po.billingMode;
  const contractId = String(po.contractId || '').trim();
  if (contractId) {
    const snap = await getDoc(doc(db, 'main_contracts', contractId));
    if (snap.exists()) {
      const mc = snap.data() as MainContract;
      if (mc.billingMode === 'TRIP' || mc.billingMode === 'MONTHLY') return mc.billingMode;
    }
  }
  return 'MONTHLY';
}

export function billingModeLabel(mode: ContractBillingMode | undefined): string {
  if (mode === 'TRIP') return 'รอบเดินทาง (M1→D1)';
  return 'รายเดือน (PO+เดือน)';
}
