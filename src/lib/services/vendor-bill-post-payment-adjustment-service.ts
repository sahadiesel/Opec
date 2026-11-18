'use client';

import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type {
  AccountsPayable,
  Purchase,
  PurchaseVendorBill,
  User,
  VendorBillAdjustmentKind,
  VendorBillPostPaymentAdjustment,
  VendorBillWhtPresetCategory,
  WithholdingAtSourceItem,
  WithholdingCertificateDocument,
} from '@/lib/types';
import {
  effectiveVendorBillWhtRatePercent,
  effectiveVendorBillWithholdingEnabled,
  roundMoney2,
  supplierWithholdingOnVendorBill,
  vendorBillWhtPresetRatePercent,
} from '@/lib/ops/purchase-payment-milestones';
import {
  incomeTypeForVendorBillWht,
} from '@/lib/wht/wht-certificate-build';
import { buildWhtAuditLogEntry } from '@/lib/wht/wht-certificate-audit';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { supplierWhtCategoryLabel } from '@/lib/ops/supplier-wht-category';
import { timestampToHtmlDateValue } from '@/lib/date-thai';

function actorLabel(user: User): string {
  return (user.displayName || user.email || user.id).trim();
}

function computeOriginalSnapshot(
  bill: PurchaseVendorBill,
  purchase: Purchase,
): {
  gross: number;
  rate: number;
  category?: VendorBillWhtPresetCategory;
  wht: number;
  net: number;
  base: number;
} {
  const gross = roundMoney2(Number(bill.billAmount ?? purchase.totalAmount) || 0);
  const enabled = effectiveVendorBillWithholdingEnabled(bill, purchase);
  const rate = enabled ? effectiveVendorBillWhtRatePercent(bill, purchase) : 0;
  const category = bill.vendorBillWhtPresetCategory ?? purchase.supplierWithholdingCategory ?? undefined;
  if (!enabled || rate <= 0.005) {
    return { gross, rate: 0, category, wht: 0, net: gross, base: 0 };
  }
  const br = supplierWithholdingOnVendorBill(gross, rate, purchase, bill.billVatTreatment, bill);
  return { gross, rate, category, wht: br.wht, net: br.netPaid, base: br.baseBeforeVat };
}

async function amendOriginalWhtDocuments(params: {
  db: Firestore;
  bill: PurchaseVendorBill;
  purchase: Purchase;
  actor: User;
  proposed: {
    gross: number;
    rate: number;
    category?: VendorBillWhtPresetCategory;
    wht: number;
    net: number;
    base: number;
  };
  reason: string;
}): Promise<boolean> {
  const { db, bill, purchase, actor, proposed, reason } = params;
  const certId = String(bill.whtCertificateDocumentId || '').trim();
  if (!certId) return false;

  const certRef = doc(db, 'withholding_certificate_documents', certId);
  const certSnap = await getDoc(certRef);
  if (!certSnap.exists()) return false;
  const cert = { id: certSnap.id, ...certSnap.data() } as WithholdingCertificateDocument;
  if (cert.documentStatus === 'CANCELLED' || cert.documentStatus === 'REPLACED') {
    throw new Error('หนังสือหัก ณ ที่จ่ายถูกยกเลิก/แทนที่แล้ว — ไม่สามารถแก้ฉบับเดิมได้');
  }

  const billForIncome: PurchaseVendorBill = {
    ...bill,
    vendorBillWhtPresetCategory: proposed.category,
    supplierWithholdingRatePercentBill: proposed.rate,
    billAmount: proposed.gross,
  };
  const income = incomeTypeForVendorBillWht(billForIncome, purchase);
  const now = Date.now();
  const name = actorLabel(actor);
  const vatAmount = roundMoney2(Math.max(0, proposed.gross - proposed.base));
  const electronic = {
    ...(cert.whtElectronicData || {}),
    incomeTypeCode: income.code,
    incomeTypeName: income.displayTh,
    withholdingTaxRate: proposed.rate,
    withholdingTaxBase: proposed.base,
    withholdingTaxAmount: proposed.wht,
  };

  const batch = writeBatch(db);
  batch.update(
    certRef,
    sanitizeFirestorePayload({
      incomeTypeCode: income.code,
      incomeTypeDisplayTh: income.displayTh,
      amountBeforeVat: proposed.base,
      vatAmount,
      grossAmount: proposed.gross,
      withholdingTaxBase: proposed.base,
      withholdingTaxRatePercent: proposed.rate,
      withholdingTaxAmount: proposed.wht,
      netPaidAmount: proposed.net,
      whtElectronicData: electronic,
      updatedAt: now,
      updatedByUid: actor.id,
      updatedByName: name,
    }) as Record<string, unknown>,
  );

  const auditRef = doc(collection(db, 'withholding_certificate_documents', certId, 'audit_logs'));
  batch.set(
    auditRef,
    sanitizeFirestorePayload({
      id: auditRef.id,
      ...buildWhtAuditLogEntry({
        documentId: certId,
        action: 'REPLACE_WHT',
        actorId: actor.id,
        actorName: name,
        reason,
        payloadSummary: {
          amendedInPlace: true,
          ratePercent: proposed.rate,
          whtAmount: proposed.wht,
          netPaidAmount: proposed.net,
          category: proposed.category,
        },
      }),
    }) as Record<string, unknown>,
  );

  const whtItems = await getDocs(
    query(collection(db, 'withholding_at_source_items'), where('vendorBillId', '==', bill.id)),
  );
  for (const d of whtItems.docs) {
    const item = d.data() as WithholdingAtSourceItem;
    if (item.status === 'VOID') continue;
    batch.update(d.ref, {
      grossPaymentAmount: proposed.gross,
      baseBeforeVat: proposed.base,
      whtAmount: proposed.wht,
      ratePercent: proposed.rate,
      updatedAt: now,
    });
  }

  await batch.commit();
  return true;
}

