import type { ContractBillingMode } from './contracts';
import type { VendorBillSupportingDocumentLink } from './purchase';

/** Domain types: accounting (from master types.ts split). */

export type APStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';

export type ARStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';

export interface AccountsPayable {
  id: string;
  vendorId: string;
  documentNo: string;
  referenceId: string; // PurchaseId or BillId
  billDate: string;
  dueDate: string;
  debitAmount: number;
  creditAmount: number;
  outstandingAmount: number;
  status: APStatus;
  createdAt: number;
  updatedAt: number;
  /** สร้างจากใบรับวางบิลคลัง */
  origin?: 'STORE_VENDOR_BILL' | 'RENTAL_CONTRACT';
  /** รอบค่าเช่าที่สร้าง AP นี้ */
  rentalPayableId?: string;
  rentalContractId?: string;
}

export type RentalContractStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type RentalPayableStatus = 'PENDING' | 'PAID' | 'VOID';

/** ประเภทสัญญาเช่าภายใต้เมนูการจัดการสัญญา */

export type LeaseContractKind = 'PROPERTY' | 'VEHICLE';

/**
 * วิธีการทำจ่ายตามสัญญาเช่า
 * - AUTO_NOTIFY: สร้างรอบรอจ่ายอัตโนมัติ → แจ้งบัญชีโอนเหมือนเดิม
 * - BILL_FIRST: ต้องทำใบวางบิลอ้างสัญญา (ไม่ผ่าน PR/PO) ก่อนบัญชีทำจ่าย
 */

export type RentalPayoutWorkflow = 'AUTO_NOTIFY' | 'BILL_FIRST';

/** สัญญาเช่าที่ OPEC เป็นผู้เช่า — collection `rental_contracts` */

export interface RentalContract {
  id: string;
  contractNo: string;
  /** ไม่ระบุ = PROPERTY (สัญญาเดิม) */
  leaseKind?: LeaseContractKind;
  lessorVendorId: string;
  lessorVendorName: string;
  tenantName: string;
  rentedItemDescription: string;
  monthlyRentAmount: number;
  startDate: string;
  endDate: string;
  /** วันที่ครบกำหนดของแต่ละเดือน (1–31; เกินวันสุดท้ายจะใช้วันสุดท้ายของเดือน) */
  paymentDayOfMonth: number;
  /**
   * วิธีการทำจ่าย — ไม่ระบุ = AUTO_NOTIFY (สัญญาเก่า)
   */
  payoutWorkflow?: RentalPayoutWorkflow;
  withholdingTaxRatePercent: number;
  /**
   * VAT % บนฐานค่าเช่า — นิติบุคคลมัก 7 · บุคคลธรรมดา 0
   * ไม่ระบุ = 0 (สัญญาเก่าก่อนรองรับ VAT)
   */
  vatRatePercent?: number;
  /** ที่มาของ VAT — AUTO ตามประเภทผู้ให้เช่า หรือ MANUAL */
  vatSource?: 'AUTO_BY_LESSOR' | 'MANUAL';
  status: RentalContractStatus;
  /** ทำสัญญาที่ */
  madeAtLocation?: string;
  /** วันที่ทำสัญญา (YYYY-MM-DD) */
  contractDate?: string;
  /** ที่ตั้ง/รายละเอียดทรัพย์สิน (บ้าน อาคาร โรงงาน) */
  propertyAddress?: string;
  propertyCategory?: 'HOUSE' | 'BUILDING' | 'FACTORY' | 'OTHER';
  /** ยี่ห้อรถยนต์ */
  vehicleBrand?: string;
  /** เลขทะเบียน */
  vehiclePlateNo?: string;
  /** ระยะเวลาเช่า (เดือน) — สัญญาเช่ารถ */
  leaseDurationMonths?: number;
  /** ชำระค่าเช่าล่วงหน้ากี่เดือน */
  advanceRentMonths?: number;
  /** เงินประกันการเช่า */
  securityDepositAmount?: number;
  notes?: string;
  createdAt: number;
  createdByUid: string;
  createdByName: string;
  updatedAt: number;
  submittedAt?: number;
  submittedByUid?: string;
  submittedByName?: string;
  approvedAt?: number;
  approvedByUid?: string;
  approvedByName?: string;
  rejectedAt?: number;
  rejectedByUid?: string;
  rejectedByName?: string;
  rejectionReason?: string;
  cancelledAt?: number;
  cancelledByUid?: string;
  cancelledByName?: string;
  cancellationReason?: string;
  /** นับรอบการแก้ไขหัวสัญญา */
  revision?: number;
  lastEditedAt?: number;
  lastEditedByUid?: string;
  lastEditedByName?: string;
}

