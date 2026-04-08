import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  writeBatch,
  type Firestore,
  type DocumentReference,
} from 'firebase/firestore';
import type { PaymentMethod, Purchase, PurchasePaymentMilestone, PurchaseVendorBill, User } from '@/lib/types';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { syncPurchasePaymentClosure } from '@/lib/ops/purchase-payment-milestones';

export async function executeVendorBillPayment(params: {
  firestore: Firestore;
  billRef: DocumentReference;
  bill: PurchaseVendorBill;
  purchaseRef: DocumentReference;
  purchase: Purchase;
  vendorName: string;
  bankAccountId: string;
  paymentMethod: PaymentMethod;
  entryDate: string;
  currentUser: User;
}): Promise<{ cashbookEntryNo: string }> {
  const {
    firestore,
    billRef,
    bill,
    purchaseRef,
    purchase,
    vendorName,
    bankAccountId,
    paymentMethod,
    entryDate,
    currentUser,
  } = params;

  if (bill.status !== 'SUBMITTED') {
    throw new Error('INVALID_BILL_STATUS');
  }
  if (bill.cashbookEntryId) {
    throw new Error('ALREADY_RECORDED');
  }

  const total = bill.billAmount ?? purchase.totalAmount;
  const now = Date.now();
  const actor = currentUser.displayName || currentUser.email || '';

  const { code: entryNo } = await generateNextDocumentCode(firestore, 'cashbook_entry', { actor });

  const cbRef = doc(collection(firestore, 'cashbook_entries'));
  const bankRef = doc(firestore, 'bank_accounts', bankAccountId);
  const apRef = doc(firestore, 'accounts_payable', bill.id);

  const batch = writeBatch(firestore);

  batch.set(cbRef, {
    id: cbRef.id,
    entryNo,
    bankAccountId,
    entryDate,
    direction: 'OUT',
    entryType: 'SUPPLIER_PAYMENT',
    referenceType: 'PAYMENT',
    referenceId: bill.id,
    amount: total,
    description: `จ่ายคู่ค้า ${vendorName} — ${bill.receiptNo} (PO ${purchase.purchaseNo || purchase.id})`,
    paymentMethod,
    createdAt: now,
    updatedAt: now,
  });

  batch.update(bankRef, {
    currentBalance: increment(-total),
    updatedAt: now,
  });

  batch.update(billRef, {
    status: 'PAID',
    paidAt: now,
    paidByUid: currentUser.id,
    paidByName: actor,
    cashbookEntryId: cbRef.id,
    cashbookEntryNo: entryNo,
    updatedAt: now,
  });

  batch.set(
    apRef,
    {
      creditAmount: total,
      outstandingAmount: 0,
      status: 'PAID',
      updatedAt: now,
    },
    { merge: true }
  );

  if (bill.milestoneId) {
    const mRef = doc(firestore, 'purchases', purchase.id, 'payment_milestones', bill.milestoneId);
    batch.update(mRef, {
      status: 'PAID',
      paidAt: now,
      paidByUid: currentUser.id,
      paidByName: actor,
      updatedAt: now,
    });
  }

  await batch.commit();

  const ms = await getDocs(
    query(collection(firestore, 'purchases', purchase.id, 'payment_milestones'), orderBy('sequence', 'asc'))
  );
  const milestones: PurchasePaymentMilestone[] = ms.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<PurchasePaymentMilestone, 'id'>),
  }));

  const pSnap = await getDoc(purchaseRef);
  const latestPurchase = pSnap.exists() ? ({ id: pSnap.id, ...pSnap.data() } as Purchase) : purchase;
  await syncPurchasePaymentClosure(firestore, purchaseRef, latestPurchase, milestones);

  return { cashbookEntryNo: entryNo };
}
