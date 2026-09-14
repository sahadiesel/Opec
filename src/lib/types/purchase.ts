/** Domain types: purchase (from master types.ts split). */

export type PurchaseLineEntryMode = 'INVENTORY' | 'SERVICE';

/** การคิด VAT บน PR/PO — EXCLUSIVE=ยังไม่รวม VAT ต่อบรรทัด, INCLUSIVE=ยอดบรรทัดรวม VAT แล้ว */

export type PurchaseRequestVatTreatment = 'NONE' | 'EXCLUSIVE' | 'INCLUSIVE';

/** ร่างงวดชำระตอนทำ PR — คัดลอกเป็น payment_milestones เมื่อสร้าง PO */

export interface PrPaymentMilestoneDraft {
  sequence: number;
  label: string;
  amount: number;
  /** ค่า input type="date" */
  dueDate?: string;
}

export type PurchaseRequestStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PO_ISSUED'
  | 'REJECTED'
  | 'CANCELLED';

export type PurchaseType = 'CASH' | 'CREDIT';

/**
 * ประเภทหัก ณ ที่จ่ายคู่ค้า — ตั้งบน PR/PO และแก้ได้บนใบวางบิลก่อนจ่าย
 * (อัตราแนะนำ: ขนส่ง 1% · จ้างเหมา/บริการ 3% · เช่า 5%)
 */

export type VendorBillWhtPresetCategory = 'TRANSPORT_FREIGHT' | 'CONTRACT' | 'SERVICE' | 'RENT';

/**
 * คำขออนุมัติสั่งซื้อ (PR) — ต้องอนุมัติก่อนสร้างใบสั่งซื้อ (1 PR สร้าง PO ได้หนึ่งฉบับ)
 */

export interface PurchaseRequest {
  id: string;
  requestNo: string;
  title: string;
  vendorId?: string;
  notes?: string;
  /** วันที่ต้องการของ (HTML date) — อ้างอิงเท่านั้น */
  needByDate?: string;
  estimatedAmount?: number;
  /** สรุปจากบรรทัด PR — sync ตอนบันทึก */
  amountBeforeTax?: number;
  vatAmount?: number;
  totalAmount?: number;
  /** แบบที่ 1 คลัง / แบบที่ 2 คีย์มือ */
  lineEntryMode?: PurchaseLineEntryMode;
  vatTreatment?: PurchaseRequestVatTreatment;
  /** เงื่อนไขจ่ายที่ขออนุมัติ — คัดลอกไป PO */
  purchasePaymentType?: PurchaseType;
  /** เครดิตแบ่งงวด — ถ้า false ใช้งวดเดียวตามเครดิตคู่ค้าเมื่อสร้าง PO */
  paymentInstallmentsEnabled?: boolean;
  paymentMilestoneDrafts?: PrPaymentMilestoneDraft[];
  /**
   * หัก ณ ที่จ่าย — ตั้งตอนทำ PR แล้วคัดลอกไป PO
   * ประเภท: จ้างเหมา / งานบริการ / ค่าเช่า (โหมด INVENTORY ไม่ใช้)
   */
  supplierWithholdingEnabled?: boolean;
  /** ประเภทเงินได้สำหรับใบหัก ม.50 — คัดลอกไป PO / ใช้ตอนบัญชีทำจ่าย */
  supplierWithholdingCategory?: VendorBillWhtPresetCategory;
  /** อัตราหัก ณ ที่จ่าย เช่น 3 = 3% */
  supplierWithholdingRatePercent?: number;
  status: PurchaseRequestStatus;
  requestedByUid?: string;
  requestedByName?: string;
  submittedAt?: number;
  decidedAt?: number;
  decidedByUid?: string;
  decidedByName?: string;
  rejectionReason?: string | null;
  /** PO ที่สร้างจาก PR นี้ (ผูก 1:1) */
  linkedPurchaseId?: string;
  createdAt: number;
  updatedAt: number;
  /** แชร์ให้ officer ที่ระบุ — ดูได้แม้ไม่ได้เป็นผู้สร้าง */
  sharedWith?: { uid: string; displayName: string; roleKey?: string }[];
  sharedWithUids?: string[];
}