/**
 * สัญญาเช่าที่ OPEC เป็นผู้ให้เช่า (เครื่องมือ/อุปกรณ์) — collection `equipment_rental_contracts`
 * ต่างจาก {@link RentalContract} ที่ OPEC เป็นผู้เช่า
 */

export type EquipmentRentalContractStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'CANCELLED'
  | 'EXPIRED';

/** ค่าเช่าต่อหน่วย — ตามแบบสัญญาเช่าเครื่องจักรกล (วัน หรือ เดือน) */

export type EquipmentRentalRatePeriod = 'DAY' | 'MONTH';

export interface EquipmentRentalLineItem {
  id: string;
  /** ชนิด / ชื่อเครื่องจักรกล (ใช้ในใบแจ้งหนี้) */
  description: string;
  /** ยี่ห้อ */
  brand?: string;
  /** หมายเลขเครื่อง / ทะเบียน */
  serialNumber?: string;
  /** ขนาด */
  size?: string;
  /** แรงม้า */
  horsepower?: string;
  quantity: number;
  /** หน่วย เช่น คัน / เครื่อง / ชุด */
  unit?: string;
  /**
   * ค่าเช่าต่อหน่วยต่อช่วง (บาท ก่อน VAT)
   * — DAY = ต่อวัน · MONTH = ต่อเดือน
   */
  unitPrice: number;
  /** ไม่ระบุ = MONTH (เข้ากับวางบิลรายเดือน) */
  ratePeriod?: EquipmentRentalRatePeriod;
  /**
   * ยอดต่อรอบวางบิลรายเดือนของรายการนี้
   * (= qty × unitPrice เมื่อ MONTH · หรือ qty × unitPrice × 30 เมื่อ DAY)
   */
  amount: number;
}

/**
 * สัญญาเช่าที่ OPEC เป็นผู้ให้เช่า (เครื่องมือ/อุปกรณ์) — collection `equipment_rental_contracts`
 * แบบพิมพ์อ้างอิง สัญญาเช่าเครื่องจักรกล (ข้อ ๑–๒๕)
 */

export interface EquipmentRentalContract {
  id: string;
  contractNo: string;
  status: EquipmentRentalContractStatus;
  /** ลูกค้าผู้เช่า */
  customerId: string;
  customerNameSnapshot: string;
  /** ที่อยู่ผู้เช่า (snapshot จากลูกค้าตอนสร้าง/แก้ไข) */
  customerAddressSnapshot?: string;
  /** เลขประจำตัวผู้เสียภาษีผู้เช่า */
  customerTaxIdSnapshot?: string;
  /** ผู้มีอำนาจลงนามฝ่ายผู้เช่า */
  lesseeAuthorizedSignatory?: string;
  /** วันที่หนังสือรับรองนิติบุคคลผู้เช่า (YYYY-MM-DD) */
  lesseeCertificateDate?: string;
  /** ชื่อสัญญา / หัวข้อ */
  title: string;
  /** รายการเครื่องมือ-อุปกรณ์ที่ให้เช่า */
  lineItems: EquipmentRentalLineItem[];
  /** รวมค่าเช่าต่อเดือนก่อน VAT (= sum line amounts สำหรับวางบิล) */
  monthlyRentAmount: number;
  vatRatePercent: number;
  startDate: string;
  endDate: string;
  /**
   * วันที่กำหนดวางบิลของแต่ละเดือน (1–31)
   * — เมื่อถึงวันนี้ระบบสร้างใบแจ้งหนี้ (commercial invoice) อัตโนมัติ
   */
  billingDayOfMonth: number;
  notes?: string;

