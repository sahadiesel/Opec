/**
 * สร้าง snapshot เอกสารหนังสือรับรองหัก ณ ที่จ่ายจากใบวางบิล / PO / cashbook (source of truth)
 */

import {
  roundMoney2,
  supplierWithholdingOnMilestone,
  effectiveVendorBillWhtRatePercent,
} from '@/lib/ops/purchase-payment-milestones';
import type {
  BankAccount,
  CashbookEntry,
  PaymentMethod,
  Purchase,
  PurchasePaymentMilestone,
  PurchaseVendorBill,
  Vendor,
  VendorType,
  WithholdingCertificateDocument,
  WhtElectronicData,
  WhtIncomeTypeCode,
  WhtTaxCondition,
  WhtWithholdingFormType,
} from '@/lib/types';
import { stripUndefinedForFirestore as stripFirestoreUndefined } from '@/lib/firestore/strip-undefined-for-firestore';

/** Re-export ให้ import เดิมจากโมดูลนี้ยังใช้ได้ */
export { stripUndefinedForFirestore } from '@/lib/firestore/strip-undefined-for-firestore';

/** อ่านจาก system/company_profile — ขยายฟิลด์ได้โดยไม่บังคับทุก key */
export type CompanyProfileWhtInput = {
  companyNameTh?: string;
  companyNameEn?: string;
  taxId?: string;
  branchType?: 'head_office' | 'branch';
  branchNo?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressEnLine1?: string;
  addressEnLine2?: string;
  phone?: string;
  email?: string;
  taxpayerType?: 'COMPANY' | 'PERSON' | 'OTHER';
  whtCertificateDisplay?: {
    showSignatureImage?: boolean;
    showCompanyStamp?: boolean;
    showSystemGeneratedNote?: boolean;
    authorizedSignerName?: string;
    signerPosition?: string;
    signatureImageUrl?: string;
    companyStampImageUrl?: string;
  };
};

function joinAddr(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ').trim();
}

function vendorPayeeCategory(v: Vendor): WithholdingCertificateDocument['payee']['vendorCategory'] {
  const t = (v.taxId || '').replace(/\s/g, '');
  if (!t) return 'OTHER';
  /** ตัวอย่าง heuristic ต่างชาติ — ปรับได้เมื่อมีฟิลด์ประเทศชัดเจน */
  if (t.length !== 13) return 'FOREIGN';
  return 'COMPANY';
}

function incomeFromPurchase(purchase: Purchase): {
  code: WhtIncomeTypeCode;
  displayTh: string;
} {
  if (purchase.purchaseLineMode === 'SERVICE') {
    return { code: 'SERVICE_CONTRACT', displayTh: 'ค่าจ้างเหมา / ค่าบริการ' };
  }
  return { code: 'GOODS_MANUFACTURING', displayTh: 'ค่าจ้างทำของ' };
}

function mapVendorTypeToPayee(vt: VendorType | undefined): WithholdingCertificateDocument['payee']['vendorCategory'] {
  /** ทะเบียนคู่ค้าไทยส่วนใหญ่เป็นนิติบุคคล — INDIVIDUAL เมื่อมีฟิลด์แยกภายหลัง */
  switch (vt) {
    default:
      return 'COMPANY';
  }
}

