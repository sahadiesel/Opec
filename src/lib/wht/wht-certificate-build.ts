/**
 * สร้าง snapshot เอกสารหนังสือรับรองหัก ณ ที่จ่ายจากใบวางบิล / PO / cashbook (source of truth)
 */

import {
  roundMoney2,
  effectiveVendorBillWhtRatePercent,
  resolveVendorBillVatAmounts,
  supplierWithholdingOnVendorBill,
} from '@/lib/ops/purchase-payment-milestones';
import type {
  BankAccount,
  CashbookEntry,
  PaymentMethod,
  Purchase,
  PurchasePaymentMilestone,
  PurchaseVendorBill,
  Vendor,
  VendorBillWhtPresetCategory,
  VendorType,
  WithholdingCertificateDocument,
  WhtElectronicData,
  WhtIncomeTypeCode,
  WhtTaxCondition,
  WhtWithholdingFormType,
} from '@/lib/types';
import { stripUndefinedForFirestore as stripFirestoreUndefined } from '@/lib/firestore/strip-undefined-for-firestore';
import {
  whtCertificateEnglishLeadFromMixed,
  whtCertificateThaiAddressDisplay,
} from '@/lib/wht/wht-address-display';

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

function payerAddressesForWhtCertificate(
  company: CompanyProfileWhtInput | null | undefined,
): { addressTh: string; addressEn?: string } {
  const rawBlock = joinAddr(company?.addressLine1, company?.addressLine2);
  const explicitEn = joinAddr(company?.addressEnLine1, company?.addressEnLine2);
  const addressTh = whtCertificateThaiAddressDisplay(rawBlock);
  const enFromMixed = whtCertificateEnglishLeadFromMixed(rawBlock);
  const mergedEn = explicitEn.trim() || enFromMixed;
  return { addressTh, addressEn: mergedEn.trim() || undefined };
}

function vendorAddressForWhtCertificate(address: string | undefined): {
  addressTh: string;
  addressEn?: string;
} {
  const raw = (address || '').trim();
  if (!raw) return { addressTh: '—' };
  const addressTh = whtCertificateThaiAddressDisplay(raw);
  const enMix = whtCertificateEnglishLeadFromMixed(raw);
  return {
    addressTh,
    ...(enMix ? { addressEn: enMix } : {}),
  };
}

function isVendorNaturalPerson(v: Pick<Vendor, 'vendorLegalForm'>): boolean {
  return v.vendorLegalForm === 'NATURAL';
}

function vendorPayeeCategory(v: Vendor): WithholdingCertificateDocument['payee']['vendorCategory'] {
  const t = (v.taxId || '').replace(/\s/g, '');
  if (!t) return 'OTHER';
  if (isVendorNaturalPerson(v)) {
    if (t.length !== 13) return 'FOREIGN';
    return 'INDIVIDUAL';
  }
  /** ตัวอย่าง heuristic ต่างชาติ — ปรับได้เมื่อมีฟิลด์ประเทศชัดเจน */
  if (t.length !== 13) return 'FOREIGN';
  return 'COMPANY';
}

function incomeFromPurchase(purchase: Purchase): {
  code: WhtIncomeTypeCode;
  displayTh: string;
} {
  const fromCat = incomeFromWhtCategory(purchase.supplierWithholdingCategory);
  if (fromCat) return fromCat;
  if (purchase.purchaseLineMode === 'SERVICE') {
    return { code: 'SERVICE_CONTRACT', displayTh: 'ค่าจ้างเหมา / ค่าบริการ' };
  }
  return { code: 'GOODS_MANUFACTURING', displayTh: 'ค่าจ้างทำของ' };
}

function incomeFromWhtCategory(
  cat: VendorBillWhtPresetCategory | undefined | null,
): { code: WhtIncomeTypeCode; displayTh: string } | null {
  if (cat === 'TRANSPORT_FREIGHT') {
    return { code: 'OTHER', displayTh: 'ค่าขนส่ง' };
  }
  if (cat === 'CONTRACT') {
    return { code: 'SERVICE_CONTRACT', displayTh: 'ค่าจ้างเหมา' };
  }
  if (cat === 'SERVICE') {
    return { code: 'SERVICE_CONTRACT', displayTh: 'ค่าบริการ' };
  }
  if (cat === 'RENT') {
    return { code: 'OTHER', displayTh: 'ค่าเช่า' };
  }
  return null;
}