export async function requestVendorBillPostPaymentAdjustment(
  db: Firestore,
  billId: string,
  actor: User,
  input: {
    kind: VendorBillAdjustmentKind;
    reason: string;
    proposedGrossInclVat?: number;
    proposedWhtCategory?: VendorBillWhtPresetCategory | null;
    /** ปิดหัก ณ ที่จ่าย */
    disableWithholding?: boolean;
  },
): Promise<{ adjustment: VendorBillPostPaymentAdjustment }> {
  const billRef = doc(db, 'purchase_vendor_bills', billId);
  const billSnap = await getDoc(billRef);
  if (!billSnap.exists()) throw new Error('ไม่พบใบรับวางบิล');
  const bill = { id: billSnap.id, ...billSnap.data() } as PurchaseVendorBill;

  if (bill.status !== 'PAID' && bill.status !== 'PARTIALLY_PAID' && bill.status !== 'CLOSED') {
    throw new Error('ปรับปรุงได้เฉพาะใบที่จ่ายแล้ว');
  }
  if (bill.postPaymentAdjustment?.status === 'PENDING_ACCOUNTING') {
    throw new Error('มีคำขอปรับปรุงค้างอยู่แล้ว — ให้บัญชีเคลียร์ก่อน');
  }

  const purchaseSnap = await getDoc(doc(db, 'purchases', bill.purchaseId));
  if (!purchaseSnap.exists()) throw new Error('ไม่พบใบสั่งซื้อ');
  const purchase = { id: purchaseSnap.id, ...purchaseSnap.data() } as Purchase;

  const original = computeOriginalSnapshot(bill, purchase);
  const reason = input.reason.trim();
  if (!reason) throw new Error('ระบุเหตุผลการปรับปรุง');

  let proposedGross = original.gross;
  if (input.kind === 'AMOUNT') {
    const g = Number(input.proposedGrossInclVat);
    if (!Number.isFinite(g) || g <= 0) throw new Error('ระบุยอดในใบใหม่ให้ถูกต้อง');
    proposedGross = roundMoney2(g);
  }

  let proposedCategory = original.category;
  let proposedRate = original.rate;
  let disableWht = input.disableWithholding === true;

  if (input.kind === 'WHT_RATE' || input.kind === 'AMOUNT') {
    if (input.disableWithholding) {
      disableWht = true;
      proposedRate = 0;
      proposedCategory = undefined;
    } else if (input.proposedWhtCategory) {
      proposedCategory = input.proposedWhtCategory;
      proposedRate = vendorBillWhtPresetRatePercent(input.proposedWhtCategory);
      disableWht = false;
    } else if (input.kind === 'WHT_RATE') {
      throw new Error('เลือกประเภทหัก ณ ที่จ่าย');
    }
  }

  const proposedBr =
    !disableWht && proposedRate > 0.005
      ? supplierWithholdingOnVendorBill(
          proposedGross,
          proposedRate,
          purchase,
          bill.billVatTreatment,
          {
            supplierWithholdingTaxBaseBill:
              input.kind === 'WHT_RATE' ? bill.supplierWithholdingTaxBaseBill : null,
          },
        )
      : { wht: 0, netPaid: proposedGross, baseBeforeVat: 0 };

  const settlementDelta = roundMoney2(proposedBr.netPaid - original.net);
  const settlementDirection =
    settlementDelta > 0.005 ? 'PAY_MORE' : settlementDelta < -0.005 ? 'REFUND' : 'NONE';

  const now = Date.now();
  const name = actorLabel(actor);

  const adjustment: VendorBillPostPaymentAdjustment = {
    kind: input.kind,
    status: settlementDirection === 'NONE' ? 'SETTLED' : 'PENDING_ACCOUNTING',
    requestedAt: now,
    requestedByUid: actor.id,
    requestedByName: name,
    reason,
    originalGrossInclVat: original.gross,
    originalNetPaid: original.net,
    originalWhtAmount: original.wht,
    originalWhtRatePercent: original.rate,
    ...(original.category ? { originalWhtCategory: original.category } : {}),
    proposedGrossInclVat: proposedGross,
    ...(proposedCategory ? { proposedWhtCategory: proposedCategory } : {}),
    proposedWhtRatePercent: proposedRate,
    proposedWhtAmount: proposedBr.wht,
    proposedNetPaid: proposedBr.netPaid,
    settlementDelta,
    settlementDirection,
    ...(settlementDirection === 'NONE' ? { settledAt: now, settledByUid: actor.id, settledByName: name } : {}),
  };

  let whtAmended = false;
  if (bill.whtCertificateDocumentId) {
    whtAmended = await amendOriginalWhtDocuments({
      db,
      bill,
      purchase,
      actor,
      proposed: {
        gross: proposedGross,
        rate: proposedRate,
        category: proposedCategory,
        wht: proposedBr.wht,
        net: proposedBr.netPaid,
        base: proposedBr.baseBeforeVat > 0.005 ? proposedBr.baseBeforeVat : original.base,
      },
      reason,
    });
  } else if (input.kind === 'WHT_RATE' && proposedBr.wht > 0.005) {
    throw new Error(
      'ใบนี้ยังไม่มีหนังสือหัก ณ ที่จ่าย — ปรับอัตราได้เฉพาะใบที่มีเอกสารเดิม',
    );
  }
  adjustment.whtCertificateAmended = whtAmended;

  const billPatch: Record<string, unknown> = {
    postPaymentAdjustment: adjustment,
    billAmount: proposedGross,
    updatedAt: now,
  };

  if (disableWht) {
    billPatch.supplierWithholdingEnabledBill = false;
    billPatch.vendorBillWhtPresetCategory = deleteField();
    billPatch.supplierWithholdingRatePercentBill = 0;
  } else if (proposedCategory) {
    billPatch.supplierWithholdingEnabledBill = true;
    billPatch.vendorBillWhtPresetCategory = proposedCategory;
    billPatch.supplierWithholdingRatePercentBill = proposedRate;
  }

  if (settlementDirection === 'PAY_MORE') {
    billPatch.status = 'PARTIALLY_PAID';
    const apRef = doc(db, 'accounts_payable', bill.id);
    const apSnap = await getDoc(apRef);
    const delta = Math.abs(settlementDelta);
    if (apSnap.exists()) {
      const ap = apSnap.data() as AccountsPayable;
      const debit = roundMoney2((Number(ap.debitAmount) || 0) + delta);
      const credit = roundMoney2(Number(ap.creditAmount) || 0);
      const outstanding = Math.max(0, roundMoney2(debit - credit));
      await updateDoc(apRef, {
        debitAmount: debit,
        outstandingAmount: outstanding,
        status: outstanding <= 0.009 ? 'PAID' : 'OPEN',
        updatedAt: now,
      });
    } else {
      await updateDoc(billRef, {}); // no-op placeholder; set below in batch-like updates
      const today = timestampToHtmlDateValue(now);
      // create AP via set through update path — use writeBatch below
      const batch = writeBatch(db);
      batch.set(apRef, {
        id: bill.id,
        vendorId: bill.vendorId,
        documentNo: `${bill.receiptNo}-ADJ`,
        referenceId: bill.id,
        billDate: bill.billingReceivedDate || today,
        dueDate: bill.plannedPaymentDate || today,
        debitAmount: delta,
        creditAmount: 0,
        outstandingAmount: delta,
        status: 'OPEN',
        origin: 'STORE_VENDOR_BILL',
        createdAt: now,
        updatedAt: now,
      });
      batch.update(billRef, sanitizeFirestorePayload(billPatch) as Record<string, unknown>);
      await batch.commit();
      return { adjustment };
    }
  }

  await updateDoc(billRef, sanitizeFirestorePayload(billPatch) as Record<string, unknown>);
  return { adjustment };
}

