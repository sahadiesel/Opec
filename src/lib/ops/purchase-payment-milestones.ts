import type { Firestore } from 'firebase/firestore';
import { updateDoc, type DocumentReference } from 'firebase/firestore';
import type {
  Purchase,
  PurchasePaymentMilestone,
  PurchasePaymentMilestoneStatus,
  PurchaseVendorBill,
} from '@/lib/types';

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

/**
 * ส่วนของยอดก่อนภาษีมูลค่าเพิ่มของหนึ่งงวด (งวดเก็บยอดรวม VAT)
 * ใช้สัดส่วน amountBeforeTax / totalAmount — สอดคล้องกับการหัก ณ ที่จ่าย 3% ฐานก่อนภาษี
 */
export function milestoneAmountBeforeVAT(
  milestoneAmountInclVat: number,
  purchase: Pick<Purchase, 'totalAmount' | 'amountBeforeTax'>
): number {
  const total = Math.max(0, roundMoney2(Number(purchase.totalAmount) || 0));
  const before = Math.max(0, roundMoney2(Number(purchase.amountBeforeTax) || 0));
  const m = Math.max(0, roundMoney2(Number(milestoneAmountInclVat) || 0));
  if (m < 0.005) return 0;
  if (total < 0.01) return m;
  /** ไม่มียอดแยกก่อนภาษีในเอกสาร — ถือว่าทั้งงวดเป็นฐานหัก (เช่น ไม่มี VAT) */
  if (before < 0.01) return m;
  return roundMoney2((m * before) / total);
}

/** อัตราหัก ณ ที่จ่ายที่ใช้กับใบวางบิลนี้ — override บนบิล (บัญชีแก้) หรือจาก PO */
export function effectiveVendorBillWhtRatePercent(
  bill: Pick<PurchaseVendorBill, 'supplierWithholdingRatePercentBill'>,
  purchase: Pick<Purchase, 'supplierWithholdingRatePercent'>,
): number {
  const o = bill.supplierWithholdingRatePercentBill;
  if (o !== undefined && o !== null && Number.isFinite(Number(o))) {
    return Math.max(0, Number(o));
  }
  return Math.max(0, Number(purchase.supplierWithholdingRatePercent) || 0);
}

/** หัก ณ ที่จ่ายผู้รับเงิน: % จากฐานก่อน VAT ของงวด — สุทธิจ่าย = ยอดงวดรวม VAT − หัก ณ ที่จ่าย */
export function supplierWithholdingOnMilestone(
  milestoneAmountInclVat: number,
  ratePercent: number,
  purchase: Pick<Purchase, 'totalAmount' | 'amountBeforeTax'>
): { wht: number; netPaid: number; baseBeforeVat: number } {
  const rate = Math.max(0, Number(ratePercent) || 0);
  const gross = roundMoney2(Number(milestoneAmountInclVat) || 0);
  const baseBeforeVat = milestoneAmountBeforeVAT(milestoneAmountInclVat, purchase);
  const wht = rate > 0.005 ? roundMoney2((baseBeforeVat * rate) / 100) : 0;
  return { wht, netPaid: roundMoney2(gross - wht), baseBeforeVat };
}
