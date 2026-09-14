import type { PaymentMethod } from './accounting';

/** Domain types: tax (from master types.ts split). */

/** หลักฐานการโอนภาษีหัก ณ ที่จ่าย (ภงด.1) — แนบตอนจ่ายภาษี */
export interface WhtTaxPaymentProofAttachment {
  id: string;
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  contentType?: string;
  uploadedAt: number;
  uploadedByUid?: string;
  uploadedByName?: string;
  /** YYYY-MM ของงวด/เดือนที่จ่ายภาษี — ใช้กรองแสดงตามเดือนที่เลือก */
  periodYm?: string;
}

/** รายการหัก ณ ที่จ่าย (ผู้รับเงิน) — สะสมเพื่อสรุปนำส่งสรรพากร ไม่ตัดบัญชีธนาคารตอนจ่ายคู่ค้า */
export type WithholdingAtSourceStatus = 'OUTSTANDING' | 'REMITTED' | 'VOID';

export interface WithholdingAtSourceItem {
  id: string;
  vendorId: string;
  vendorName?: string;
  purchaseId: string;
  purchaseNo?: string;
  vendorBillId: string;
  receiptNo?: string;
  milestoneId?: string;
  /** แบ่งจ่ายหลายงวดในใบเดียว — อ้าง installment ที่จ่ายครั้งนี้ */
  installmentId?: string;
  /** ยอดงวดรวม VAT (ก่อนหัก) */
  grossPaymentAmount: number;
  baseBeforeVat: number;
  whtAmount: number;
  ratePercent: number;
  status: WithholdingAtSourceStatus;
  cashbookEntryId: string;
  cashbookEntryNo: string;
  entryDate: string;
  remittedAt?: number;
  remittedNote?: string;
  createdAt: number;
  updatedAt: number;
  /** แหล่งที่มาจากสัญญาเช่า (ถ้ามี) */
  sourceRentalContractId?: string;
  sourceRentalPayableId?: string;
}

/** หนังสือรับรองหัก ณ ที่จ่าย ม.50 ทวิ — สถานะเอกสารหลัก */

export type WithholdingCertificateDocumentStatus = 'DRAFT' | 'VERIFIED' | 'ISSUED' | 'CANCELLED' | 'REPLACED';

/** สถานะเตรียมส่งอิเล็กทรอนิกส์ / XML (ยังไม่ผูกกรมสรรพากรจริง) */

export type WithholdingCertificateXmlExportStatus =
  | 'NOT_EXPORTED'
  | 'READY_FOR_EXPORT'
  | 'EXPORTED_XML'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'REJECTED';

/** ประเภทสำเนาเอกสารตามแบบใช้งาน */

export type WithholdingCertificateCopyVariant =
  | 'COPY_PAYEE_TAX_RETURN'
  | 'COPY_PAYEE_RECORD'
  | 'COPY_PAYER_RECORD';

/** เงื่อนไขการหักภาษี (แสดงเป็น checkbox ใน PDF) */

export type WhtTaxCondition =
  | 'WITHHOLDING'
  | 'TAX_PAID_BY_PAYER_ONE_TIME'
  | 'TAX_PAID_BY_PAYER_FOREVER'
  | 'OTHER';

/** รหัสประเภทเงินได้ภายในระบบ (mapping XML / e-Withholding ภายหลัง) */

export type WhtIncomeTypeCode = 'GOODS_MANUFACTURING' | 'SERVICE_CONTRACT' | 'OTHER';

/** แบบภาษีหัก ณ ที่จ่ายที่อ้างอิงในเอกสาร */

export type WhtWithholdingFormType = 'PND3' | 'PND53';

