import type { Firestore } from 'firebase/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import type {
  PurchaseRequest,
  PurchaseType,
  Vendor,
  PrPaymentMilestoneDraft,
} from '@/lib/types';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { timestampToHtmlDateValue } from '@/lib/date-thai';

function addDaysToHtmlDateValue(ymd: string, days: number): string {
  const parts = ymd.split('-').map((x) => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return timestampToHtmlDateValue(dt.getTime());
}

export function buildMilestoneSeedRowsFromPr(
  pr: PurchaseRequest,
  purchaseDate: string,
  vendor: Vendor | undefined,
  totalAmount: number
): { label: string; amount: number; dueDate?: string }[] {
  const total = roundMoney2(totalAmount);
  const payType: PurchaseType = pr.purchasePaymentType ?? 'CREDIT';

  if (payType === 'CASH') {
    return [{ label: 'ชำระเต็มจำนวน (เงินสด)', amount: total }];
  }

  if (pr.paymentInstallmentsEnabled && pr.paymentMilestoneDrafts?.length) {
    return pr.paymentMilestoneDrafts
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((m: PrPaymentMilestoneDraft) => ({
        label: m.label,
        amount: roundMoney2(m.amount),
        dueDate: m.dueDate?.trim() || undefined,
      }));
  }

  const base = purchaseDate?.trim() || timestampToHtmlDateValue(Date.now());
  const days = Number(vendor?.creditDays) > 0 ? Number(vendor?.creditDays) : 30;
  return [
    {
      label: `ครบกำหนดตามเครดิต (${days} วัน)`,
      amount: total,
      dueDate: addDaysToHtmlDateValue(base, days),
    },
  ];
}

export type SeedPurchaseFromPrInput = {
  firestore: Firestore;
  purchaseRef: DocumentReference;
  prId: string;
  purchaseDate: string;
  vendor: Vendor | undefined;
};

/** หลังสร้างเอกสาร purchases/{id} — คัดลอกบรรทัดจาก PR + สร้างงวดชำระเริ่มต้น */
export async function seedPurchaseLinesAndMilestonesFromPr(input: SeedPurchaseFromPrInput): Promise<void> {
  const { firestore, purchaseRef, prId, purchaseDate, vendor } = input;
  const purchaseId = purchaseRef.id;

  const prSnap = await getDoc(doc(firestore, 'purchase_requests', prId));
  if (!prSnap.exists()) throw new Error('PR not found');
  const pr = { ...prSnap.data(), id: prSnap.id } as PurchaseRequest;

  const lineSnaps = await getDocs(collection(firestore, 'purchase_requests', prId, 'lines'));
  const batch = writeBatch(firestore);
  const now = Date.now();

  lineSnaps.forEach((d) => {
    const data = d.data();
    const lineRef = doc(collection(firestore, 'purchases', purchaseId, 'lines'));
    batch.set(lineRef, {
      itemDescription: data.itemDescription,
      quantity: Number(data.quantity) || 0,
      unitPrice: Number(data.unitPrice) || 0,
      amount: roundMoney2(Number(data.amount) || 0),
      storeItemId: data.storeItemId || null,
      purchaseId,
      createdAt: data.createdAt ?? now,
    });
  });

  const totalAmount = roundMoney2(Number(pr.totalAmount) || 0);
  const rows = buildMilestoneSeedRowsFromPr(pr, purchaseDate, vendor, totalAmount);

  rows.forEach((r, i) => {
    const mRef = doc(collection(firestore, 'purchases', purchaseId, 'payment_milestones'));
    const amount = roundMoney2(r.amount);
    const payload: Record<string, unknown> = {
      purchaseId,
      sequence: i + 1,
      label: r.label,
      amount,
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    };
    if (r.dueDate?.trim()) payload.dueDate = r.dueDate.trim();
    batch.set(mRef, payload);
  });

  await batch.commit();
}