/** ข้อความและรหัสประเภทเงินได้บนใบหัก ม.50 — เลือกจากใบวางบิล → ประเภทบน PO → สันนิษฐานจากโหมด PO */
export function incomeTypeForVendorBillWht(
  bill: Pick<PurchaseVendorBill, 'vendorBillWhtPresetCategory'>,
  purchase: Purchase,
): { code: WhtIncomeTypeCode; displayTh: string } {
  const fromBill = incomeFromWhtCategory(bill.vendorBillWhtPresetCategory);
  if (fromBill) return fromBill;
  return incomeFromPurchase(purchase);
}

function mapVendorTypeToPayee(vt: VendorType | undefined): WithholdingCertificateDocument['payee']['vendorCategory'] {
  /** ทะเบียนคู่ค้าไทยส่วนใหญ่เป็นนิติบุคคล — INDIVIDUAL เมื่อมีฟิลด์แยกภายหลัง */
  switch (vt) {
    default:
      return 'COMPANY';
  }
}

export function buildWhtPayerSnapshotFromCompany(
  company: CompanyProfileWhtInput | null | undefined,
): WithholdingCertificateDocument['payer'] {
  const payerBranchIsHead = company?.branchType !== 'branch';
  const payerAddr = payerAddressesForWhtCertificate(company ?? undefined);
  return {
    legalNameTh: (company?.companyNameTh || '').trim() || '—',
    legalNameEn: (company?.companyNameEn || '').trim() || undefined,
    taxId: (company?.taxId || '').trim(),
    branchType: payerBranchIsHead ? ('HEAD_OFFICE' as const) : ('BRANCH' as const),
    branchNo: payerBranchIsHead ? undefined : (company?.branchNo || '').trim() || undefined,
    addressTh: payerAddr.addressTh,
    addressEn: payerAddr.addressEn,
    phone: (company?.phone || '').trim() || undefined,
    email: (company?.email || '').trim() || undefined,
    taxpayerType: company?.taxpayerType ?? 'COMPANY',
  };
}

export function buildWhtPayeeSnapshotFromVendor(vendor: Vendor): WithholdingCertificateDocument['payee'] {
  const payeeBranchIsHead = isVendorNaturalPerson(vendor) || vendor.branchType !== 'branch';
  const payeeCat = vendorPayeeCategory(vendor);
  const payeeAddr = vendorAddressForWhtCertificate(vendor.address);
  return {
    displayName: (vendor.vendorName || '').trim() || '—',
    taxId: (vendor.taxId || '').trim() || undefined,
    branchType: payeeBranchIsHead ? ('HEAD_OFFICE' as const) : ('BRANCH' as const),
    branchNo: payeeBranchIsHead ? undefined : (vendor.branchNo || '').trim() || undefined,
    addressTh: payeeAddr.addressTh,
    addressEn: payeeAddr.addressEn,
    vendorCategory: payeeCat === 'OTHER' ? mapVendorTypeToPayee(vendor.vendorType) : payeeCat,
    countryCode: 'TH',
  };
}

