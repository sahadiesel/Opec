'use client';

/**
 * ใบเสร็จรับเงิน (ลูกค้า) — ออกหลัง «ยืนยันรับเงิน» บนใบกำกับภาษี (หลังขั้นแจ้งชำระ)
 * พร้อมลง cashbook + เพิ่มยอดบัญชีธนาคาร (writeBatch เดียวกับใบเสร็จ + อัปเดตใบกำกับ)
 *
 * ใบเสร็จ = ยอดตามใบกำกับ (ไม่หัก)
 * Cashbook = บรรทัดรับยอดตามใบกำกับ + (ถ้ามี) หัก WHT ลูกค้า + (ถ้ามี) ค่าธรรมเนียม/หักอื่น
 * ยอดเข้าบัญชีจริง = ยอดใบกำกับ − WHT − ค่าธรรมเนียม
 */
import {
  Firestore,
  collection,
  doc,
  getDoc,
  increment,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type { MoneyReceipt, TaxInvoice, User } from '@/lib/types';
import { asFirestoreUpdate } from '@/lib/firestore/as-update-data';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { expectedMoneyReceiptAmountFromInvoice } from '@/lib/accounting/money-receipt-wht-amount';
import {
  closeOpenCommercialArInBatch,
  prepareTaxInvoiceArReceiptUpdate,
} from '@/lib/services/accounts-receivable-reconcile-service';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

/** ยอดใบเสร็จ = ยอดรวมใบกำกับ (ฐานภาษี + VAT) — ไม่หัก ณ ที่จ่าย */
export function expectedMoneyReceiptAmount(inv: TaxInvoice): number {
  return expectedMoneyReceiptAmountFromInvoice(inv);
}

export type CustomerReceiptOtherDeduction = {
  /** ชื่อรายการ เช่น ค่าธรรมเนียมการโอน */
  label: string;
  amount: number;
};

export type ConfirmTaxInvoicePaymentParams = {
  bankAccountId: string;
  /**
   * ยอดใบเสร็จ / บรรทัดรับตามใบกำกับ (บาท)
   * ต้องสอดคล้องกับใบกำกับ — ไม่หัก WHT หรือค่าธรรมเนียมในยอดนี้
   */
  amount: number;
  /** วันที่รับเงิน / วันที่ลง cashbook (YYYY-MM-DD) */
  entryDate: string;
  /**
   * ลูกค้าหัก ณ ที่จ่าย (จากใบกำกับ) — สร้างบรรทัด OUT ใน cashbook เมื่อ > 0
   * ไม่กระทบยอดใบเสร็จ
   */
  customerWithholdingAmount?: number;
  /**
   * ค่าธรรมเนียม / หักอื่น — เฉพาะรายการที่ amount > 0 จะลง cashbook
   * ไม่สร้างบรรทัดยอด 0
   */
  otherDeductions?: CustomerReceiptOtherDeduction[];
  /** ลายเซ็นผู้รับเงิน (บัญชี) ที่อัปโหลดในโปรไฟล์ — ว่าง = ไม่วางบนใบเสร็จ */
  receiverSignatureImageUrl?: string;
  /** ตรายางบริษัทจากหัวเอกสาร — ว่าง = ไม่วางบนใบเสร็จ */
  companyStampImageUrl?: string;
};

/** ทำความสะอาดรายการหักอื่น — ทิ้งยอด ≤ 0 และต้องมีชื่อรายการ */
export function normalizeCustomerReceiptOtherDeductions(
  rows: CustomerReceiptOtherDeduction[] | undefined | null,
): CustomerReceiptOtherDeduction[] {
  if (!rows?.length) return [];
  const out: CustomerReceiptOtherDeduction[] = [];
  for (const row of rows) {
    const label = String(row?.label || '').trim();
    const amount = roundMoney2(Number(row?.amount) || 0);
    if (!(amount > 0.005)) continue;
    if (!label) {
      throw new Error('รายการหักอื่นต้องระบุชื่อรายการเมื่อมียอด');
    }
    out.push({ label: label.slice(0, 200), amount });
  }
  return out;
}

export function computeCustomerReceiptBankNet(params: {
  grossAmount: number;
  customerWithholdingAmount?: number;
  otherDeductions?: CustomerReceiptOtherDeduction[];
}): {
  gross: number;
  wht: number;
  feeTotal: number;
  fees: CustomerReceiptOtherDeduction[];
  bankNet: number;
} {
  const gross = roundMoney2(Number(params.grossAmount) || 0);
  const wht = roundMoney2(Math.max(0, Number(params.customerWithholdingAmount) || 0));
  const fees = normalizeCustomerReceiptOtherDeductions(params.otherDeductions);
  const feeTotal = roundMoney2(fees.reduce((s, f) => s + f.amount, 0));
  const bankNet = roundMoney2(gross - wht - feeTotal);
  return { gross, wht, feeTotal, fees, bankNet };
}

export async function recordTaxInvoicePaymentNotification(
  db: Firestore,
  inv: TaxInvoice,
  actor: User,
  opts: { source: 'client_portal' | 'accounting_ui'; note?: string },
): Promise<void> {
  if (inv.status !== 'ISSUED') {
    throw new Error('ออกใบกำกับ (ISSUED) ก่อน — จึงจะแจ้งชำระได้');
  }
  if (inv.paymentNotifiedAt) {
    throw new Error('แจ้งชำระเงินไปแล้ว');
  }
  if (inv.linkedReceiptId) {
    throw new Error('ออกใบเสร็จรับเงินแล้ว');
  }
  const ref = doc(db, 'tax_invoices', inv.id);
  await updateDoc(ref, {
    paymentNotifiedAt: Date.now(),
    paymentNotifiedByUid: actor.id,
    paymentNotifiedByName: actor.displayName,
    paymentNotifySource: opts.source,
    paymentNotificationNote: opts.note?.trim() || null,
    updatedAt: Date.now(),
  });
}

export async function confirmPaymentAndIssueMoneyReceipt(
  db: Firestore,
  inv: TaxInvoice,
  actor: User,
  params: ConfirmTaxInvoicePaymentParams,
): Promise<{
  receiptId: string;
  receiptNo: string;
  cashbookEntryId: string;
  cashbookEntryNo: string;
  bankNetAmount: number;
}> {
  if (inv.status !== 'ISSUED') {
    throw new Error('เอกสารต้องเป็น ISSUED');
  }
  if (!inv.paymentNotifiedAt) {
    throw new Error('ยังไม่มีการแจ้งชำระเงิน (ขั้นตอนที่ 1)');
  }
  if (inv.linkedReceiptId) {
    throw new Error('ออกใบเสร็จรับเงินแล้ว');
  }

  const bankId = params.bankAccountId?.trim();
  if (!bankId) throw new Error('กรุณาเลือกบัญชีธนาคารที่รับเงิน');

  const entryDate = params.entryDate?.trim();
  if (!entryDate) throw new Error('กรุณาระบุวันที่รับเงิน');

  const amt = roundMoney2(Number(params.amount));
  if (amt <= 0) throw new Error('ยอดรับต้องมากกว่า 0');

  const ceiling = roundMoney2(inv.totalAmount);
  if (amt > ceiling + 0.005) {
    throw new Error(
      `ยอดรับต้องไม่เกินยอดตามใบกำกับ (${ceiling.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ${inv.currency})`,
    );
  }

  const invoiceWht =
    inv.showWithholdingOnDocument === true ? roundMoney2(Number(inv.withholdingTaxAmount) || 0) : 0;
  const requestedWht = roundMoney2(Math.max(0, Number(params.customerWithholdingAmount) || 0));
  if (requestedWht > 0.005 && invoiceWht <= 0.005) {
    throw new Error('ใบกำกับนี้ไม่มียอดหัก ณ ที่จ่าย — ไม่สามารถลงบรรทัดหัก WHT ได้');
  }
  if (requestedWht > invoiceWht + 0.005) {
    throw new Error(
      `ยอดหัก ณ ที่จ่ายต้องไม่เกินตามใบกำกับ (${invoiceWht.toLocaleString('th-TH', { minimumFractionDigits: 2 })})`,
    );
  }

  const { gross, wht, feeTotal, fees, bankNet } = computeCustomerReceiptBankNet({
    grossAmount: amt,
    customerWithholdingAmount: requestedWht,
    otherDeductions: params.otherDeductions,
  });
  if (bankNet <= 0.005) {
    throw new Error('ยอดเข้าบัญชีจริงต้องมากกว่า 0 — ตรวจยอดหัก ณ ที่จ่ายและค่าธรรมเนียม');
  }

  const bankRef = doc(db, 'bank_accounts', bankId);
  const bankSnap = await getDoc(bankRef);
  if (!bankSnap.exists()) throw new Error('ไม่พบบัญชีธนาคาร');
  const bankData = bankSnap.data() as { status?: string; accountType?: string };
  if (bankData.status && bankData.status !== 'ACTIVE') {
    throw new Error('บัญชีนี้ไม่ ACTIVE');
  }
  if (String(bankData.accountType) === 'PETTY_CASH') {
    throw new Error('รับเงินลูกค้าให้เลือกบัญชีธนาคารหลัก — ไม่ใช่กอง Petty Cash');
  }

  const { code: receiptNo } = await generateNextDocumentCode(db, 'money_receipt', {
    actor: actor.displayName,
    userId: actor.id,
  });
  const { code: cashbookEntryNo } = await generateNextDocumentCode(db, 'cashbook_entry', {
    actor: actor.displayName,
  });

  let whtEntryNo: string | undefined;
  if (wht > 0.005) {
    const next = await generateNextDocumentCode(db, 'cashbook_entry', { actor: actor.displayName });
    whtEntryNo = next.code;
  }
  const feeEntryNos: string[] = [];
  for (let i = 0; i < fees.length; i += 1) {
    const next = await generateNextDocumentCode(db, 'cashbook_entry', { actor: actor.displayName });
    feeEntryNos.push(next.code);
  }

  const now = Date.now();
  const receiptRef = doc(collection(db, 'receipts'));
  const cashbookRef = doc(collection(db, 'cashbook_entries'));
  const whtCashbookRef = wht > 0.005 ? doc(collection(db, 'cashbook_entries')) : null;
  const feeCashbookRefs = fees.map(() => doc(collection(db, 'cashbook_entries')));
  const taxRef = doc(db, 'tax_invoices', inv.id);

  let arUpdate: { ref: ReturnType<typeof doc>; patch: Record<string, unknown> } | undefined;
  let resolvedArEntryId: string | undefined;
  try {
    /** AR / ใบเสร็จเครดิตด้วยยอดตามใบกำกับ — ไม่หัก WHT หรือค่าธรรมเนียม */
    const prepared = await prepareTaxInvoiceArReceiptUpdate(db, inv, gross, now);
    arUpdate = prepared.arUpdate;
    resolvedArEntryId = prepared.resolvedArEntryId;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'ไม่สามารถอัปเดตลูกหนี้ได้';
    throw new Error(msg);
  }

  const desc = `รับเงินลูกค้า ใบเสร็จ ${receiptNo} (ใบกำกับ ${inv.taxInvoiceNo})`.slice(0, 500);

  const receiptRow: Omit<MoneyReceipt, 'id'> = {
    receiptNo,
    taxInvoiceId: inv.id,
    taxInvoiceNo: inv.taxInvoiceNo,
    customerId: inv.customerId,
    amount: gross,
    currency: inv.currency,
    receiptDate: entryDate,
    status: 'ISSUED',
    bankAccountId: bankId,
    cashbookEntryId: cashbookRef.id,
    cashbookEntryNo: cashbookEntryNo,
    bankNetAmount: bankNet,
    ...(wht > 0.005 ? { customerWithholdingAmount: wht } : {}),
    ...(fees.length ? { otherDeductions: fees } : {}),
    ...(whtCashbookRef && whtEntryNo
      ? { cashbookWhtEntryId: whtCashbookRef.id, cashbookWhtEntryNo: whtEntryNo }
      : {}),
    ...(feeCashbookRefs.length
      ? {
          cashbookFeeEntryIds: feeCashbookRefs.map((r) => r.id),
          cashbookFeeEntryNos: feeEntryNos,
        }
      : {}),
    createdAt: now,
    updatedAt: now,
    createdByUid: actor.id,
    createdByName: actor.displayName,
    ...(params.receiverSignatureImageUrl?.trim()
      ? { receiverSignatureImageUrl: params.receiverSignatureImageUrl.trim() }
      : {}),
    ...(params.companyStampImageUrl?.trim()
      ? { companyStampImageUrl: params.companyStampImageUrl.trim() }
      : {}),
  };

  const cashbookGrossRow: Record<string, unknown> = {
    entryNo: cashbookEntryNo,
    bankAccountId: bankId,
    entryDate,
    direction: 'IN' as const,
    entryType: 'CUSTOMER_RECEIPT' as const,
    referenceType: 'RECEIPT' as const,
    referenceId: receiptRef.id,
    amount: gross,
    description: desc,
    paymentMethod: 'TRANSFER' as const,
    customerReceiptLineRole: 'GROSS_IN',
    grossReceiptAmount: gross,
    createdAt: now,
    updatedAt: now,
  };
  if (wht > 0.005) cashbookGrossRow.customerWithholdingAmount = wht;
  if (feeTotal > 0.005) cashbookGrossRow.bankFeeTotalAmount = feeTotal;

  const batch = writeBatch(db);
  batch.set(receiptRef, receiptRow);
  batch.set(cashbookRef, cashbookGrossRow);

  if (whtCashbookRef && whtEntryNo && wht > 0.005) {
    batch.set(whtCashbookRef, {
      entryNo: whtEntryNo,
      bankAccountId: bankId,
      entryDate,
      direction: 'OUT' as const,
      entryType: 'TAX' as const,
      referenceType: 'RECEIPT' as const,
      referenceId: receiptRef.id,
      amount: wht,
      description: `ลูกค้าหักภาษี ณ ที่จ่าย · ใบเสร็จ ${receiptNo} (ใบกำกับ ${inv.taxInvoiceNo})`.slice(0, 500),
      paymentMethod: 'TRANSFER' as const,
      customerReceiptLineRole: 'CUSTOMER_WHT_OUT',
      customerWithholdingAmount: wht,
      createdAt: now,
      updatedAt: now,
    });
  }

  fees.forEach((fee, idx) => {
    const feeRef = feeCashbookRefs[idx];
    const feeNo = feeEntryNos[idx];
    if (!feeRef || !feeNo) return;
    batch.set(feeRef, {
      entryNo: feeNo,
      bankAccountId: bankId,
      entryDate,
      direction: 'OUT' as const,
      entryType: 'OTHER' as const,
      referenceType: 'RECEIPT' as const,
      referenceId: receiptRef.id,
      amount: fee.amount,
      description: `${fee.label} · ใบเสร็จ ${receiptNo} (ใบกำกับ ${inv.taxInvoiceNo})`.slice(0, 500),
      paymentMethod: 'TRANSFER' as const,
      customerReceiptLineRole: 'BANK_FEE_OUT',
      createdAt: now,
      updatedAt: now,
    });
  });

  /** ยอดเข้าบัญชีจริง = รับตามใบกำกับ − WHT − ค่าธรรมเนียม */
  batch.update(bankRef, {
    currentBalance: increment(bankNet),
    updatedAt: now,
  });
  batch.update(taxRef, {
    paymentReceivedConfirmedAt: now,
    paymentReceivedConfirmedByUid: actor.id,
    paymentReceivedConfirmedByName: actor.displayName,
    linkedReceiptId: receiptRef.id,
    paymentReceivedCashbookEntryId: cashbookRef.id,
    paymentReceivedBankAccountId: bankId,
    ...(resolvedArEntryId && resolvedArEntryId !== inv.arEntryId?.trim()
      ? { arEntryId: resolvedArEntryId }
      : {}),
    updatedAt: now,
  });
  if (arUpdate) {
    batch.update(arUpdate.ref, asFirestoreUpdate(arUpdate.patch));
  }
  await closeOpenCommercialArInBatch(db, batch, inv.sourceCommercialInvoiceId, now);

  await batch.commit();

  return {
    receiptId: receiptRef.id,
    receiptNo,
    cashbookEntryId: cashbookRef.id,
    cashbookEntryNo: cashbookEntryNo,
    bankNetAmount: bankNet,
  };
}
