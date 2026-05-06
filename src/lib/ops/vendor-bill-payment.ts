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
import type {
  BankAccount,
  CashbookEntry,
  PaymentMethod,
  Purchase,
  PurchasePaymentMilestone,
  PurchaseVendorBill,
  User,
  Vendor,
} from '@/lib/types';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import {
  syncPurchasePaymentClosure,
  supplierWithholdingOnMilestone,
  effectiveVendorBillWhtRatePercent,
} from '@/lib/ops/purchase-payment-milestones';
import {
  buildWithholdingCertificateDraft,
  stripUndefinedForFirestore,
  type CompanyProfileWhtInput,
} from '@/lib/wht/wht-certificate-build';
import { buildWhtAuditLogEntry } from '@/lib/wht/wht-certificate-audit';

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
  paymentProofUrl?: string;
  paymentProofFileName?: string;
  /** แนบเมื่อมีหัก ณ ที่จ่าย */
  whtPaymentProofUrl?: string;
  whtPaymentProofFileName?: string;
}): Promise<{ cashbookEntryNo: string; createdWhtCertificateId?: string }> {
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
    paymentProofUrl,
    paymentProofFileName,
    whtPaymentProofUrl,
    whtPaymentProofFileName,
  } = params;

  if (bill.status !== 'SUBMITTED') {
    throw new Error('INVALID_BILL_STATUS');
  }
  if (bill.cashbookEntryId) {
    throw new Error('ALREADY_RECORDED');
  }

  const pid = bill.purchaseId || purchase.id;
  let grossInclVat = Number(bill.billAmount ?? purchase.totalAmount) || 0;
  let linkedMilestone: PurchasePaymentMilestone | null = null;

  if (bill.milestoneId) {
    const mRef = doc(firestore, 'purchases', pid, 'payment_milestones', bill.milestoneId);
    const mSnap = await getDoc(mRef);
    if (mSnap.exists()) {
      linkedMilestone = { id: mSnap.id, ...mSnap.data() } as PurchasePaymentMilestone;
      grossInclVat = Number(linkedMilestone.amount) || grossInclVat;
    }
  }

  let amountFromBank = grossInclVat;
  let whtBreakdown: ReturnType<typeof supplierWithholdingOnMilestone> | null = null;

  const whtRateEffective = effectiveVendorBillWhtRatePercent(bill, purchase);
  if (purchase.supplierWithholdingEnabled && whtRateEffective > 0.005) {
    whtBreakdown = supplierWithholdingOnMilestone(grossInclVat, whtRateEffective, purchase);
    amountFromBank = whtBreakdown.netPaid;
  }

  /** ปิดเจ้าหนี้ตามยอดเต็มใบ — ส่วนหัก ณ ที่จ่ายไม่ใช่เงินออกบัญชีธนาคาร */
  const apCreditAmount = grossInclVat;

  const now = Date.now();
  const actor = currentUser.displayName || currentUser.email || '';

  let createdWhtCertificateId: string | undefined;

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
    ...(whtBreakdown && whtBreakdown.wht > 0.005 ? { supplierWithholdingAmount: whtBreakdown.wht } : {}),
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
    ...(paymentProofUrl
      ? {
          paymentProofUrl,
          ...(paymentProofFileName?.trim() ? { paymentProofFileName: paymentProofFileName.trim() } : {}),
        }
      : {}),
    ...(whtBreakdown &&
    whtBreakdown.wht > 0.005 &&
    whtPaymentProofUrl &&
    String(whtPaymentProofUrl).trim()
      ? {
          whtPaymentProofUrl: String(whtPaymentProofUrl).trim(),
          ...(whtPaymentProofFileName?.trim()
            ? { whtPaymentProofFileName: whtPaymentProofFileName.trim() }
            : {}),
        }
      : {}),
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
      ...(purchase.purchaseNo ? { purchaseNo: purchase.purchaseNo } : {}),
      vendorBillId: bill.id,
      receiptNo: bill.receiptNo,
      ...(bill.milestoneId ? { milestoneId: bill.milestoneId } : {}),
      grossPaymentAmount: grossInclVat,
      baseBeforeVat: whtBreakdown.baseBeforeVat,
      whtAmount: whtBreakdown.wht,
      ratePercent: whtRateEffective,
      status: 'OUTSTANDING',
      cashbookEntryId: cbRef.id,
      cashbookEntryNo: entryNo,
      entryDate,
      createdAt: now,
      updatedAt: now,
    });

    /** สร้างหนังสือรับรองหัก ณ ที่จ่ายร่างอัตโนมัติ (DRAFT) — พร้อมกับบันทึกจ่าย */
    if (!bill.whtCertificateDocumentId) {
      const [vSnap, cSnap, bSnap] = await Promise.all([
        getDoc(doc(firestore, 'vendors', bill.vendorId)),
        getDoc(doc(firestore, 'system', 'company_profile')),
        getDoc(doc(firestore, 'bank_accounts', bankAccountId)),
      ]);
      if (vSnap.exists()) {
        const vendor = { id: vSnap.id, ...vSnap.data() } as Vendor;
        const company = (cSnap.exists() ? cSnap.data() : {}) as CompanyProfileWhtInput;
        const bank = bSnap.exists() ? ({ id: bSnap.id, ...bSnap.data() } as BankAccount) : undefined;
        const certRef = doc(collection(firestore, 'withholding_certificate_documents'));
        const cashbookEntryShape: CashbookEntry = {
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
          supplierWithholdingAmount: whtBreakdown.wht,
          description,
          paymentMethod,
          createdAt: now,
          updatedAt: now,
        };
        const draftCore = buildWithholdingCertificateDraft({
          bill,
          purchase,
          vendor,
          company,
          milestone: linkedMilestone ?? undefined,
          cashbook: cashbookEntryShape,
          bank,
          paymentDateYmd: entryDate,
          paymentIssueDateYmd: entryDate,
          paymentMethod,
          sourceWithholdingAtSourceItemId: whtRef.id,
        });
        draftCore.createdByUid = currentUser.id;
        draftCore.createdByName = actor.trim() || currentUser.email || currentUser.id;

        batch.set(certRef, stripUndefinedForFirestore({ id: certRef.id, ...draftCore }));
        batch.update(billRef, {
          whtCertificateDocumentId: certRef.id,
          updatedAt: now,
        });
        const auditRef = doc(
          collection(firestore, 'withholding_certificate_documents', certRef.id, 'audit_logs'),
        );
        batch.set(
          auditRef,
          stripUndefinedForFirestore({
            id: auditRef.id,
            ...buildWhtAuditLogEntry({
              documentId: certRef.id,
              action: 'CREATE_WHT',
              actorId: currentUser.id,
              actorName: actor,
              payloadSummary: { sourceVendorBillId: bill.id, autoCreatedOnVendorBillPayment: true },
            }),
          }),
        );
        createdWhtCertificateId = certRef.id;
      }
    }
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

  return { cashbookEntryNo: entryNo, createdWhtCertificateId };
}