export interface WhtElectronicData {
  documentTypeCode?: string;
  documentNo?: string;
  issueDate?: string;
  paymentDate?: string;
  payerTaxId?: string;
  payerBranchNo?: string;
  payerName?: string;
  payerAddress?: string;
  payeeTaxId?: string;
  payeeBranchNo?: string;
  payeeName?: string;
  payeeAddress?: string;
  incomeTypeCode?: string;
  incomeTypeName?: string;
  formTypeCode?: string;
  withholdingTaxRate?: number;
  withholdingTaxBase?: number;
  withholdingTaxAmount?: number;
  taxConditionCode?: string;
  paymentMethodCode?: string;
  sendingBankName?: string;
  bankReferenceNo?: string;
  sourceInvoiceNo?: string;
  sourceBillNo?: string;
  currencyCode?: string;
  exchangeRate?: number;
  xmlExportStatus?: WithholdingCertificateXmlExportStatus;
  xmlFileName?: string;
  xmlGeneratedAt?: number;
  xmlGeneratedBy?: string;
  xmlSubmissionReference?: string;
  rdResponseCode?: string;
  rdResponseMessage?: string;
}

export interface WhtCertificatePayerSnapshot {
  legalNameTh: string;
  legalNameEn?: string;
  taxId: string;
  branchType: 'HEAD_OFFICE' | 'BRANCH';
  branchNo?: string;
  addressTh: string;
  addressEn?: string;
  phone?: string;
  email?: string;
  taxpayerType?: 'COMPANY' | 'PERSON' | 'OTHER';
}

export interface WhtCertificatePayeeSnapshot {
  displayName: string;
  taxId?: string;
  branchType: 'HEAD_OFFICE' | 'BRANCH';
  branchNo?: string;
  addressTh: string;
  addressEn?: string;
  vendorCategory: 'COMPANY' | 'INDIVIDUAL' | 'FOREIGN' | 'OTHER';
  countryCode?: string;
}

export type WhtCertificateAuditAction =
  | 'CREATE_WHT'
  | 'VERIFY_WHT'
  | 'ISSUE_WHT'
  | 'PRINT_WHT'
  | 'GENERATE_WHT_XML'
  | 'CANCEL_WHT'
  | 'REPLACE_WHT'
  | 'REFRESH_WHT_FROM_MASTER';

/** เอกสารหนังสือรับรองหัก ณ ที่จ่าย — collection `withholding_certificate_documents` */

export interface WithholdingCertificateDocument {
  id: string;
  documentStatus: WithholdingCertificateDocumentStatus;
  xmlExportStatus: WithholdingCertificateXmlExportStatus;

  /** เลขที่หนังสือรับรอง — มีเมื่อ ISSUED */
  certificateNo?: string;

  /** ประเภทสำเนาล่าสุดที่พิมพ์ (audit) */
  lastPrintedCopyVariant?: WithholdingCertificateCopyVariant;

  taxCondition: WhtTaxCondition;
  taxConditionOtherRemark?: string;

  incomeTypeCode: WhtIncomeTypeCode;
  incomeTypeDisplayTh: string;
  /** รหัสรายได้สำหรับอนาคต (เชื่อม RD / e-Withholding) */
  withholdingIncomeCode?: string;
  formTypeCode?: string;
  withholdingFormType: WhtWithholdingFormType;

  payer: WhtCertificatePayerSnapshot;
  payee: WhtCertificatePayeeSnapshot;

  amountBeforeVat: number;
  vatAmount: number;
  grossAmount: number;
  withholdingTaxBase: number;
  withholdingTaxRatePercent: number;
  withholdingTaxAmount: number;
  netPaidAmount: number;

  paymentDate: string;
  paymentMethod: PaymentMethod;
  paymentIssueDate: string;
  bankName?: string;
  bankAccountLast4?: string;
  sendingBankName?: string;
  paymentReferenceNo?: string;

  referenceVendorBillNo: string;
  referencePurchaseNo?: string;
  referenceTaxInvoiceNo?: string;
  referencePaymentNo?: string;
  jobDescription: string;

  sourceVendorBillId: string;
  sourcePurchaseId: string;
  sourceCashbookEntryId?: string;
  sourceWithholdingAtSourceItemId?: string;
  /** แหล่งที่มาจากสัญญาเช่า (ถ้ามี) */
  sourceRentalContractId?: string;
  sourceRentalPayableId?: string;

  /** อนุญาตออกเอกสารทางการแม้ไม่มีเลขผู้เสียภาษีคู่ค้า — เฉพาะแอดมิน + ระบุเหตุผล */
  payeeTaxIdMissingOverride?: boolean;
  payeeTaxIdMissingReason?: string;

