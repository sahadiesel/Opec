import {
  collection,
  deleteField,
  doc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { recordCashbookMovementWithBalance } from '@/lib/services/cashbook-bank-movement';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import type {
  Purchase,
  PurchaseCancellationRefundMode,
  PurchaseStatus,
  User,
} from '@/lib/types';

const REQUESTABLE: PurchaseStatus[] = ['APPROVED', 'ISSUED', 'COMPLETED'];

export function canRequestPurchaseCancellation(purchase: Pick<Purchase, 'status' | 'cancellationRequestStatus'>): boolean {
  return REQUESTABLE.includes(purchase.status) && purchase.cancellationRequestStatus !== 'PENDING';
}

export function canDecidePurchaseCancellation(
  user: User | null,
  purchase: Pick<Purchase, 'cancellationRequestStatus' | 'cancellationRequestedByUid'>,
  canApprove: boolean,
): boolean {
  if (!canApprove || !user) return false;
  if (purchase.cancellationRequestStatus !== 'PENDING') return false;
  const requester = purchase.cancellationRequestedByUid?.trim();
  if (requester && requester === user.id) return false;
  return true;
}

function actorName(user: User): string {
  return String(user.displayName || user.email || user.id).trim() || user.id;
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function requestPurchaseCancellation(
  db: Firestore,
  user: User,
  purchaseId: string,
  reason: string,
): Promise<void> {
  const text = reason.trim();
  if (!text) throw new Error('กรุณาระบุเหตุผลในการขอยกเลิก');
  await updateDoc(doc(db, 'purchases', purchaseId), {
    cancellationRequestStatus: 'PENDING',
    cancellationReason: text,
    cancellationRequestedAt: Date.now(),
    cancellationRequestedByUid: user.id,
    cancellationRequestedByName: actorName(user),
    cancellationRejectReason: deleteField(),
    updatedAt: Date.now(),
  });
}

export async function rejectPurchaseCancellation(
  db: Firestore,
  user: User,
  purchaseId: string,
  reason: string,
): Promise<void> {
  const text = reason.trim();
  if (!text) throw new Error('กรุณาระบุเหตุผลที่ไม่อนุมัติการยกเลิก');
  const now = Date.now();
  await updateDoc(doc(db, 'purchases', purchaseId), {
    cancellationRequestStatus: 'REJECTED',
    cancellationRejectReason: text,
    cancellationDecidedAt: now,
    cancellationDecidedByUid: user.id,
    cancellationDecidedByName: actorName(user),
    updatedAt: now,
  });
}

export async function approvePurchaseCancellation(
  db: Firestore,
  user: User,
  purchase: Pick<Purchase, 'id' | 'purchaseNo' | 'vendorId' | 'purchaseType'>,
  mode: PurchaseCancellationRefundMode,
  approverNote: string,
): Promise<void> {
  const note = approverNote.trim();
  if (mode === 'NO_REFUND' && !note) throw new Error('กรุณาระบุเหตุผลที่ไม่ต้องรับเงินคืน');
  const now = Date.now();
  const purchaseRef = doc(db, 'purchases', purchase.id);
  const base = {
    cancellationRequestStatus: 'APPROVED' as const,
    cancellationRefundMode: mode,
    cancellationDecidedAt: now,
    cancellationDecidedByUid: user.id,
    cancellationDecidedByName: actorName(user),
    status: 'PENDING_CANCELLATION' as const,
    updatedAt: now,
  };

  if (mode === 'REFUND_REQUIRED') {
    await updateDoc(purchaseRef, {
      ...base,
      cancellationApproverNote: note || deleteField(),
    });
    return;
  }

  const { code } = await generateNextDocumentCode(db, 'purchase_vendor_bill', {
    actor: actorName(user),
  });
  const billRef = doc(collection(db, 'purchase_vendor_bills'));
  const ymd = todayYmd();
  const batch = writeBatch(db);
  batch.set(billRef, {
    receiptNo: code,
    purchaseId: purchase.id,
    purchaseNo: purchase.purchaseNo,
    purchaseType: purchase.purchaseType,
    vendorId: purchase.vendorId,
    billAmount: 0,
    billingReceivedDate: ymd,
    plannedPaymentDate: ymd,
    status: 'SUBMITTED',
    cancellationSettlement: true,
    supplierWithholdingEnabledBill: false,
    notes: `ปิดเรื่องยกเลิกใบสั่งซื้อโดยไม่รับเงินคืน — ${note}`,
    createdAt: now,
    updatedAt: now,
  });
  batch.update(purchaseRef, {
    ...base,
    cancellationApproverNote: note,
    cancellationVendorBillId: billRef.id,
  });
  await batch.commit();
}

/** รับเงินคืนจากคู่ค้า — ลง cashbook อย่างเดียว ไม่ได้ออกใบเสร็จ แล้วปิดสถานะเป็นยกเลิก */
export async function settlePurchaseCancellationRefund(
  db: Firestore,
  user: User,
  purchase: Pick<Purchase, 'id' | 'purchaseNo'>,
  params: { bankAccountId: string; amount: number },
): Promise<{ entryNo: string }> {
  const amount = roundMoney2(Number(params.amount));
  const { cashbookEntryId, entryNo } = await recordCashbookMovementWithBalance(db, user, {
    bankAccountId: params.bankAccountId,
    direction: 'IN',
    amount,
    entryDate: todayYmd(),
    description: `รับเงินคืนยกเลิกใบสั่งซื้อ ${purchase.purchaseNo} จากคู่ค้า — ไม่ออกใบเสร็จ`,
    paymentMethod: 'TRANSFER',
    entryType: 'OTHER',
    referenceType: 'OTHER',
    referenceId: purchase.id,
  });
  const now = Date.now();
  await updateDoc(doc(db, 'purchases', purchase.id), {
    status: 'CANCELLED',
    cancellationSettledAt: now,
    cancellationSettledByUid: user.id,
    cancellationSettledByName: actorName(user),
    cancellationBankAccountId: params.bankAccountId,
    cancellationReceivedAmount: amount,
    cancellationCashbookEntryId: cashbookEntryId,
    cancellationCashbookEntryNo: entryNo,
    updatedAt: now,
  });
  return { entryNo };
}

/** บัญชียืนยันใบวางบิลยอด 0 แล้วเปลี่ยนสถานะจากรอยกเลิกเป็นยกเลิก */
export async function confirmPurchaseCancellationWithoutRefund(
  db: Firestore,
  user: User,
  purchaseId: string,
  vendorBillId: string | null | undefined,
): Promise<void> {
  const now = Date.now();
  const batch = writeBatch(db);
  if (vendorBillId?.trim()) {
    batch.update(doc(db, 'purchase_vendor_bills', vendorBillId), {
      status: 'CLOSED',
      vendorBillDocumentationClosed: true,
      vendorBillDocumentationClosedAt: now,
      vendorBillDocumentationClosedByUid: user.id,
      vendorBillDocumentationClosedByName: actorName(user),
      updatedAt: now,
    });
  }
  batch.update(doc(db, 'purchases', purchaseId), {
    status: 'CANCELLED',
    cancellationSettledAt: now,
    cancellationSettledByUid: user.id,
    cancellationSettledByName: actorName(user),
    updatedAt: now,
  });
  await batch.commit();
}
