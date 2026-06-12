'use client';

import { Firestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { recordCashbookMovementWithBalance } from '@/lib/services/cashbook-bank-movement';
import {
  isVendorWhtSourcePaid,
  isVendorWhtTaxRemitted,
} from '@/lib/wht/vendor-wht-tax-payment-model';
import type { User, WithholdingCertificateDocument, WhtTaxPaymentProofAttachment } from '@/lib/types';

function mergeWhtTaxProofAttachments(
  existing: WhtTaxPaymentProofAttachment[] | undefined,
  incoming: WhtTaxPaymentProofAttachment[] | undefined,
): WhtTaxPaymentProofAttachment[] {
  const merged = [...(existing ?? [])];
  for (const a of incoming ?? []) {
    if (!merged.some((x) => x.id === a.id)) merged.push(a);
  }
  return merged;
}

export async function recordVendorWhtTaxPayment(
  db: Firestore,
  user: User,
  params: {
    doc: WithholdingCertificateDocument;
    taxAmount: number;
    bankAccountId: string;
    entryDate: string;
    proofAttachments?: WhtTaxPaymentProofAttachment[];
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const { doc: whtDoc } = params;
  if (!isVendorWhtSourcePaid(whtDoc)) {
    throw new Error('ยังไม่ได้จ่ายคู่ค้า/ยังไม่ออกหนังสือรับรอง — ไม่สามารถจ่ายภาษีหัก ณ ที่จ่ายได้');
  }
  if (isVendorWhtTaxRemitted(whtDoc)) {
    throw new Error('รายการนี้จ่ายภาษีหัก ณ ที่จ่ายแล้ว');
  }

  const amount = Number(params.taxAmount);
  if (!amount || amount <= 0) {
    throw new Error('ยอดภาษีหัก ณ ที่จ่ายไม่ถูกต้อง');
  }

  const bankAccountId = params.bankAccountId?.trim();
  if (!bankAccountId) throw new Error('กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่ายภาษี');

  const bankSnap = await getDoc(doc(db, 'bank_accounts', bankAccountId));
  const bankCode = bankSnap.exists()
    ? String(bankSnap.data()?.accountCode ?? '').trim() || bankAccountId
    : bankAccountId;

  const vendor = (whtDoc.payee?.displayName || whtDoc.referenceVendorBillNo || whtDoc.id || '').trim() || 'คู่ค้า';
  const certNo = whtDoc.certificateNo?.trim() || whtDoc.id;
  const description = `จ่ายภาษีหัก ณ ที่จ่าย (ภงด.53) คู่ค้า ${vendor} · ${certNo} · ตัดจากบัญชี ${bankCode}`;

  const { cashbookEntryId, entryNo } = await recordCashbookMovementWithBalance(db, user, {
    bankAccountId,
    direction: 'OUT',
    amount,
    entryDate: params.entryDate,
    description,
    paymentMethod: 'TRANSFER',
    entryType: 'TAX',
    referenceType: 'OTHER',
    referenceId: whtDoc.id,
  });

  const now = Date.now();
  await updateDoc(doc(db, 'withholding_certificate_documents', whtDoc.id), {
    whtTaxCashbookEntryId: cashbookEntryId,
    whtTaxCashbookEntryNo: entryNo,
    whtTaxPaidAt: now,
    whtTaxPaidByUid: user.id,
    whtTaxPaidByName: user.displayName || user.email || user.id,
    whtTaxPaymentBankAccountId: bankAccountId,
    whtTaxPaymentProofAttachments: mergeWhtTaxProofAttachments(
      whtDoc.whtTaxPaymentProofAttachments,
      params.proofAttachments,
    ),
    updatedAt: now,
    updatedByUid: user.id,
    updatedByName: user.displayName || user.email || user.id,
  });

  return { cashbookEntryId, entryNo };
}
