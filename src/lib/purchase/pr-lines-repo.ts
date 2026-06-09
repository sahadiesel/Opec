import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

export type PrLineWrite = {
  itemDescription: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  storeItemId?: string;
  storeItemCode?: string;
};

/** แทนที่บรรทัดทั้งหมดใต้ PR (ใช้ตอนบันทึกฉบับร่าง) */
export async function replacePurchaseRequestLines(
  firestore: Firestore,
  prId: string,
  lines: PrLineWrite[]
): Promise<void> {
  const col = collection(firestore, 'purchase_requests', prId, 'lines');
  const existing = await getDocs(col);
  const batch = writeBatch(firestore);
  existing.forEach((d) => batch.delete(d.ref));
  const now = Date.now();
  lines.forEach((l) => {
    const ref = doc(col);
    batch.set(ref, {
      itemDescription: l.itemDescription.trim(),
      quantity: Number(l.quantity) || 0,
      unitPrice: roundMoney2(Number(l.unitPrice) || 0),
      amount: roundMoney2(Number(l.amount) || 0),
      storeItemId: l.storeItemId || null,
      storeItemCode: l.storeItemCode || null,
      createdAt: now,
    });
  });
  await batch.commit();
}