export interface Purchase {
  id: string;
  purchaseNo: string;
  /** อ้าง PR ที่อนุมัติแล้ว — ใบสั่งซื้อใหม่ต้องระบุ */
  purchaseRequestId?: string;
  /**
   * แหล่งที่มา — RENTAL_CONTRACT = PO เงาจากสัญญาเช่า (ไม่ต้องมี PR)
   * ไม่ระบุ = ใบสั่งซื้อปกติ
   */
  origin?: 'RENTAL_CONTRACT';
  /** เมื่อ origin = RENTAL_CONTRACT */
  rentalContractId?: string;
  vendorId: string;
  purchaseDate: string;
  purchaseType: PurchaseType;
  totalAmount: number;
  amountBeforeTax: number;
  vatAmount: number;
  /** ส่วนลดหักจากฐานก่อนภาษี (บาท) — ตั้งได้บน PO อ้าง PR ก่อนส่งคู่ค้า */
  discountAmount?: number;
  status: PurchaseStatus;
  /** แบบที่ 1 เลือกจากคลัง / แบบที่ 2 สั่งจ้างคีย์มือ */
  purchaseLineMode?: PurchaseLineEntryMode;
  /** คิด VAT ตามที่อนุมัติใน PR — ถ้าไม่มีถือเป็น EXCLUSIVE (พฤติกรรมเดิม) */
  vatTreatment?: PurchaseRequestVatTreatment;
  /** หัก ณ ที่จ่ายตามประเภทเงินได้ — แสดง/คำนวณตามงวด (ฐาน = ส่วนก่อน VAT ของงวด) */
  supplierWithholdingEnabled?: boolean;
  /** ประเภท: จ้างเหมา / งานบริการ / ค่าเช่า / (บัญชีอาจตั้งค่าขนส่งบนใบวางบิล) */
  supplierWithholdingCategory?: VendorBillWhtPresetCategory;
  /** อัตราหัก ณ ที่จ่าย เช่น 3 = 3% */
  supplierWithholdingRatePercent?: number;
  notes?: string;
  /** UNPAID | PARTIAL | PAID — sync จากงวดชำระ */
  paymentStatus?: string;
  storeReceiptStatus?: string;
  /** ผู้สร้าง PO (จัดซื้อ) */
  createdByUid?: string;
  createdByName?: string;
  approvalRequestedAt?: number;
  approvalDecidedAt?: number;
  approvalDecisionByUid?: string;
  approvalDecisionByName?: string;
  approvalComment?: string | null;
  rejectionReason?: string | null;
  /** ยืนยันว่าส่ง PO/เอกสารให้คู่ค้าแล้ว (หลัง APPROVED → ISSUED) */
  issuedAt?: number;
  issuedByUid?: string;
  issuedByName?: string;
  createdAt: number;
  updatedAt: number;
}

export type PurchaseStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'RETURNED_FOR_REVISION'
  | 'APPROVED'
  | 'REJECTED'
  | 'ISSUED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface PurchaseLine {
  id: string;
  purchaseId: string;
  itemDescription: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  /** เมื่อ purchaseLineMode = INVENTORY */
  storeItemId?: string;
  /** รหัส SKU คลัง (EQM-/PPE-) — คัดลอกจาก PR เพื่อผูกรับเข้าสต็อก */
  storeItemCode?: string;
  createdAt: number;
}

/** งวดชำระเงินตาม PO จัดซื้อ — เก็บใต้ purchases/{id}/payment_milestones */

export type PurchasePaymentMilestoneStatus = 'OPEN' | 'PAID' | 'WAIVED';

export interface PurchasePaymentMilestone {
  id: string;
  purchaseId: string;
  sequence: number;
  label: string;
  amount: number;
  status: PurchasePaymentMilestoneStatus;
  /** ค่า input type="date" */
  dueDate?: string;
  paidAt?: number;
  paidByUid?: string;
  paidByName?: string;
  waivedAt?: number;
  waivedByUid?: string;
  waivedByName?: string;
  notes?: string;
  /** ลิงก์ไป purchase_vendor_bills เมื่อสร้างใบรับวางบิลต่องวด */
  vendorBillId?: string;
  /** แผนกสโตร์ยืนยันรับมอบงาน/สินค้าต่องวด (ลำดับงวด 1→2→3) */
  goodsReceivedAt?: number;
  goodsReceivedByUid?: string;
  goodsReceivedByName?: string;
  createdAt: number;
  updatedAt: number;
}

/** เอกสารประกอบใบวางบิล (ปะหน้า) — ถ้าไม่ติ๊ก = อ้างอิงเฉพาะ PO ภายในระบบ */

export interface VendorBillSupportingDocumentLink {
  attached?: boolean;
  documentNo?: string;
  /** ค่า input type="date" YYYY-MM-DD */
  documentDate?: string;
}

/**
 * ระบุว่ามองยอดในใบวางบิลว่ามี VAT 7% หรือไม่ — ถ้าไม่เก็บฟิลด์นี้ ให้อิงจากยอดภาษีใน PO
 * - VAT_7: แยกภาษี (ยอดรวมในใบ = ก่อนภาษี + VAT 7%)
 * - VAT_7_INCLUSIVE: ภาษีในตัว (ยอดรวมในใบรวม VAT แล้ว — แยกฐาน/ภาษีด้วย gross÷1.07 เหมือนกันในเลข)
 */