  whtElectronicData: WhtElectronicData;

  authorizedSignerName?: string;
  signerPosition?: string;
  signatureImageUrl?: string;
  companyStampImageUrl?: string;

  cancelReason?: string;
  replacedByDocumentId?: string;

  createdAt: number;
  createdByUid: string;
  createdByName?: string;
  updatedAt: number;
  updatedByUid?: string;
  updatedByName?: string;
  verifiedAt?: number;
  verifiedByUid?: string;
  verifiedByName?: string;
  issuedAt?: number;
  issuedByUid?: string;
  issuedByName?: string;
  cancelledAt?: number;
  cancelledByUid?: string;
  cancelledByName?: string;

  /** บันทึกนำส่งภาษีหัก ณ ที่จ่าย (ภงด.53) — cashbook OUT */
  whtTaxCashbookEntryId?: string;
  whtTaxCashbookEntryNo?: string;
  whtTaxPaidAt?: number;
  whtTaxPaidByUid?: string;
  whtTaxPaidByName?: string;
  whtTaxPaymentBankAccountId?: string;
  whtTaxPaymentProofAttachments?: WhtTaxPaymentProofAttachment[];
}

export interface WhtCertificateAuditLogEntry {
  id: string;
  action: WhtCertificateAuditAction;
  documentId: string;
  actorId: string;
  actorName?: string;
  timestamp: number;
  /** field สำคัญที่เปลี่ยน (ถ้ามี) */
  payloadSummary?: Record<string, unknown>;
  reason?: string;
}

export interface DocumentApprovalEvent {
  id: string;
  action: 'BILLING_CUSTOMER_APPROVED';
  at: number;
  actorUid: string;
  actorName: string;
  actorRole?: string;
  /** internal_ui = บันทึกแทนลูกค้าในระบบภายใน; client_portal = ลูกค้ากดเอง */
  channel: 'internal_ui' | 'client_portal';
  /** โทเคนอ้างอิงชุดเอกสาร (แสดงต่อท้ายเลขที่/QR ได้) */
  approvalToken: string;
  note?: string;
}

/** รูปสลิปลงเวลา/เอกสารลงนามแนบกับใบแจ้งหนี้ (ก่อน ISSUED) */

export interface TaxInvoiceTimesheetAttachment {
  id: string;
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  uploadedAt: number;
  uploadedByUid?: string;
  uploadedByName?: string;
}