/**
 * บัญชีเคลียร์ส่วนต่าง: จ่ายเพิ่ม (OUT) หรือรับคืน (IN) ลง cashbook
 */
export async function settleVendorBillPostPaymentAdjustment(
  db: Firestore,
  billId: string,
  actor: User,
  input: {
    bankAccountId: string;
    entryDate: string;
    amount?: number;
  },
): Promise<{ cashbookEntryNo: string }> {
  const billRef = doc(db, 'purchase_vendor_bills', billId);
  const billSnap = await getDoc(billRef);
  if (!billSnap.exists()) throw new Error('ไม่พบใบรับวางบิล');
  const bill = { id: billSnap.id, ...billSnap.data() } as PurchaseVendorBill;
  const adj = bill.postPaymentAdjustment;
  if (!adj || adj.status !== 'PENDING_ACCOUNTING') {
    throw new Error('ไม่มีคำขอปรับปรุงที่รอบัญชี');
  }
  if (adj.settlementDirection === 'NONE') {
    throw new Error('ไม่มีส่วนต่างที่ต้องเคลียร์');
  }

  const bankId = input.bankAccountId.trim();
  if (!bankId) throw new Error('เลือกบัญชีธนาคาร');
  const entryDate = input.entryDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) throw new Error('วันที่ไม่ถูกต้อง');

  const expected = Math.abs(adj.settlementDelta);
  const amount = roundMoney2(input.amount != null ? Number(input.amount) : expected);
  if (!Number.isFinite(amount) || amount <= 0.005) throw new Error('ยอดไม่ถูกต้อง');
  if (Math.abs(amount - expected) > 0.05) {
    throw new Error(`ยอดต้องเท่ากับส่วนต่าง ฿${expected.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`);
  }

  const now = Date.now();
  const name = actorLabel(actor);
  const isPayMore = adj.settlementDirection === 'PAY_MORE';
  const { code: entryNo } = await generateNextDocumentCode(db, 'cashbook_entry', { actor: name });
  const cbRef = doc(collection(db, 'cashbook_entries'));
  const bankRef = doc(db, 'bank_accounts', bankId);
  const apRef = doc(db, 'accounts_payable', bill.id);

  const batch = writeBatch(db);
  batch.set(cbRef, {
    id: cbRef.id,
    entryNo,
    bankAccountId: bankId,
    entryDate,
    direction: isPayMore ? 'OUT' : 'IN',
    entryType: isPayMore ? 'SUPPLIER_PAYMENT' : 'OTHER_INCOME',
    referenceType: 'PAYMENT',
    referenceId: bill.id,
    amount,
    description: isPayMore
      ? `จ่ายเพิ่มคู่ค้าหลังปรับ${adj.kind === 'WHT_RATE' ? 'อัตราหัก ณ ที่จ่าย' : 'ยอด'} — ${bill.receiptNo} (${supplierWhtCategoryLabel(adj.proposedWhtCategory)} ${adj.proposedWhtRatePercent}%)`
      : `รับคืนจากคู่ค้าหลังปรับ${adj.kind === 'WHT_RATE' ? 'อัตราหัก ณ ที่จ่าย' : 'ยอด'} — ${bill.receiptNo}`,
    paymentMethod: 'TRANSFER',
    createdAt: now,
    updatedAt: now,
  });
  batch.update(bankRef, {
    currentBalance: increment(isPayMore ? -amount : amount),
    updatedAt: now,
  });

  if (isPayMore) {
    const apSnap = await getDoc(apRef);
    if (apSnap.exists()) {
      const ap = apSnap.data() as AccountsPayable;
      const credit = roundMoney2((Number(ap.creditAmount) || 0) + amount);
      const debit = roundMoney2(Number(ap.debitAmount) || 0);
      const outstanding = Math.max(0, roundMoney2(debit - credit));
      batch.update(apRef, {
        creditAmount: credit,
        outstandingAmount: outstanding,
        status: outstanding <= 0.009 ? 'PAID' : 'PARTIALLY_PAID',
        updatedAt: now,
      });
    }
  }

  const nextAdj: VendorBillPostPaymentAdjustment = {
    ...adj,
    status: 'SETTLED',
    settledAt: now,
    settledByUid: actor.id,
    settledByName: name,
    settlementCashbookEntryId: cbRef.id,
    settlementCashbookEntryNo: entryNo,
  };

  batch.update(billRef, {
    postPaymentAdjustment: nextAdj,
    status: 'PAID',
    updatedAt: now,
  });

  await batch.commit();
  return { cashbookEntryNo: entryNo };
}
