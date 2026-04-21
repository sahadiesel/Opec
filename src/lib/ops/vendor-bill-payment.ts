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
import { syncPurchasePaymentClosure, supplierWithholdingOnMilestone } from '@/lib/ops/purchase-payment-milestones';

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

  const pid = bill.purchaseId || purchase.id;
  let grossInclVat = Number(bill.billAmount ?? purchase.totalAmount) || 0;

  if (bill.milestoneId) {
    const mRef = doc(firestore, 'purchases', pid, 'payment_milestones', bill.milestoneId);
    const mSnap = await getDoc(mRef);
    if (mSnap.exists()) {
      const md = mSnap.data() as PurchasePaymentMilestone;
      grossInclVat = Number(md.amount) || grossInclVat;
    }
  }

  let amountFromBank = grossInclVat;
  let whtBreakdown: ReturnType<typeof supplierWithholdingOnMilestone> | null = null;

  if (purchase.supplierWithholdingEnabled && (Number(purchase.supplierWithholdingRatePercent) || 0) > 0.005) {
    whtBreakdown = supplierWithholdingOnMilestone(
      grossInclVat,
      Number(purchase.supplierWithholdingRatePercent) || 0,
      purchase
    );
    amountFromBank = whtBreakdown.netPaid;
  }

  /** ปิดเจ้าหนี้ตามยอดเต็มใบ — ส่วนหัก ณ ที่จ่ายไม่ใช่เงินออกบัญชีธนาคาร */
  const apCreditAmount = grossInclVat;

  const now = Date.now();
  const actor = currentUser.displayName || currentUser.email || '';

  const { code: entryNo } = await generateNextDocumentCode(firestore, 'cashbook_entry', { actor });

  const cbRef = doc(collection(firestore, 'cashbook_entries'));
  const bankRef = doc(firestore, 'bank_accounts', bankAccountId);
  const apRef = doc(firestore, 'accounts_payable', bill.id);

  const batch = writeBatch(firestore);

  const description =
    whtBreakdown && whtBreakdown.wht > 0.005
      ? `จ่ายคู่ค้า ${vendorName} สุทธิ ฿${amountFromBank.toLocaleString(undefined, { minimumFractionDigits: 2 })} (หัก ณ ที่จ่าย ฿${whtBreakdown.wht.toLocaleString(undefined, { minimumFractionDigits: 2 })} รอนำส่งสรรพากร) — ${bill.receiptNo} (PO ${purchase.purchaseNo || pid})`
      : `จ่ายคู่ค้า ${vendorName} — ${bill.receiptNo} (PO ${purchase.purchaseNo || pid})`;

  batch.set(cbRef, {
    id: cbRef.id,
    entryNo,
    bankAccountId,
    entryDate,
    direction: 'OUT',
    entryType: 'SUPPLIER_PAYMENT',
    referenceType: 'PAYMENT',
    referenceId: bill.id,
    amount: amountFromBank,
    grossPaymentAmount: grossInclVat,
    supplierWithholdingAmount: whtBreakdown && whtBreakdown.wht > 0.005 ? whtBreakdown.wht : undefined,
    description,
    paymentMethod,
    createdAt: now,
    updatedAt: now,
  });

  batch.update(bankRef, {
    currentBalance: increment(-amountFromBank),
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
      creditAmount: apCreditAmount,
      outstandingAmount: 0,
      status: 'PAID',
      updatedAt: now,
    },
    { merge: true }
  );

  if (bill.milestoneId) {
    const mRef = doc(firestore, 'purchases', pid, 'payment_milestones', bill.milestoneId);
    batch.update(mRef, {
      status: 'PAID',
      paidAt: now,
      paidByUid: currentUser.id,
      paidByName: actor,
      updatedAt: now,
    });
  }

  if (whtBreakdown && whtBreakdown.wht > 0.005) {
    const whtRef = doc(collection(firestore, 'withholding_at_source_items'));
    batch.set(whtRef, {
      id: whtRef.id,
      vendorId: bill.vendorId,
      vendorName,
      purchaseId: pid,
      purchaseNo: purchase.purchaseNo,
      vendorBillId: bill.id,
      receiptNo: bill.receiptNo,
      milestoneId: bill.milestoneId,
      grossPaymentAmount: grossInclVat,
      baseBeforeVat: whtBreakdown.baseBeforeVat,
      whtAmount: whtBreakdown.wht,
      ratePercent: Number(purchase.supplierWithholdingRatePercent) || 0,
      status: 'OUTSTANDING',
      cashbookEntryId: cbRef.id,
      cashbookEntryNo: entryNo,
      entryDate,
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();

  const ms = await getDocs(
    query(collection(firestore, 'purchases', pid, 'payment_milestones'), orderBy('sequence', 'asc'))
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