  /** ทำสัญญาที่ — ตำบล/แขวง */
  madeAtTambon?: string;
  /** อำเภอ/เขต */
  madeAtAmphoe?: string;
  /** จังหวัด */
  madeAtProvince?: string;
  /** วันที่ทำสัญญา (YYYY-MM-DD) */
  contractDate?: string;

  /** ชื่อผู้ให้เช่า (OPEC) */
  lessorName?: string;
  lessorAddress?: string;
  lessorTaxId?: string;
  lessorAuthorizedSignatory?: string;
  /** true = บุคคลธรรมดา (ใช้เลขบัตรประชาชน) */
  lessorIsIndividual?: boolean;
  lessorIdCardNo?: string;

  /** ข้อ ๓ — ประเภทชั้นประกันภัย */
  insuranceClass?: string;
  /** ข้อ ๖ — ระยะเวลาเช่า (ตัวเลข) */
  rentalDurationValue?: number;
  /** ข้อ ๖ — วัน หรือ เดือน */
  rentalDurationUnit?: EquipmentRentalRatePeriod;
  /** ข้อ ๕ — จำนวนแผ่นผนวก */
  appendix1Pages?: number;
  appendix2Pages?: number;
  appendix3Pages?: number;

  /** ข้อ ๗ — ส่งใบแจ้งหนี้ล่วงหน้ากี่วันทำการ */
  invoiceLeadWorkingDays?: number;
  bankName?: string;
  bankBranch?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  /** ข้อ ๗ — หยุดชะงักไม่น้อยกว่ากี่วันจึงงดค่าเช่า */
  interruptionThresholdDays?: number;
  /** ข้อ ๗ — แจ้งส่งมอบกลับจากคลังล่วงหน้ากี่วัน */
  storageReturnNoticeDays?: number;

  /** ข้อ ๘ — อายุการใช้งานไม่เกินกี่ปี */
  maxEquipmentAgeYears?: number;
  /** ข้อ ๙ — สถานที่ส่งมอบ */
  deliveryLocation?: string;
  deliveryDate?: string;
  deliveryNoticeWorkingDays?: number;

  /** ข้อ ๑๐ — นำเครื่องใหม่มาส่ง / แก้ไขภายในกี่วัน */
  replacementDeliveryDays?: number;
  repairCorrectionDays?: number;

  /** ข้อ ๑๒ — ค่าปรับรายวันเมื่อไม่จัดเครื่องทดแทน */
  replacementPenaltyPerDay?: number;
  /** ข้อ ๑๒ — เกินกี่วันติดต่อกันจึงบอกเลิกได้ */
  maxReplacementDelayDays?: number;

  /** ข้อ ๑๔ — แจ้งขนย้ายล่วงหน้ากี่วัน */
  relocationNoticeDays?: number;

  /** ข้อ ๑๕ — หลักประกัน */
  performanceBondType?: string;
  performanceBondAmount?: number;
  performanceBondPercent?: number;
  performanceBondTopUpDays?: number;

  /** ข้อ ๑๗ — เปลี่ยนเครื่องเมื่อสูญหายภายในกี่วัน */
  lossReplacementDays?: number;
  /** ข้อ ๑๘ — เช่าจากบุคคลอื่นภายในกี่วัน/เดือนหลังบอกเลิก */
  alternateRentalWindowValue?: number;
  alternateRentalWindowUnit?: EquipmentRentalRatePeriod;

  /** ข้อ ๑๙ — ค่าปรับส่งมอบล่าช้าต่อคัน/เครื่อง */
  lateDeliveryPenaltyPerDay?: number;
  /** ข้อ ๑๙ — ชำระค่าปรับ/ค่าเสียหายภายในกี่วัน */
  penaltyDebtPayDays?: number;

