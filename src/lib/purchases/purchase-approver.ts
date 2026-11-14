import type { Purchase, PurchaseRequest } from '@/lib/types';

export type PurchaseOpsApprover = {
  /** ว่างได้ในรายการเก่าที่เก็บเฉพาะชื่อ */
  uid: string;
  name: string;
  decidedAt?: number;
};

type PurchaseApprovalFields = Pick<
  Purchase,
  | 'purchaseRequestId'
  | 'approvalDecisionByUid'
  | 'approvalDecisionByName'
  | 'approvalDecidedAt'
  | 'poConfirmedAt'
>;

type LinkedPrApproval = Pick<PurchaseRequest, 'status'> &
  Partial<Pick<PurchaseRequest, 'decidedByUid' | 'decidedByName' | 'decidedAt'>>;

/** PR ผ่านการอนุมัติจากผู้จัดการแล้ว — `PO_ISSUED` คือ PR ที่อนุมัติแล้วและออก PO ไปแล้ว */
export function isPurchaseRequestApproved(
  pr: Pick<PurchaseRequest, 'status'> | null | undefined,
): boolean {
  return pr?.status === 'APPROVED' || pr?.status === 'PO_ISSUED';
}

/**
 * ผู้อนุมัติทางธุรกิจของใบสั่งซื้อ
 *
 * - PO อ้าง PR: ผู้จัดการที่อนุมัติ PR เท่านั้น — ผู้ที่กด「ยืนยัน PO」เป็นเพียงผู้ยืนยันรายละเอียด
 *   ไม่ใช่ผู้อนุมัติ (เจ้าหน้าที่อนุมัติเอกสารของตนเองไม่ได้)
 * - PO ไม่อ้าง PR (รายการเก่า): ผู้จัดการที่ตัดสินใจบน PO
 *
 * `linkedPr` เป็น `null`/`undefined` เมื่อยังโหลดไม่เสร็จหรือไม่พบเอกสาร PR
 * กรณีนั้นใช้ค่าบน PO ได้เฉพาะ PO ที่ยืนยันด้วยขั้นตอนใหม่ (`poConfirmedAt`) ซึ่งคัดลอกผู้อนุมัติ PR มาเก็บไว้
 * — PO อ้าง PR รุ่นเก่าเก็บชื่อผู้กดยืนยัน PO ไว้ในช่องผู้อนุมัติ จึงห้ามนำมาแสดงเป็นผู้อนุมัติ
 */
export function resolvePurchaseOpsApprover(
  purchase: PurchaseApprovalFields | null | undefined,
  linkedPr: LinkedPrApproval | null | undefined,
): PurchaseOpsApprover | null {
  if (!purchase) return null;
  if (purchase.purchaseRequestId?.trim()) {
    if (linkedPr) {
      if (!isPurchaseRequestApproved(linkedPr)) return null;
      const name = linkedPr.decidedByName?.trim() || '';
      const uid = linkedPr.decidedByUid?.trim() || '';
      if (!name && !uid) return null;
      return { uid, name, decidedAt: linkedPr.decidedAt };
    }
    if (purchase.poConfirmedAt == null) return null;
  }
  const name = purchase.approvalDecisionByName?.trim() || '';
  const uid = purchase.approvalDecisionByUid?.trim() || '';
  if (!name && !uid) return null;
  return { uid, name, decidedAt: purchase.approvalDecidedAt };
}