export type VendorBillVatTreatmentOverride = 'NONE' | 'VAT_7' | 'VAT_7_INCLUSIVE';

/** รับวางบิลจากใบสั่งซื้อที่อนุมัติแล้ว — คลังสร้าง บัญชีติดตามจ่าย */

export type PurchaseVendorBillStatus = 'DRAFT' | 'SUBMITTED' | 'PARTIALLY_PAID' | 'PAID' | 'CLOSED';

/** งวดจ่ายภายในใบรับวางบิลเดียว (แผนที่คลังกำหนด — ไม่ใช่แค่หมายเหตุ) */

export type VendorBillInstallmentPayStatus = 'PENDING' | 'PAID';

export interface VendorBillPaymentInstallment {
  id: string;
  sequence: number;
  label: string;
  /** ยอดรวม VAT ของงวดนี้ */
  amountInclVat: number;
  /** ค่า input type="date" */
  dueDate?: string;
  payStatus: VendorBillInstallmentPayStatus;
  paidAt?: number;
  paidByUid?: string;
  paidByName?: string;
  cashbookEntryId?: string;
  cashbookEntryNo?: string;
  paymentProofUrl?: string;
  paymentProofFileName?: string;
  vendorPayeeBankAccountId?: string;
  vendorPayeeBankName?: string;
  vendorPayeeBankAccountName?: string;
  vendorPayeeBankAccountNumber?: string;
}

export interface PurchaseVendorBill {
  id: string;
  receiptNo: string;
  purchaseId: string;
  /** snapshot เลขที่ PR — แสดงบนปะหน้าใบวางบิล */
  purchaseRequestNo?: string;
  /** ใบวางบิลอ้างสัญญาเช่าโดยตรง (ไม่ผ่าน PR/PO จริง) */
  rentalContractId?: string;
  /** เดือนค่าเช่าที่วางบิล (YYYY-MM) */
  rentalPeriodMonth?: string;
  /** snapshot เลขสัญญาเช่า */
  rentalContractNo?: string;
  /** snapshot ณ สร้าง/ส่ง — ใช้แยกเวิร์กโฟลว์เงินสด vs เครดิต */
  purchaseType?: PurchaseType;
  /** ผูกกับงวดชำระ (ถ้ามี) */
  milestoneId?: string;
  /**
   * แผนแบ่งจ่ายภายในใบเดียว (คลังกำหนด 1–N งวด) — ว่าง = จ่ายครั้งเดียวเต็มยอด (พฤติกรรมเดิม)
   * เมื่อมีรายการนี้ ระบบจะติดตามยอดค้างในเจ้าหนี้ตามงวดที่จ่ายแล้ว / ยังไม่จ่าย
   */
  paymentInstallments?: VendorBillPaymentInstallment[];
  /**
   * ปิดเรื่องเอกสารตามเช็คลิส (ใบกำกับภาษี + ใบเสร็จรับเงินครบ) — สถานะปิดสมบูรณ์ทางเอกสาร
   * แยกจากการจ่ายเงินครบทุกงวด
   */
  vendorBillDocumentationClosed?: boolean;
  vendorBillDocumentationClosedAt?: number;
  vendorBillDocumentationClosedByUid?: string;
  vendorBillDocumentationClosedByName?: string;
  /** ยอดในใบนี้ — ถ้าไม่ระบุให้ใช้ยอดสุทธิทั้งใบสั่งซื้อ (ของเก่า) */
  billAmount?: number;
  /** ทับการตีความ VAT จาก PO (ถ้าไม่มี = ใช้ยอดภาษีใน PO) */
  billVatTreatment?: VendorBillVatTreatmentOverride;
  /**
   * บัญชีบังคับเปิด/ปิดหัก ณ ที่จ่ายเฉพาะใบนี้ (หลังสโตร์ส่งบัญชี)
   * ไม่ระบุ = ตาม purchase.supplierWithholdingEnabled
   */
  supplierWithholdingEnabledBill?: boolean;
  /** 1. ใบส่งของ — เลขที่/วันที่เมื่อมีติ๊ก */
  supportingDeliveryNote?: VendorBillSupportingDocumentLink;
  /** 2. ใบกำกับภาษี */
  supportingTaxInvoice?: VendorBillSupportingDocumentLink;
  /** 3. ใบเสร็จรับเงิน (จากคู่ค้า) */
  supportingMoneyReceipt?: VendorBillSupportingDocumentLink;
  /** สำหรับแสดงผล */
  purchaseNo?: string;
  vendorId: string;
  /** วันที่รับวางบิล */
  billingReceivedDate: string;
  /** วันที่ตั้งใจจ่ายเงิน */
  plannedPaymentDate: string;
  status: PurchaseVendorBillStatus;
  submittedToAccountingAt?: number;
  paidAt?: number;
  paidByUid?: string;
  paidByName?: string;
  /** รายการ cashbook ที่สร้างตอนบันทึกจ่าย (Step 5) */
  cashbookEntryId?: string;
  cashbookEntryNo?: string;
  /** หลักฐานการจ่าย (URL จาก Storage — มักเป็น PDF) */
  paymentProofUrl?: string;
  paymentProofFileName?: string;
  /** บัญชีรับโอนของคู่ค้าที่เลือกตอนทำจ่าย (snapshot) */
  vendorPayeeBankAccountId?: string;
  vendorPayeeBankName?: string;
  vendorPayeeBankAccountName?: string;
  vendorPayeeBankAccountNumber?: string;
  /** หลักฐานแนบหัก ณ ที่จ่าย (PDF) — เมื่อมีการหัก ณ ที่จ่ายในบิลนี้ */
  whtPaymentProofUrl?: string;
  whtPaymentProofFileName?: string;
  notes?: string;
  /** ลิงก์หนังสือรับรองหัก ณ ที่จ่าย (withholding_certificate_documents) */
  whtCertificateDocumentId?: string;
  /** เลือกจากเมนูบัญชี (ค่าขนส่ง 1% / ค่าบริการ 3% / ค่าเช่า 5%) — ใช้แทนอัตราจาก PO เมื่อมีค่า */
  vendorBillWhtPresetCategory?: VendorBillWhtPresetCategory;
  /**
   * บัญชีแก้อัตราหัก ณ ที่จ่ายเฉพาะใบนี้ (ก่อนจ่าย) เมื่อสโตร์ลง % จาก PO ผิด — ถ้าไม่มีใช้ purchase.supplierWithholdingRatePercent
   * เมื่อเลือก preset ระบบจะซิงค์ค่านี้ให้ตรงกับอัตรา preset
   */
  supplierWithholdingRatePercentBill?: number;
  /**
   * ฐานเงินที่ใช้คำนวณหัก ณ ที่จ่าย (ก่อนภาษี) เฉพาะใบนี้ — เมื่อไม่ระบุ ระบบใช้ยอดก่อนภาษีตามสัดส่วน/VAT ของใบ
   * ใช้เมื่อฐานหักตามกฎไม่เท่ากับยอดก่อนภาษีที่แสดงในใบวางบิล (ค่าไม่เกินยอดรวมในใบก่อนหัก ณ ที่จ่าย)
   */
  supplierWithholdingTaxBaseBill?: number | null;
  createdAt: number;
  updatedAt: number;
}