/** อัปเดต snapshot ผู้จ่าย/ผู้ถูกหัก + ข้อมูลพิมพ์/XML จากทะเบียนปัจจุบัน — ไม่แตะยอดเงิน เลขที่ หรือสถานะเอกสาร */
export function refreshWhtCertificateMasterDataPatch(params: {
  existing: WithholdingCertificateDocument;
  vendor: Vendor;
  company: CompanyProfileWhtInput | null | undefined;
}): Partial<WithholdingCertificateDocument> {
  const { existing, vendor, company } = params;
  const payer = buildWhtPayerSnapshotFromCompany(company);
  const payee = buildWhtPayeeSnapshotFromVendor(vendor);
  const disp = company?.whtCertificateDisplay;

  const mergedForElectronic: WithholdingCertificateDocument = {
    ...existing,
    payer,
    payee,
  };

  const electronic = buildWhtElectronicDataFromDocument({
    ...mergedForElectronic,
    certificateNo: existing.certificateNo,
    paymentIssueDate: existing.paymentIssueDate,
  });

  const hadExportedXml =
    existing.xmlExportStatus === 'EXPORTED_XML' ||
    existing.whtElectronicData?.xmlExportStatus === 'EXPORTED_XML';

  const patch: Partial<WithholdingCertificateDocument> = {
    payer,
    payee,
    authorizedSignerName: disp?.authorizedSignerName,
    signerPosition: disp?.signerPosition,
    signatureImageUrl: disp?.showSignatureImage ? disp?.signatureImageUrl : undefined,
    companyStampImageUrl: disp?.showCompanyStamp ? disp?.companyStampImageUrl : undefined,
    whtElectronicData: stripFirestoreUndefined({
      ...existing.whtElectronicData,
      ...electronic,
      xmlExportStatus: hadExportedXml ? 'NOT_EXPORTED' : existing.whtElectronicData?.xmlExportStatus ?? 'NOT_EXPORTED',
      xmlGeneratedAt: hadExportedXml ? undefined : existing.whtElectronicData?.xmlGeneratedAt,
      xmlGeneratedBy: hadExportedXml ? undefined : existing.whtElectronicData?.xmlGeneratedBy,
    }),
  };

  if (hadExportedXml) {
    patch.xmlExportStatus = 'NOT_EXPORTED';
  }

  const payeeTax = (payee.taxId || '').trim();
  if (payeeTax && /^\d{13}$/.test(payeeTax)) {
    patch.payeeTaxIdMissingOverride = false;
    patch.payeeTaxIdMissingReason = null;
  }

  return stripFirestoreUndefined(patch);
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
    payerAddress: whtCertificateThaiAddressDisplay(d.payer.addressTh),
    payeeTaxId: d.payee.taxId,
    payeeBranchNo: d.payee.branchType === 'BRANCH' ? d.payee.branchNo : undefined,
    payeeName: d.payee.displayName,
    payeeAddress: whtCertificateThaiAddressDisplay(d.payee.addressTh),
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
  const wh = supplierWithholdingOnVendorBill(grossInclVat, rate, purchase, bill.billVatTreatment, bill);
  const withholdingTaxBase = wh.baseBeforeVat;
  const { beforeTax: billAmountBeforeVat, vat: vatAmount, gross: billGrossInclVat } = resolveVendorBillVatAmounts(
    grossInclVat,
    bill.billVatTreatment,
    purchase,
  );

  const income = incomeTypeForVendorBillWht(bill, purchase);

  const disp = company?.whtCertificateDisplay;
  const payer = buildWhtPayerSnapshotFromCompany(company);
  const payee = buildWhtPayeeSnapshotFromVendor(vendor);

  const bankLast4 = bank?.accountNumber ? String(bank.accountNumber).replace(/\s/g, '').slice(-4) : undefined;
  const bankName = bank?.bankName?.trim();

  /** ช่อง «รายละเอียดงาน / บริการ» — ถ้ามี preset ค่าขนส่ง/บริการ/เช่า ให้แสดงชัดในเอกสาร */
  const jobDetailTail = [
    milestone?.label ? `งวดชำระ: ${milestone.label}` : '',
    purchase.notes ? `หมายเหตุ PO: ${purchase.notes}` : '',
    bill.notes ? `ใบวางบิล: ${bill.notes}` : '',
  ].filter(Boolean);

  const presetCat = bill.vendorBillWhtPresetCategory ?? purchase.supplierWithholdingCategory;
  const hasWhtIncomePreset =
    presetCat === 'TRANSPORT_FREIGHT' ||
    presetCat === 'CONTRACT' ||
    presetCat === 'SERVICE' ||
    presetCat === 'RENT';

  const jobDescriptionParts: string[] = [];
  if (hasWhtIncomePreset) {
    jobDescriptionParts.push(income.displayTh);
  }
  jobDescriptionParts.push(...jobDetailTail);

  const jobDescription =
    jobDescriptionParts.filter(Boolean).join(' · ') ||
    jobDetailTail.join(' · ') ||
    income.displayTh.trim() ||
    '—';

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
    amountBeforeVat: billAmountBeforeVat,
    vatAmount,
    grossAmount: billGrossInclVat,
    withholdingTaxBase,
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