export function buildWhtElectronicDataFromDocument(
  d: Pick<
    WithholdingCertificateDocument,
    | 'certificateNo'
    | 'paymentIssueDate'
    | 'paymentDate'
    | 'payer'
    | 'payee'
    | 'incomeTypeCode'
    | 'incomeTypeDisplayTh'
    | 'withholdingFormType'
    | 'withholdingTaxRatePercent'
    | 'withholdingTaxBase'
    | 'withholdingTaxAmount'
    | 'taxCondition'
    | 'paymentMethod'
    | 'sendingBankName'
    | 'paymentReferenceNo'
    | 'referenceTaxInvoiceNo'
    | 'referenceVendorBillNo'
    | 'referencePurchaseNo'
  >,
): WhtElectronicData {
  return {
    documentTypeCode: 'WHT50_TW',
    documentNo: d.certificateNo,
    issueDate: d.paymentIssueDate,
    paymentDate: d.paymentDate,
    payerTaxId: d.payer.taxId,
    payerBranchNo: d.payer.branchType === 'BRANCH' ? d.payer.branchNo : undefined,
    payerName: d.payer.legalNameTh,
    payerAddress: d.payer.addressTh,
    payeeTaxId: d.payee.taxId,
    payeeBranchNo: d.payee.branchType === 'BRANCH' ? d.payee.branchNo : undefined,
    payeeName: d.payee.displayName,
    payeeAddress: d.payee.addressTh,
    incomeTypeCode: d.incomeTypeCode,
    incomeTypeName: d.incomeTypeDisplayTh,
    formTypeCode: d.withholdingFormType,
    withholdingTaxRate: d.withholdingTaxRatePercent,
    withholdingTaxBase: d.withholdingTaxBase,
    withholdingTaxAmount: d.withholdingTaxAmount,
    taxConditionCode: d.taxCondition,
    paymentMethodCode: d.paymentMethod,
    sendingBankName: d.sendingBankName,
    bankReferenceNo: d.paymentReferenceNo,
    sourceInvoiceNo: d.referencePurchaseNo,
    sourceBillNo: d.referenceVendorBillNo,
    currencyCode: 'THB',
    exchangeRate: 1,
    xmlExportStatus: 'NOT_EXPORTED',
  };
}

export interface BuildWhtDraftParams {
  bill: PurchaseVendorBill;
  purchase: Purchase;
  vendor: Vendor;
  company: CompanyProfileWhtInput | null | undefined;
  milestone: PurchasePaymentMilestone | null | undefined;
  cashbook: CashbookEntry | null | undefined;
  bank: BankAccount | null | undefined;
  paymentDateYmd: string;
  paymentIssueDateYmd: string;
  paymentMethod: PaymentMethod;
  taxCondition?: WhtTaxCondition;
  withholdingFormType?: WhtWithholdingFormType;
  sourceWithholdingAtSourceItemId?: string;
}

