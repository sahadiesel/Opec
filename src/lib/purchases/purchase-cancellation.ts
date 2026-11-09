import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
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

const OPEN_VENDOR_BILL_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'PARTIALLY_PAID', 'PENDING_CANCELLATION']);

/**
 * เปลี่ยนสถานะบนใบวางบิลเดิมของ PO นี้ ไม่สร้างใบใหม่ และไม่แตะ PR
 * ใบยอด 0 ที่เคยถูกสร้างแยกไว้จะถูกลบ
 */
async function syncExistingVendorBillsForCancellation(
  db: Firestore,
  purchaseId: string,
  phase: 'PENDING_CANCELLATION' | 'CANCELLED',
  detail: {
    reason?: string | null;
    approverNote?: string | null;
    refundMode?: PurchaseCancellationRefundMode | null;
  },
): Promise<void> {
  const snap = await getDocs(
    query(collection(db, 'purchase_vendor_bills'), where('purchaseId', '==', purchaseId)),
  );
  if (snap.empty) return;
  const now = Date.now();
  const batch = writeBatch(db);
  let writes = 0;
  for (const billDoc of snap.docs) {
    const data = billDoc.data() as {
      status?: string;
      cancellationSettlement?: boolean;
      cancellationReason?: string;
      cancellationApproverNote?: string;
    };
    if (data.cancellationSettlement) {
      batch.delete(billDoc.ref);
      writes += 1;
      continue;
    }
    if (data.status === 'PAID' || data.status === 'CLOSED' || data.status === 'CANCELLED') continue;
    if (phase === 'PENDING_CANCELLATION' && !OPEN_VENDOR_BILL_STATUSES.has(String(data.status || ''))) continue;
    if (phase === 'CANCELLED' && data.status !== 'PENDING_CANCELLATION' && !OPEN_VENDOR_BILL_STATUSES.has(String(data.status || ''))) {
      continue;
    }
    batch.update(billDoc.ref, {
      status: phase,
      cancellationReason: (detail.reason || data.cancellationReason || '').trim(),
      cancellationApproverNote: (detail.approverNote || data.cancellationApproverNote || '').trim(),
      ...(detail.refundMode ? { cancellationRefundMode: detail.refundMode } : {}),
      updatedAt: now,
    });
    writes += 1;
  }
  if (writes > 0) await batch.commit();
}

/** ซ่อมใบที่เคยถูกสร้างเป็นบรรทัดยอด 0 — ย้ายสถานะกลับไปใบวางบิลเดิม */
export async function repairPlaceholderCancellationBills(db: Firestore, purchaseId: string): Promise<void> {
  const purchaseSnap = await getDoc(doc(db, 'purchases', purchaseId));
  if (!purchaseSnap.exists()) return;
  const purchase = purchaseSnap.data() as Purchase;
  const phase =
    purchase.status === 'CANCELLED'
      ? 'CANCELLED'
      : purchase.status === 'PENDING_CANCELLATION'
        ? 'PENDING_CANCELLATION'
        : null;
  if (!phase) return;
  await syncExistingVendorBillsForCancellation(db, purchaseId, phase, {
    reason: purchase.cancellationReason,
    approverNote: purchase.cancellationApproverNote,
    refundMode: purchase.cancellationRefundMode,
  });
}

export async function approvePurchaseCancellation(
  db: Firestore,
  user: User,
  purchase: Pick<Purchase, 'id' | 'purchaseNo' | 'cancellationReason'>,
  mode: PurchaseCancellationRefundMode,
  approverNote: string,
): Promise<void> {
  const note = approverNote.trim();
  if (mode === 'NO_REFUND' && !note) throw new Error('กรุณาระบุเหตุผลที่ไม่ต้องรับเงินคืน');
  const now = Date.now();
  await updateDoc(doc(db, 'purchases', purchase.id), {
    cancellationRequestStatus: 'APPROVED',
    cancellationRefundMode: mode,
    cancellationDecidedAt: now,
    cancellationDecidedByUid: user.id,
    cancellationDecidedByName: actorName(user),
    cancellationApproverNote: note || deleteField(),
    status: 'PENDING_CANCELLATION',
    updatedAt: now,
  });
  await syncExistingVendorBillsForCancellation(db, purchase.id, 'PENDING_CANCELLATION', {
    reason: purchase.cancellationReason,
    approverNote: note,
    refundMode: mode,
  });
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
  await syncExistingVendorBillsForCancellation(db, purchase.id, 'CANCELLED', {});
  return { entryNo };
}

/** บัญชียืนยันบนใบวางบิลเดิม — สถานะรอยกเลิกเป็นยกเลิก ไม่สร้างใบใหม่ และไม่ยกเลิก PR */
export async function confirmPurchaseCancellationWithoutRefund(
  db: Firestore,
  user: User,
  purchaseId: string,
): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(db, 'purchases', purchaseId), {
    status: 'CANCELLED',
    cancellationSettledAt: now,
    cancellationSettledByUid: user.id,
    cancellationSettledByName: actorName(user),
    updatedAt: now,
  });
  await syncExistingVendorBillsForCancellation(db, purchaseId, 'CANCELLED', {});
}