  /** ข้อ ๒๐ — นำเครื่องกลับคืนภายในกี่วันหลังสิ้นสุดสัญญา */
  equipmentReturnDays?: number;

  /** ข้อ ๒๕ — แจ้งเปลี่ยนที่อยู่ล่วงหน้ากี่วัน */
  addressChangeNoticeDays?: number;

  witness1Name?: string;
  witness2Name?: string;

  createdAt: number;
  createdByUid: string;
  createdByName: string;
  updatedAt: number;
  activatedAt?: number;
  activatedByUid?: string;
  activatedByName?: string;
  cancelledAt?: number;
  cancelledByUid?: string;
  cancelledByName?: string;
  cancellationReason?: string;
}

/** ค่าเช่ารายเดือนที่รอฝ่ายบัญชีทำจ่าย — collection `rental_payables` */

export interface RentalPayable {
  id: string;
  contractId: string;
  contractNo: string;
  vendorId: string;
  vendorName: string;
  periodMonth: string;
  dueDate: string;
  description: string;
  /** ฐานค่าเช่าก่อน VAT (snapshot จากสัญญา) */
  baseRentAmount?: number;
  /** VAT % ที่ใช้ตอนสร้างรอบ */
  vatRatePercent?: number;
  /** จำนวน VAT */
  vatAmount?: number;
  /** ยอดรวม VAT (ก่อนหัก ณ ที่จ่าย) — ใช้เป็น debit AP / gross ใน cashbook */
  grossAmount: number;
  withholdingTaxRatePercent: number;
  /** หัก ณ ที่จ่าย — คิดบนฐานก่อน VAT */
  withholdingTaxAmount: number;
  /** สุทธิโอน = grossAmount − withholdingTaxAmount */
  netPayableAmount: number;
  status: RentalPayableStatus;
  apEntryId: string;
  createdAt: number;
  updatedAt: number;
  paidAt?: number;
  paidByUid?: string;
  paidByName?: string;
  bankAccountId?: string;
  paymentMethod?: PaymentMethod;
  cashbookEntryId?: string;
  cashbookEntryNo?: string;
  whtCertificateDocumentId?: string;
  /** หลักฐานโอนเงิน (รูปแบบเดียวกับใบวางบิล) */
  paymentProofUrl?: string;
  paymentProofFileName?: string;
  /** หลักฐานหัก ณ ที่จ่าย (ถ้าแนบแยก) */
  whtPaymentProofUrl?: string;
  whtPaymentProofFileName?: string;
  /** บัญชีรับเงินของผู้ให้เช่าตอนจ่าย */
  vendorPayeeBankAccountId?: string;
  vendorPayeeBankName?: string;
  vendorPayeeBankAccountName?: string;
  vendorPayeeBankAccountNumber?: string;
  /**
   * เอกสารประกอบ — รูปแบบเดียวกับใบวางบิล
   * (ใบส่งของ / ใบกำกับภาษี / ใบเสร็จรับเงิน)
   */
  supportingDeliveryNote?: VendorBillSupportingDocumentLink;
  supportingTaxInvoice?: VendorBillSupportingDocumentLink;
  supportingMoneyReceipt?: VendorBillSupportingDocumentLink;
  voidedAt?: number;
  voidReason?: string;
}

export interface AccountsReceivable {
  id: string;
  customerId: string;
  documentNo: string;
  /** ลูกหนี้ — ตั้งเมื่อออกใบกำกับภาษี (ISSUED) เท่านั้น; COMMERCIAL_INVOICE = legacy ก่อนปรับนโยบาย */
  referenceType: 'TAX_INVOICE' | 'BILLING_NOTE' | 'COMMERCIAL_INVOICE';
  referenceId: string;
  /** เลขที่ใบกำกับ (แสดงผล / audit) */
  referenceNo?: string;
  issueDate: string;
  dueDate: string;
  debitAmount: number;
  creditAmount: number;
  outstandingAmount: number;
  status: ARStatus;
  createdAt: number;
  updatedAt: number;
}

