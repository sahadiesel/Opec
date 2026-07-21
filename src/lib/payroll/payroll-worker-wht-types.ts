/**
 * หนังสือรับรองหัก ณ ที่จ่ายจาก Payroll (ลูกจ้าง) — แยกจาก vendor WHT
 * Collection แนะนำ: payroll_wht_certificates (บันทึกเมื่อ workflow ออกเอกสารจริงในอนาคต)
 */

import type { PaymentMethod, WithholdingCertificateCopyVariant, WhtTaxCondition } from '@/lib/types';

/** Snapshot บริษัทจาก system/company_profile — ตรงกับหน้า Document Header Profile */
export type CompanyDocumentProfileForPayrollWht = {
  companyNameTh?: string;
  companyNameEn?: string;
  taxId?: string;
  branchType?: 'head_office' | 'branch';
  branchNo?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  documentHeaderLogoUrl?: string | null;
  documentHeaderStampUrl?: string | null;
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

/** Payload ภายในเตรียมส่งออก XML — ไม่ใช่แบบฟอร์มกรมสรรพากรทางการ */
export type PayrollWhtElectronicPayload = {
  documentTypeCode: 'PAYROLL_WHT_CERTIFICATE';
  documentNo: string;
  issueDate: string;
  paymentDate: string;
  payerTaxId: string;
  payerBranchNo: string;
  payerName: string;
  payerAddress: string;
  payeeTaxIdOrIdCard: string;
  payeePassportNo?: string;
  payeeName: string;
  payeeAddress: string;
  incomeTypeCode: string;
  incomeTypeName: string;
  formTypeCode: 'PND1' | 'PND2';
  withholdingTaxBase: number;
  withholdingTaxAmount: number;
  taxConditionCode: WhtTaxCondition;
  payrollBatchNo: string;
  payrollPeriod: string;
  currencyCode: 'THB';
  exchangeRate: 1;
  xmlExportStatus: 'NOT_EXPORTED' | 'READY_FOR_EXPORT' | 'EXPORTED_XML';
  xmlGeneratedAt?: number;
  xmlGeneratedBy?: string;
};

export type PayrollWorkerWhtPrintVm = {
  documentNo: string;
  issueDateYmd: string;
  paymentDateYmd: string;
  payrollPeriodLabel: string;
  batchReference: string;
  subtitleTh: string;

  payer: {
    legalNameTh: string;
    legalNameEn?: string;
    taxId: string;
    branchIsHeadOffice: boolean;
    branchNo?: string;
    addressTh: string;
    addressEn?: string;
    phone?: string;
    email?: string;
    taxpayerType: 'LEGAL_ENTITY';
  };

  payee: {
    displayName: string;
    workerCode: string;
    /** เลขที่แสดงในช่องผู้ถูกหัก — ปชช. หรือ Passport */
    taxIdDisplay: string;
    taxIdIsPassport: boolean;
    nationality?: string;
    positionLabel?: string;
    addressTh?: string;
    bankName?: string;
    bankAccountLast4?: string;
  };

  incomeTypeCode: 'PAYROLL_WAGE' | 'MEETING_ALLOWANCE' | 'DIVIDEND' | 'OTHER';
  incomeTypeNameTh: string;
  formTypeCode: 'PND1' | 'PND2';

  earningsRows: Array<{ label: string; amount: number }>;
  deductionsRows: Array<{ label: string; amount: number }>;

  grossAmount: number;
  totalDeductions: number;
  netPaidAmount: number;

  /** fallback only; payroll taxable base should be mapped explicitly later — ใช้ gross จาก D8/slip เมื่อไม่มีฟิลด์เฉพาะ */
  taxableIncomeAmount: number;
  withholdingTaxAmount: number;
  withholdingTaxRateDisplayTh: string;
  withholdingTaxWordsTh: string;
  pitZeroNote?: string;

  taxCondition: WhtTaxCondition;
  paymentMethod: PaymentMethod;
  paymentReferenceNo: string;

  authorizedSignerName?: string;
  signerPosition?: string;
  signatureImageUrl?: string;
  companyStampImageUrl?: string;
  issuedByName?: string;

  documentStatusLabel: 'PREVIEW' | 'ISSUED';
  xmlExportStatus: PayrollWhtElectronicPayload['xmlExportStatus'];
};

export type PayrollWorkerWhtValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

/** สำหรับสรุป batch preview */
export type PayrollWorkerWhtLinePrep = {
  lineId: string;
  workerId: string;
  workerNameSnapshot: string;
  vm: PayrollWorkerWhtPrintVm | null;
  validation: PayrollWorkerWhtValidationResult;
};