export interface TaxInvoice {
  id: string;
  taxInvoiceNo: string;
  /** อ้างอิงใบวางบิล (มักสร้างอัตโนมัติจากใบแจ้งหนี้เชิงพาณิชย์ — ผู้ใช้เลือกจาก «รายการใบแจ้งหนี้» ไม่ใช่เมนูใบวางบิล) */
  billingNoteId: string;
  /** สร้างจากใบเรียกเก็บ (commercial) หลังลูกค้า/OPEC ยืนยัน — พร้อม snapshot ใบวางบิล */
  sourceCommercialInvoiceId?: string;
  customerId: string;
  waveId?: string;
  issueDate: string;
  taxableAmount: number;
  vatAmount: number;
  /** ภาษีหัก ณ ที่จ่าย (จากใบวางบิล — ใช้สอดคล้องยอดลูกหนี้กับเงินรับจริง) */
  withholdingTaxAmount?: number;
  /**
   * แสดงยอดหัก ณ ที่จ่ายบนใบกำกับภาษี (ฐาน = ก่อน VAT, ภาษี = rate%, สุทธิ = ยอดรวมรวม VAT − หัก ณ ที่จ่าย)
   * ถ้า false แสดงเฉพาะยอดเงินฐานภาษี + VAT + ยอดรวมสุทธิแบบเดิม
   */
  showWithholdingOnDocument?: boolean;
  /** อัตราที่ใช้คำนวณบนเอกสารเมื่อแสดงหัก ณ ที่จ่าย (ค่าเริ่ม 3) */
  withholdingTaxRatePercentOnDocument?: number;
  totalAmount: number;
  currency: string;
  status: TaxInvoiceStatus;
  /** ภาษาเอกสารฉบับพิมพ์ ณ เวลาออกฉบับจริง (ISSUED) — ล็อกเพื่อให้พิมพ์ตรงกับลูกค้า/หน้าจอ (ไม่พึ่ง localStorage ฝ่ายเดียว) */
  printDocumentLocale?: 'th' | 'en';
  notes?: string;
  /** ผู้สร้างร่างใบกำกับ (จากใบเรียกเก็บ / บัญชี) */
  createdByUid?: string;
  createdByName?: string;
  /** แชร์ให้ officer ที่ระบุ — ดูได้แม้ไม่ได้เป็นผู้สร้าง */
  sharedWith?: { uid: string; displayName: string; roleKey?: string }[];
  sharedWithUids?: string[];
  /** ผู้ยืนยันออกเอกสารจริง (ISSUED) */
  issuedByUid?: string;
  issuedByName?: string;
  /** ยกเลิกเอกสาร — เลขที่เดิมคงอยู่ · ประทับ CANCEL บนพิมพ์ */
  cancelledAt?: number;
  cancelledByUid?: string;
  cancelledByName?: string;
  cancellationReason?: string;
  /** ฉบับใหม่ที่แทนที่ใบนี้ (หลังยกเลิกแล้วออกใหม่) */
  replacedByTaxInvoiceId?: string;
  replacedByTaxInvoiceNo?: string;
  replacedAt?: number;
  /** ใบนี้แทนที่เลขที่เดิม */
  replacesTaxInvoiceId?: string;
  replacesTaxInvoiceNo?: string;
  /** แนบรูปสลิป/เอกสารขณะสถานะ DRAFT */
  timesheetPaperAttachments?: TaxInvoiceTimesheetAttachment[];
  /** แนบรูป/เอกสารหัก ณ ที่จ่าย ที่ได้รับจากลูกค้า */
  whtAttachments?: TaxInvoiceTimesheetAttachment[];
  /** อ้างอิงแถวลูกหนี้ (AR) หลังออกเอกสารจริง */
  arEntryId?: string;
  /** ลูกค้ายืนยันยอด billing (แยกจาก payroll) — หลังตั้งค่า timesheet ที่เกี่ยวข้องจะถูกล็อก */
  billingCustomerApprovedAt?: number;
  billingCustomerApprovedByUid?: string;
  billingCustomerApprovedByName?: string;
  billingCustomerApprovalSource?: 'internal_representative' | 'client_portal';
  /** โทเคนอ้างอิงครั้งอนุมัติ billing (แนบท้ายเอกสาร/ตรวจสอบย้อนหลัง) */
  billingApprovalToken?: string;
  /** ประวัติอนุมัติบนเอกสาร (รายละเอียดเต็มอยู่ที่ audit_logs ด้วย) */
  billingApprovalEvents?: DocumentApprovalEvent[];
  createdAt: number;
  updatedAt: number;
  /** ขั้น 1: ลูกค้าหรือบัญชีแจ้งว่าได้ชำระเงินแล้ว (รอบัญชีตรวจและออกใบเสร็จ) */
  paymentNotifiedAt?: number;
  paymentNotifiedByUid?: string;
  paymentNotifiedByName?: string;
  paymentNotifySource?: 'client_portal' | 'accounting_ui';
  paymentNotificationNote?: string;
  /** ขั้น 2: บัญชียืนยันรับเงินแล้ว — ระบบออกเอกสาร ใบเสร็จรับเงิน แยก */
  paymentReceivedConfirmedAt?: number;
  paymentReceivedConfirmedByUid?: string;
  paymentReceivedConfirmedByName?: string;
  /** อ้างอิง `receipts/{id}` หลังออกเอกสาร */
  linkedReceiptId?: string;
  /** รายการ cashbook รับเงินลูกค้า หลังยืนยันรับเงิน + ออกใบเสร็จ */
  paymentReceivedCashbookEntryId?: string;
  /** บัญชีที่รับเงินเข้า (สอดคล้อง cashbook) */
  paymentReceivedBankAccountId?: string;
}

export type TaxInvoiceStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';