export interface APBill {
  id: string;
  apBillNo: string;
  vendorId: string;
  purchaseId?: string;
  supplierInvoiceNo: string;
  billReceivedDate: string;
  invoiceDate: string;
  dueDate: string;
  amountBeforeTax: number;
  vatAmount: number;
  totalAmount: number;
  outstandingAmount: number;
  status: APBillStatus;
  paymentTerms: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type APBillStatus = 'RECEIVED' | 'VERIFIED' | 'APPROVED' | 'PAID' | 'CANCELLED';

export interface BankAccount {
  id: string;
  accountCode: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchName: string;
  accountType: BankAccountType;
  currency: string;
  openingBalance: number;
  currentBalance: number;
  /** วงเงิน OD — ใช้กับบัญชีกระแสรายวัน (CURRENT) */
  odLimit?: number;
  status: BankAccountStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type BankAccountType = 'SAVINGS' | 'CURRENT' | 'CASH' | 'PETTY_CASH';

export type BankAccountStatus = 'ACTIVE' | 'INACTIVE';

export interface BillingNote {
  id: string;
  billingNoteNo: string;
  customerId: string;
  contractId?: string;
  poId?: string;
  waveId?: string;
  quotationId?: string;
  billingDate: string;
  dueDate: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  amountBeforeTax: number;
  /** VAT percent inherited from SalesTerm or Quotation at creation (default 7) */
  vatPercent: number;
  vatAmount: number;
  withholdingTaxAmount: number;
  netAmount: number;
  currency: string;
  status: BillingNoteStatus;
  notes?: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

export type BillingNoteStatus = 'DRAFT' | 'ISSUED' | 'SUBMITTED' | 'INVOICED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export interface BillingNoteLine {
  id: string;
  billingNoteId: string;
  description: string;
  referenceType: BillingNoteReferenceType;
  referenceId?: string;
  workerId?: string;
  workerName?: string;
  positionId?: string;
  eventType?: string;
  timesheetIds?: string[];
  quantity: number;
  unitPrice: number;
  amount: number;
  /** ลำดับแสดง — อนุรักษ์จากลำดับรายการใบเรียกเก็บ (เดียวกับ Invoice) เพื่อสอดคล้องฉบับพิมพ์ */
  displayOrder?: number;
  createdAt: number;
  updatedAt: number;
}

export type BillingNoteReferenceType = 'CONTRACT' | 'PO' | 'TIMESHEET' | 'SERVICE';

/**
 * ใบแจ้งหนี้เรียกเก็บ (commercial) — สร้างจาก timesheet/wave ก่อนใบกำกับภาษี
 * แยกจาก {@link TaxInvoice} ซึ่งออกทางบัญชีหลังได้รับเงิน
 */

export type CommercialInvoiceStatus = 'DRAFT' | 'PENDING_CUSTOMER' | 'ISSUED' | 'VOID';

export interface CommercialInvoiceLine {
  id: string;
  description: string;
  workerId?: string;
  workerName?: string;
  positionId?: string;
  eventType?: string;
  timesheetIds?: string[];
  quantity: number;
  unitPrice: number;
  amount: number;
  /** ลำดับแสดงบนใบเรียกเก็บ/ใบกำกับ (0-based) — ตรงกับ BillingNoteLine.displayOrder เมื่อสร้างชุดภาษี */
  displayOrder?: number;
  /** จาก timesheet อัตโนมัติ vs ปรับยอดด้วยมือ (ส่วนลด/เพิ่ม) vs รายการ PO vs รายการใบเสนอราคา */
  lineSource?: 'timesheet' | 'manual' | 'po_line' | 'quotation_line';
}

export interface CommercialInvoice {
  id: string;
  invoiceNo: string;
  status: CommercialInvoiceStatus;
  customerId: string;
  contractId?: string;
  poId: string;
  waveId: string;
  /** อ้างสัญญาเช่าอุปกรณ์ที่ OPEC เป็นผู้ให้เช่า */
  equipmentRentalContractId?: string;
  /** เดือนที่วางบิลตามสัญญาเช่า (YYYY-MM) */
  equipmentRentalPeriodMonth?: string;
  /** อ้าง wave_month_timesheet_reviews — กันสร้างซ้ำเมื่ออนุมัติรอบเดือน (ต่อ wave) */
  sourceWaveMonthReviewId?: string;
  /** อ้าง po_month_timesheet_reviews — งวดอนุมัติราย PO+เดือน (รวมทุก wave) */
  sourcePoMonthReviewId?: string;
  /** Partial billing: คนงานที่รวมในใบนี้ (ว่าง = ทั้ง PO+งวด) */
  coveredWorkerIds?: string[];
  /** Partial billing: รอบปิดงวด (batch) จาก worker_month_timesheet_closures */
  partialPoMonthBatchNo?: number;
  /** อ้าง trip_billing_batches — วางบิลรอบ M1→D1 (หลายคนต่อ invoice) */
  sourceTripBillingBatchId?: string;
  billingMode?: ContractBillingMode;
  memberMobCycleIds?: string[];
  memberWorkerNames?: string[];
  /** จุด mob/demob ที่เลือกตอนสร้าง invoice แบบ Trip (เมื่อสัญญา tripBillMobDemobFee) */
  tripMobDemobLocationKey?: string;
  /** ฝั่ง OPEC ส่งให้ลูกค้าเห็นใน portal (DRAFT → PENDING_CUSTOMER) */
  sentToCustomerAt?: number;
  sentToCustomerByUid?: string;
  sentToCustomerByName?: string;
  /** แสดงผล — เก็บตอนสร้างจาก wave */
  waveCode?: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  currency: string;
  vatPercent: number;
  amountBeforeTax: number;
  vatAmount: number;
  withholdingTaxAmount: number;
  totalAmount: number;
  lines: CommercialInvoiceLine[];
  /** ลูกค้าแจ้งขอแก้ไข (portal — Open Dispute) — คู่กับ customerRevisionRequestNote */
  customerRevisionRequestedAt?: number;
  /** ข้อความจากลูกค้าเมื่อแจ้ง dispute */
  customerRevisionRequestNote?: string;
  /** อ้างอิง customer_issues ที่สร้างตอน dispute */
  customerRevisionIssueId?: string;
  /** หลังลูกค้า/ตัวแทนอนุมัติ — ถือเป็น Invoice จริงสำหรับเรียกเก็บ (ยังไม่ใช่ใบกำกับภาษี) */
  customerApprovedAt?: number;
  customerApprovedByUid?: string;
  customerApprovedByName?: string;
  customerApprovalSource?: 'CLIENT_PORTAL' | 'INTERNAL';
  /** ลูกค้าแนบสลิป/หลักฐานการจ่ายเงิน (หลังอนุมัติยอดเรียกเก็บแล้ว) */
  customerPaymentReportedAt?: number;
  customerPaymentReportedByUid?: string;
  customerPaymentReportedByName?: string;
  customerPaymentProofUrl?: string;
  customerPaymentProofFileName?: string;
  /** บัญชี OPEC รับรองรับเงิน + ออกใบกำกับ/ลง cashbook */
  opecPaymentVerifiedAt?: number;
  opecPaymentVerifiedByUid?: string;
  opecPaymentVerifiedByName?: string;
  opecPaymentBankAccountId?: string;
  opecPaymentCashbookEntryId?: string;
  generationWarnings?: string[];
  timesheetCount?: number;
  notes?: string;
  /** ใบกำกับภาษี / ใบเสร็จ (ร่างหรือออกแล้ว) ที่สร้างจากใบเรียกเก็บนี้ */
  linkedTaxInvoiceId?: string;
  /**
   * เอกสารสนับสนุนที่ OPEC แนบให้ลูกค้าเปิดดูตอนตรวจใบวางบิล
   * (รูป/PDF · สูงสุด 5 ไฟล์ · ไม่เกิน 2 MB ต่อไฟล์)
   */
  attachments?: CommercialInvoiceAttachment[];
  /**
   * เลขฐานไม่มีท้าย R — เช่น DFI-2026-08-0006
   * (เลขแสดงผลใช้ invoiceNo เช่น DFI-2026-08-0006 R1)
   */
  baseInvoiceNo?: string;
  /** 0 = ต้นฉบับ, 1 = R1, 2 = R2 … */
  revisionNo?: number;
  /** id เอกสารต้นในชุด revision (ตัวเองถ้าเป็นต้นฉบับ) */
  revisionRootId?: string;
  /** รุ่นก่อนหน้าในชุด */
  previousRevisionId?: string;
  /** ถูกแทนที่ด้วยรุ่นใหม่ — เปิดดูได้อย่างเดียว */
  supersededByInvoiceId?: string;
  createdAt: number;
  createdByUid: string;
  createdByName: string;
  updatedAt: number;
  updatedByUid?: string;
  updatedByName?: string;
  /** แชร์ให้ officer ที่ระบุ — ดูได้แม้ไม่ได้เป็นผู้สร้าง */
  sharedWith?: { uid: string; displayName: string; roleKey?: string }[];
  sharedWithUids?: string[];
}

/** เอกสารแนบประกอบใบแจ้งหนี้เชิงพาณิชย์ (ให้ลูกค้าเปิดดูใน portal) */

export interface CommercialInvoiceAttachment {
  id: string;
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  size?: number;
  uploadedAt: number;
  uploadedByUid?: string;
  uploadedByName?: string;
}

export interface CashbookEntry {
  id: string;
  entryNo: string;
  bankAccountId: string;
  entryDate: string;
  direction: 'IN' | 'OUT';
  entryType: CashbookEntryType;
  referenceType?: 'RECEIPT' | 'PAYMENT' | 'BILL' | 'TRANSFER' | 'OTHER';
  referenceId?: string;
  amount: number;
  description: string;
  paymentMethod: PaymentMethod;
  createdAt: number;
  updatedAt: number;
  createdByUid?: string;
  createdByName?: string;
  /** ยอดเต็มงวด (ก่อนหัก ณ ที่จ่าย) — ใช้ประกอบรายการจ่ายคู่ค้า */
  grossPaymentAmount?: number;
  /** หัก ณ ที่จ่ายที่ไม่ได้ตัดจากบัญชีธนาคาร (รอนำส่งสรรพากร) */
  supplierWithholdingAmount?: number;
}

/**
 * รายการรับ/จ่ายเงินสดย่อยหน้างาน — อัปเดตยอด Petty Cash โดยตรง ไม่สร้างแถวใน `cashbook_entries`
 * (เงินก้อนจากบริษัทตัดใน cashbook ตอนโอนเข้า Petty แล้ว; คืนเข้าบริษัทค่อยลง cashbook อีกครั้ง)
 */

export interface PettyCashEntry {
  id: string;
  entryNo: string;
  bankAccountId: string;
  entryDate: string;
  direction: 'IN' | 'OUT';
  amount: number;
  description: string;
  paymentMethod: 'CASH';
  createdAt: number;
  createdByUid: string;
  createdByName: string;
  updatedAt: number;
}

/** เบิกเงินล่วงหน้า — workflow HR / ผู้จัดการ / บัญชี / Petty Cash */

export type CashAdvanceSubjectType = 'worker' | 'office_staff';

/** office = สร้างจาก HR/ออฟฟิศ (ผู้ถือใบอาจต้องยืนยัน); employee = สร้างจากผู้ถือบัญชีเอง */

export type CashAdvanceOrigin = 'office' | 'employee';

export type CashAdvanceStatus =
  | 'PENDING_SUBJECT_CONFIRMATION'
  | 'PENDING_PAYROLL_REVIEW'
  | 'REJECTED_PAYROLL'
  | 'PENDING_MANAGER_APPROVAL'
  | 'REJECTED_MANAGER'
  | 'PENDING_PAYMENT'
  | 'PAID_PETTY_CASH'
  | 'PAID_OTHER'
  | 'CANCELLED';

export interface CashAdvanceRequest {
  id: string;
  requestNo: string;
  subjectType: CashAdvanceSubjectType;
  workerId?: string;
  officeStaffId?: string;
  /** ชื่อแสดง snapshot */
  subjectNameSnapshot: string;
  amountBaht: number;
  reason: string;
  origin: CashAdvanceOrigin;
  status: CashAdvanceStatus;
  /** UID ของผู้ถือเรื่อง (ยืนยันเมื่อสร้างจาก office) — จาก linkedUserId ของ worker/office_staff */
  subjectLinkedUserId?: string | null;
  createdAt: number;
  createdByUid: string;
  createdByName: string;
  updatedAt: number;
  subjectConfirmedAt?: number;
  subjectConfirmationIp?: string;
  payrollReviewedAt?: number;
  payrollReviewedByUid?: string;
  payrollReviewedByName?: string;
  payrollRejectReason?: string;
  managerApprovedAt?: number;
  managerApprovedByUid?: string;
  managerApprovedByName?: string;
  managerRejectReason?: string;
  /** Snapshot บัญชีผู้รับ ณ ตอนผู้จัดการอนุมัติ — หน้ารอจ่าย fallback ไปทะเบียนปัจจุบันเมื่อข้อมูลเก่าไม่มี */
  recipientBankNameSnapshot?: string;
  recipientBankAccountNameSnapshot?: string;
  recipientBankAccountNumberSnapshot?: string;
  paidAt?: number;
  paidByUid?: string;
  paidByName?: string;
  paymentNote?: string;
  pettyCashBankAccountId?: string;
  pettyCashEntryId?: string;
  pettyCashEntryNo?: string;
  /** จ่ายจากบัญชีธนาคารหลัก — บันทึกใน cashbook_entries (ไม่ใช่ Petty) */
  paymentBankAccountId?: string;
  cashbookEntryId?: string;
  cashbookEntryNo?: string;
  /** เมื่อสร้าง Payroll Batch แล้วหักเบิกล่วงหน้าในสลิป — อ้าง batch ที่ผูกการหัก */
  payrollRecoveryBatchId?: string | null;
}

export type CashbookEntryType =
  | 'CUSTOMER_RECEIPT'
  | 'SUPPLIER_PAYMENT'
  | 'PAYROLL'
  | 'TAX'
  | 'TRANSFER'
  | 'PETTY_CASH'
  | 'OTHER';

export type PaymentMethod = 'TRANSFER' | 'CASH' | 'CHEQUE' | 'OTHER';

/** ใบเสร็จรับเงิน (ลูกค้า) — ออกหลังยืนยันรับเงินตามใบกำกับภาษี (แยกจากเอกสารกำกับ) */
export interface MoneyReceipt {
  id: string;
  receiptNo: string;
  taxInvoiceId: string;
  taxInvoiceNo: string;
  customerId: string;
  amount: number;
  currency: string;
  /** วันที่ออกเอกสาร (YYYY-MM-DD) */
  receiptDate: string;
  status: 'ISSUED';
  /** บัญชีธนาคารที่รับเงิน (ลง cashbook พร้อมกัน) */
  bankAccountId?: string;
  cashbookEntryId?: string;
  cashbookEntryNo?: string;
  createdAt: number;
  updatedAt: number;
  createdByUid?: string;
  createdByName?: string;
  /** แชร์ให้ officer ที่ระบุ — ดูได้แม้ไม่ได้เป็นผู้สร้าง */
  sharedWith?: { uid: string; displayName: string; roleKey?: string }[];
  sharedWithUids?: string[];
}