/** นิติบุคคล (บริษัท/ห้าง) vs บุคคลธรรมดา — ใช้ซ่อนสาขาในฟอร์มและพิมพ์หัก ณ ที่จ่ายให้ถูกต้อง */

export type VendorLegalForm = 'JURISTIC' | 'NATURAL';

/** บัญชีธนาคารของคู่ค้า (รับโอน) */

export interface VendorBankAccount {
  id: string;
  /** ชื่อเรียกสั้น ๆ เช่น บัญชีหลัก / บัญชีค่าบริการ */
  label?: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  isPrimary?: boolean;
}

export interface Vendor {
  id: string;
  vendorCode: string;
  vendorName: string;
  vendorType: VendorType;
  /** ไม่ระบุ = ถือเป็นนิติบุคคล (พฤติกรรมเดิม) */
  vendorLegalForm?: VendorLegalForm;
  taxId: string;
  branchType?: 'head_office' | 'branch';
  branchNo: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** รายละเอียดสินค้าหรือการบริการที่คู่ค้าจัดหา */
  goodsOrServicesDetail?: string;
  /** รูปแบบการชำระเงิน: เงินสด / เครดิต (เก็บเป็นข้อความ Cash | Credit) */
  paymentTerms?: 'Cash' | 'Credit' | string;
  creditDays?: number;
  defaultCurrency?: string;
  /**
   * บัญชีรับเงินของคู่ค้า (หลายบัญชีได้) — ใช้เลือกตอนทำจ่ายโอนเข้า
   * ฟิลด์ bankName / bankAccountName / bankAccountNumber ด้านล่าง = สำเนาบัญชีหลัก (backward compatible)
   */
  bankAccounts?: VendorBankAccount[];
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  status: 'ACTIVE' | 'INACTIVE';
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type VendorType = 
  | 'PPE_SUPPLIER' 
  | 'TOOL_SUPPLIER' 
  | 'SERVICE_PROVIDER' 
  | 'TRANSPORT' 
  | 'ACCOMMODATION' 
  | 'OFFICE_EXPENSE' 
  | 'GENERAL_SUPPLIER';

