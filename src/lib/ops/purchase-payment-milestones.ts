import type { Firestore } from 'firebase/firestore';
import { updateDoc, type DocumentReference } from 'firebase/firestore';
import type { Purchase, PurchasePaymentMilestone, PurchasePaymentMilestoneStatus } from '@/lib/types';

export function roundMoney2(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

export function milestonesSumAmount(milestones: Pick<PurchasePaymentMilestone, 'amount'>[]): number {
  return roundMoney2(milestones.reduce((s, m) => s + Number(m.amount || 0), 0));
}

/** ยอดรวมงวดตรงยอดสุทธิ PO (ทนทางค่าปัดเศษเล็กน้อย) */
export function milestonesCoverTotal(
  milestones: Pick<PurchasePaymentMilestone, 'amount'>[],
  totalAmount: number
): boolean {
  if (milestones.length === 0) return false;
  return Math.abs(milestonesSumAmount(milestones) - roundMoney2(totalAmount)) < 0.02;
}

export function allMilestonesTerminal(milestones: Pick<PurchasePaymentMilestone, 'status'>[]): boolean {
  if (milestones.length === 0) return false;
  return milestones.every((m) => m.status === 'PAID' || m.status === 'WAIVED');
}

function allowedPurchaseStatusForClosure(status: Purchase['status']): boolean {
  return status === 'APPROVED' || status === 'ISSUED' || status === 'COMPLETED';
}

/**
 * อัปเดต paymentStatus และเมื่องวดครบและยอดตรง → COMPLETED + PAID
 * เมื่อถอนการชำระจนยังไม่ครบ → ถ้าเคย COMPLETED ให้กลับ ISSUED
 */
export async function syncPurchasePaymentClosure(
  firestore: Firestore,
  purchaseRef: DocumentReference,
  purchase: Pick<Purchase, 'totalAmount' | 'status' | 'paymentStatus'>,
  milestones: PurchasePaymentMilestone[]
): Promise<void> {
  if (milestones.length === 0) return;
  if (purchase.status === 'CANCELLED' || purchase.status === 'REJECTED' || purchase.status === 'DRAFT') return;
  if (!allowedPurchaseStatusForClosure(purchase.status)) return;

  const sorted = [...milestones].sort((a, b) => a.sequence - b.sequence);
  const cover = milestonesCoverTotal(sorted, purchase.totalAmount);
  const allDone = allMilestonesTerminal(sorted);
  const anyPaid = sorted.some((m) => m.status === 'PAID');

  if (allDone && cover) {
    await updateDoc(purchaseRef, {
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      updatedAt: Date.now(),
    });
    return;
  }

  const paymentStatus = anyPaid ? 'PARTIAL' : 'UNPAID';
  if (purchase.status === 'COMPLETED') {
    await updateDoc(purchaseRef, {
      status: 'ISSUED',
      paymentStatus,
      updatedAt: Date.now(),
    });
  } else {
    await updateDoc(purchaseRef, {
      paymentStatus,
      updatedAt: Date.now(),
    });
  }
}

export function milestoneStatusLabelTh(s: PurchasePaymentMilestoneStatus): string {
  const m: Record<string, string> = {
    OPEN: 'รอชำระ',
    PAID: 'ชำระแล้ว',
    WAIVED: 'ยกเว้น',
  };
  return m[s] || s;
}
