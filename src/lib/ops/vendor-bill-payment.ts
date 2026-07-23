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
  type UpdateData,
} from 'firebase/firestore';
import type {
  APStatus,
  BankAccount,
  CashbookEntry,
  PaymentMethod,
  Purchase,
  PurchasePaymentMilestone,
  PurchaseVendorBill,
  User,
  Vendor,
  VendorBillPaymentInstallment,
} from '@/lib/types';
import {
  billUsesPaymentInstallmentPlan,
} from '@/lib/ops/vendor-bill-installment-plan';
import { vendorBillStatusAfterPayment } from '@/lib/ops/vendor-bill-status';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import {
  syncPurchasePaymentClosure,
  effectiveVendorBillWhtRatePercent,
  effectiveVendorBillWithholdingEnabled,
  roundMoney2,
  supplierWithholdingOnVendorBill,
} from '@/lib/ops/purchase-payment-milestones';
import {
  buildWithholdingCertificateDraft,
  buildWhtElectronicDataFromDocument,
  stripUndefinedForFirestore,
  type CompanyProfileWhtInput,
} from '@/lib/wht/wht-certificate-build';
import { buildWhtAuditLogEntry } from '@/lib/wht/wht-certificate-audit';
import { validateWhtCertificateForOfficialIssue } from '@/lib/wht/wht-certificate-validation';

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
  /** เมื่อมี paymentInstallments — เลือกงวดที่จ่าย (ถ้าไม่ส่ง = งวดแรกที่ยัง PENDING) */
  installmentId?: string;
  /** บัญชีรับโอนของคู่ค้าที่เลือกตอนทำจ่าย */
  vendorPayeeBank?: {
    id?: string;
    bankName?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
  } | null;
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
    installmentId: installmentIdParam,
    vendorPayeeBank,
  } = params;

  const installmentPlanActive = billUsesPaymentInstallmentPlan(bill);

  if (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') {
    throw new Error('INVALID_BILL_STATUS');
  }
  if (!installmentPlanActive && bill.cashbookEntryId) {
    throw new Error('ALREADY_RECORDED');
  }
  if (installmentPlanActive && !bill.paymentInstallments!.some((i) => i.payStatus === 'PENDING')) {
    throw new Error('NO_PENDING_INSTALLMENT');
  }

  const pid = bill.purchaseId || purchase.id;
  let grossInclVat = roundMoney2(Number(bill.billAmount ?? purchase.totalAmount) || 0);
  let linkedMilestone: PurchasePaymentMilestone | null = null;

  let targetInstallmentId: string | undefined;

  if (installmentPlanActive) {
    const plan = bill.paymentInstallments!;
    targetInstallmentId =
      installmentIdParam?.trim() || plan.find((i) => i.payStatus === 'PENDING')?.id;
    if (!targetInstallmentId) throw new Error('NO_PENDING_INSTALLMENT');
    const inst = plan.find((i) => i.id === targetInstallmentId);
    if (!inst || inst.payStatus !== 'PENDING') throw new Error('INVALID_INSTALLMENT');
    grossInclVat = roundMoney2(Number(inst.amountInclVat) || 0);
  } else if (bill.milestoneId) {
    const mRef = doc(firestore, 'purchases', pid, 'payment_milestones', bill.milestoneId);
    const mSnap = await getDoc(mRef);
    if (mSnap.exists()) {
      linkedMilestone = { id: mSnap.id, ...mSnap.data() } as PurchasePaymentMilestone;
      grossInclVat = roundMoney2(Number(linkedMilestone.amount) || grossInclVat);
    }
  }

  let amountFromBank = grossInclVat;
  let whtBreakdown: ReturnType<typeof supplierWithholdingOnVendorBill> | null = null;

  const whtRateEffective = effectiveVendorBillWhtRatePercent(bill, purchase);
  const whtEnabled = effectiveVendorBillWithholdingEnabled(bill, purchase);
  if (whtEnabled && whtRateEffective > 0.005) {
    whtBreakdown = supplierWithholdingOnVendorBill(
      grossInclVat,
      whtRateEffective,
      purchase,
      bill.billVatTreatment,
      bill,
    );
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
  const apSnap = await getDoc(apRef);

  let debitAmt = roundMoney2(Number(bill.billAmount ?? purchase.totalAmount) || 0);
  let prevCredit = 0;
  if (apSnap.exists()) {
    const d = apSnap.data();
    debitAmt = roundMoney2(Number(d.debitAmount) || debitAmt);
    prevCredit = roundMoney2(Number(d.creditAmount) || 0);
  }
  const newCreditTotal = roundMoney2(prevCredit + apCreditAmount);
  const newOutstanding = Math.max(0, roundMoney2(debitAmt - newCreditTotal));
  const apStatusNext: APStatus = newOutstanding <= 0.009 ? 'PAID' : 'PARTIALLY_PAID';

  const installmentLabel =
    installmentPlanActive && targetInstallmentId
      ? bill.paymentInstallments!.find((i) => i.id === targetInstallmentId)?.label
      : undefined;
  const descTail = installmentLabel ? ` · ${installmentLabel}` : '';

  const batch = writeBatch(firestore);

  const description =
    (whtBreakdown && whtBreakdown.wht > 0.005
      ? `จ่ายคู่ค้า ${vendorName} สุทธิ ฿${amountFromBank.toLocaleString(undefined, { minimumFractionDigits: 2 })} (หัก ณ ที่จ่าย ฿${whtBreakdown.wht.toLocaleString(undefined, { minimumFractionDigits: 2 })} รอนำส่งสรรพากร) — ${bill.receiptNo} (PO ${purchase.purchaseNo || pid})`
      : `จ่ายคู่ค้า ${vendorName} — ${bill.receiptNo} (PO ${purchase.purchaseNo || pid})`) + descTail;

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

  batch.set(
    apRef,
    {
      creditAmount: newCreditTotal,
      outstandingAmount: newOutstanding,
      status: apStatusNext,
      updatedAt: now,
    },
    { merge: true },
  );

  const proofPayload =
    paymentProofUrl && String(paymentProofUrl).trim()
      ? {
          paymentProofUrl,
          ...(paymentProofFileName?.trim() ? { paymentProofFileName: paymentProofFileName.trim() } : {}),
        }
      : {};

  const vendorPayeePayload =
    vendorPayeeBank &&
    (vendorPayeeBank.bankName?.trim() ||
      vendorPayeeBank.bankAccountName?.trim() ||
      vendorPayeeBank.bankAccountNumber?.trim())
      ? {
          ...(vendorPayeeBank.id?.trim() ? { vendorPayeeBankAccountId: vendorPayeeBank.id.trim() } : {}),
          ...(vendorPayeeBank.bankName?.trim()
            ? { vendorPayeeBankName: vendorPayeeBank.bankName.trim() }
            : {}),
          ...(vendorPayeeBank.bankAccountName?.trim()
            ? { vendorPayeeBankAccountName: vendorPayeeBank.bankAccountName.trim() }
            : {}),
          ...(vendorPayeeBank.bankAccountNumber?.trim()
            ? { vendorPayeeBankAccountNumber: vendorPayeeBank.bankAccountNumber.trim() }
            : {}),
        }
      : {};

  const whtProofPayload =
    whtBreakdown &&
    whtBreakdown.wht > 0.005 &&
    whtPaymentProofUrl &&
    String(whtPaymentProofUrl).trim()
      ? {
          whtPaymentProofUrl: String(whtPaymentProofUrl).trim(),
          ...(whtPaymentProofFileName?.trim()
            ? { whtPaymentProofFileName: whtPaymentProofFileName.trim() }
            : {}),
        }
      : {};

  let billPatch: UpdateData<PurchaseVendorBill>;

  if (installmentPlanActive && targetInstallmentId) {
    const plan = bill.paymentInstallments!;
    const updatedInstallments = plan.map((i) =>
      i.id === targetInstallmentId
        ? {
            ...i,
            payStatus: 'PAID' as const,
            paidAt: now,
            paidByUid: currentUser.id,
            paidByName: actor,
            cashbookEntryId: cbRef.id,
            cashbookEntryNo: entryNo,
            ...proofPayload,
            ...vendorPayeePayload,
            ...whtProofPayload,
          }
        : i,
    );
    const allPaid = updatedInstallments.every((x) => x.payStatus === 'PAID');
    const paidStatus = vendorBillStatusAfterPayment(bill);
    billPatch = {
      paymentInstallments: updatedInstallments,
      status: allPaid ? paidStatus : 'PARTIALLY_PAID',
      updatedAt: now,
    };
    if (allPaid) {
      billPatch.paidAt = now;
      billPatch.paidByUid = currentUser.id;
      billPatch.paidByName = actor;
      billPatch.cashbookEntryId = cbRef.id;
      billPatch.cashbookEntryNo = entryNo;
      Object.assign(billPatch, proofPayload, vendorPayeePayload, whtProofPayload);
    }
  } else {
    billPatch = {
      status: vendorBillStatusAfterPayment(bill),
      paidAt: now,
      paidByUid: currentUser.id,
      paidByName: actor,
      cashbookEntryId: cbRef.id,
      cashbookEntryNo: entryNo,
      ...proofPayload,
      ...vendorPayeePayload,
      ...whtProofPayload,
      updatedAt: now,
    };
  }

  if (bill.milestoneId && !installmentPlanActive) {
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
      ...(bill.milestoneId && !installmentPlanActive ? { milestoneId: bill.milestoneId } : {}),
      ...(installmentPlanActive && targetInstallmentId ? { installmentId: targetInstallmentId } : {}),
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

    /** สร้างหนังสือรับรองหัก ณ ที่จ่าย + ออกเลขที่ (ISSUED) ทันทีเมื่อบันทึกจ่าย — ไม่ผ่านขั้นตอนร่าง */
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

      const issueErrs = validateWhtCertificateForOfficialIssue(draftCore);
      if (issueErrs.length > 0) {
        throw new Error(issueErrs.join(' '));
      }

      const actorTrimmed = actor.trim() || currentUser.email || currentUser.id;
      const issueDate = new Date(`${entryDate}T12:00:00`);
      const { code: certificateNo } = await generateNextDocumentCode(firestore, 'wht_certificate_50', {
        actor: actorTrimmed,
        userId: currentUser.id,
        date: issueDate,
      });

      const electronic = buildWhtElectronicDataFromDocument({
        ...draftCore,
        certificateNo,
        paymentIssueDate: entryDate,
      });

      batch.set(
        certRef,
        stripUndefinedForFirestore({
          id: certRef.id,
          ...draftCore,
          certificateNo,
          paymentIssueDate: entryDate,
          documentStatus: 'ISSUED',
          issuedAt: now,
          issuedByUid: currentUser.id,
          issuedByName: actorTrimmed,
          whtElectronicData: stripUndefinedForFirestore({
            ...electronic,
            xmlExportStatus: 'NOT_EXPORTED',
          }),
        }),
      );
      billPatch.whtCertificateDocumentId = certRef.id;
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
            payloadSummary: {
              sourceVendorBillId: bill.id,
              autoCreatedOnVendorBillPayment: true,
              autoIssued: true,
              certificateNo,
            },
          }),
        }),
      );
      createdWhtCertificateId = certRef.id;
    }
  }

  batch.update(billRef, billPatch);

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