/** สร้างเอกสารฉบับร่าง (ยังไม่มีเลขที่ certificate) */
export function buildWithholdingCertificateDraft(params: BuildWhtDraftParams): Omit<WithholdingCertificateDocument, 'id'> {
  const {
    bill,
    purchase,
    vendor,
    company,
    milestone,
    cashbook,
    bank,
    paymentDateYmd,
    paymentIssueDateYmd,
    paymentMethod,
    taxCondition = 'WITHHOLDING',
    withholdingFormType = 'PND53',
    sourceWithholdingAtSourceItemId,
  } = params;

  const grossInclVat =
    milestone != null
      ? roundMoney2(Number(milestone.amount) || 0)
      : roundMoney2(Number(bill.billAmount ?? purchase.totalAmount) || 0);

  const rate = effectiveVendorBillWhtRatePercent(bill, purchase);
  const wh = supplierWithholdingOnMilestone(grossInclVat, rate, purchase);
  const baseBeforeVat = wh.baseBeforeVat;
  const vatAmount = roundMoney2(grossInclVat - baseBeforeVat);

  const income = incomeFromPurchase(purchase);

  const payerBranchIsHead = company?.branchType !== 'branch';
  const payeeBranchIsHead = vendor.branchType !== 'branch';

  const disp = company?.whtCertificateDisplay;

  const payer = {
    legalNameTh: (company?.companyNameTh || '').trim() || '—',
    legalNameEn: (company?.companyNameEn || '').trim() || undefined,
    taxId: (company?.taxId || '').trim(),
    branchType: payerBranchIsHead ? ('HEAD_OFFICE' as const) : ('BRANCH' as const),
    branchNo: payerBranchIsHead ? undefined : (company?.branchNo || '').trim() || undefined,
    addressTh: joinAddr(company?.addressLine1, company?.addressLine2) || '—',
    addressEn: joinAddr(company?.addressEnLine1, company?.addressEnLine2) || undefined,
    phone: (company?.phone || '').trim() || undefined,
    email: (company?.email || '').trim() || undefined,
    taxpayerType: company?.taxpayerType ?? 'COMPANY',
  };

  const payeeCat = vendorPayeeCategory(vendor);
  const payee = {
    displayName: (vendor.vendorName || '').trim() || '—',
    taxId: (vendor.taxId || '').trim() || undefined,
    branchType: payeeBranchIsHead ? ('HEAD_OFFICE' as const) : ('BRANCH' as const),
    branchNo: payeeBranchIsHead ? undefined : (vendor.branchNo || '').trim() || undefined,
    addressTh: (vendor.address || '').trim() || '—',
    addressEn: undefined,
    vendorCategory: payeeCat === 'OTHER' ? mapVendorTypeToPayee(vendor.vendorType) : payeeCat,
    countryCode: 'TH',
  };

  const bankLast4 = bank?.accountNumber ? String(bank.accountNumber).replace(/\s/g, '').slice(-4) : undefined;
  const bankName = bank?.bankName?.trim();

  const jobDescription = [
    milestone?.label ? `งวดชำระ: ${milestone.label}` : '',
    purchase.notes ? `หมายเหตุ PO: ${purchase.notes}` : '',
    bill.notes ? `ใบวางบิล: ${bill.notes}` : '',
  ]
    .filter(Boolean)
    .join(' · ') || '—';

  const now = Date.now();

  const core: Omit<WithholdingCertificateDocument, 'id' | 'whtElectronicData'> & {
    whtElectronicData: WhtElectronicData;
  } = {
    documentStatus: 'DRAFT',
    xmlExportStatus: 'NOT_EXPORTED',
    taxCondition,
    incomeTypeCode: income.code,
    incomeTypeDisplayTh: income.displayTh,
    withholdingIncomeCode: income.code,
    formTypeCode: withholdingFormType,
    withholdingFormType,
    payer,
    payee,
    amountBeforeVat: baseBeforeVat,
    vatAmount,
    grossAmount: grossInclVat,
    withholdingTaxBase: baseBeforeVat,
    withholdingTaxRatePercent: rate,
    withholdingTaxAmount: wh.wht,
    netPaidAmount: wh.netPaid,
    paymentDate: paymentDateYmd,
    paymentIssueDate: paymentIssueDateYmd,
    paymentMethod,
    bankName,
    bankAccountLast4: bankLast4,
    sendingBankName: bankName,
    paymentReferenceNo: cashbook?.entryNo,
    referenceVendorBillNo: (bill.receiptNo || '').trim() || bill.id,
    referencePurchaseNo: purchase.purchaseNo,
    referenceTaxInvoiceNo: undefined,
    referencePaymentNo: cashbook?.entryNo,
    jobDescription,
    sourceVendorBillId: bill.id,
    sourcePurchaseId: purchase.id,
    sourceCashbookEntryId: bill.cashbookEntryId || cashbook?.id,
    sourceWithholdingAtSourceItemId,
    authorizedSignerName: disp?.authorizedSignerName,
    signerPosition: disp?.signerPosition,
    signatureImageUrl: disp?.showSignatureImage ? disp?.signatureImageUrl : undefined,
    companyStampImageUrl: disp?.showCompanyStamp ? disp?.companyStampImageUrl : undefined,
    createdAt: now,
    createdByUid: '',
    updatedAt: now,
    whtElectronicData: {},
  };

  const electronic = buildWhtElectronicDataFromDocument({
    ...core,
    certificateNo: undefined,
  });
  core.whtElectronicData = { ...electronic, xmlExportStatus: 'NOT_EXPORTED', currencyCode: 'THB', exchangeRate: 1 };

  return stripFirestoreUndefined(core);
}
