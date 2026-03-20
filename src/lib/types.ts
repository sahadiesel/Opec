/**
 * OPEC OpsFlow - Master TypeScript Data Models
 * Refined for Production Readiness with clear Staff vs Worker separation.
 */

export type DeptType = 'admin' | 'hr' | 'operations' | 'sales' | 'accounting' | 'store' | 'client';
export type AccessLevel = 'viewer' | 'officer' | 'manager' | 'admin';

/** Job Policy Modes */
export type JobMode = 'ONSHORE' | 'OFFSHORE';

export type RoleType = 
  | 'system_admin'
  | 'finance_officer'
  | 'sales_officer'
  | 'safety_officer'
  | 'hr_manager'
  | 'hr_officer'
  | 'operations_officer'
  | 'payroll_officer'
  | 'store_officer'
  | 'client_user'
  | 'client'; 

/** Business Role Keys for Simple Mode */
export type BusinessRoleKey = 
  | 'system_admin'
  | 'sales_manager'
  | 'sales_officer'
  | 'hr_manager'
  | 'hr_officer'
  | 'operations_manager'
  | 'operations_officer'
  | 'accounting_manager'
  | 'accounting_officer'
  | 'store_officer'
  | 'client_viewer'
  | 'client_approver';

/** Readiness Status for Workers (ลูกจ้าง) */
export type ReadinessStatus = 
  | 'READY'               // พร้อมปฏิบัติงาน
  | 'INCOMPLETE'          // ข้อมูลไม่ครบถ้วน
  | 'MISSING_CERTIFICATE' // ขาดใบรับรองบังคับ
  | 'MEDICAL_EXPIRED'     // ใบรับรองแพทย์หมดอายุ
  | 'DRUG_TEST_EXPIRED'   // ผลตรวจสารเสพติดหมดอายุ
  | 'DOCUMENT_EXPIRED'    // เอกสารระบุตัวตนหมดอายุ
  | 'BLOCKED';            // ระงับการส่งตัว (วินัย/อื่นๆ)

/** Employment Status for Workers (ลูกจ้าง) */
export type WorkerStatus = 
  | 'AVAILABLE'           // ว่างงาน/พร้อมรับงาน
  | 'ASSIGNED'            // มอบหมายงานแล้ว
  | 'ON_SITE'             // ปฏิบัติงานหน้างาน
  | 'ON_LEAVE'            // พักร้อน/พักกะ
  | 'INACTIVE'            // พ้นสภาพ
  | 'BLACKLISTED';        // บัญชีดำ

/** Deployment/Mobilization Status */
export type DeploymentStatus = 
  | 'DRAFT'               // ร่างรายการ
  | 'READINESS_CHECK'     // อยู่ระหว่างตรวจความพร้อม
  | 'CLIENT_SUBMITTED'    // ส่งรายชื่อให้ลูกค้าพิจารณา
  | 'CLIENT_APPROVED'     // ลูกค้าอนุมัติแล้ว
  | 'READY_TO_MOB'        // พร้อมเดินทาง
  | 'MOBILIZING'          // อยู่ระหว่างเดินทาง
  | 'ACTIVE'              // ปฏิบัติงาน (On-site)
  | 'DEMOBILIZED'         // จบภารกิจ/เดินทางกลับ
  | 'CLOSED';             // ปิดรายการ

export type ClientApprovalStatus = 
  | 'NOT_SUBMITTED'       // ยังไม่ส่งข้อมูล
  | 'PENDING'             // รอพิจารณา
  | 'APPROVED'            // อนุมัติ
  | 'REJECTED';           // ขอเปลี่ยนตัว/ไม่ผ่าน

export type WaveStatus = 
  | 'PLANNING'            // วางแผน
  | 'RECRUITING'          // สรรหา/มอบหมาย
  | 'MOBILIZING'          // ดำเนินการส่งตัว
  | 'ACTIVE'              // กำลังดำเนินโครงการ
  | 'COMPLETED'           // จบโครงการ
  | 'CLOSED';             // ปิดโครงการและสรุปบัญชี

export type PayrollRunStatus = 
  | 'DRAFT'               // ฉบับร่าง
  | 'PROCESSING'          // กำลังคำนวณ
  | 'HR_REVIEW'           // รอฝ่ายบุคคลตรวจสอบ
  | 'HR_APPROVED'         // ฝ่ายบุคคลอนุมัติ
  | 'FINANCE_APPROVED'    // ฝ่ายการเงินอนุมัติจ่าย
  | 'PAID'                // จ่ายเงินแล้ว
  | 'LOCKED'              // ปิดงวดถาวร
  | 'CANCELLED';          // ยกเลิก

export type BillingStatus = 
  | 'DRAFT'               // ฉบับร่าง
  | 'ISSUED'              // ออกเอกสารแล้ว
  | 'SUBMITTED'           // ส่งลูกค้าแล้ว
  | 'PARTIALLY_PAID'      // ชำระบางส่วน
  | 'PAID'                // ชำระครบถ้วน
  | 'OVERDUE'             // เกินกำหนดชำระ
  | 'CANCELLED';          // ยกเลิก

export type ApprovalStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

export interface User {
  id: string;
  email: string;
  displayName: string;
  department: DeptType;
  level: AccessLevel;
  roleIds: RoleType[];
  isActive: boolean;
  approvalStatus: ApprovalStatus;
  permissionProfileKey?: string | null;
  assignedRoleKey?: BusinessRoleKey | null; // For simplified UI
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  lastLogoutAt?: number;
  notes?: string;
  customerId?: string | null;
}

export interface PermissionProfile {
  id: string;
  profileKey: string;
  profileNameTh: string;
  profileNameEn: string;
  department: DeptType;
  level: AccessLevel;
  isActive: boolean;
  permissions: Record<string, ModulePermission>;
  updatedAt: number;
  updatedBy: string;
  createdAt?: number;
  createdBy?: string;
  notes?: string;
}

export interface ModulePermission {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
}

export interface Position {
  id: string;
  positionCode: string;
  positionNameTh: string;
  positionNameEn: string;
  category: 'OFFSHORE' | 'ONSHORE' | 'OFFICE';
  jobMode: JobMode;
  payrollBasis: 'DAILY' | 'MONTHLY' | 'HOURLY';
  active: boolean;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Worker {
  id: string;
  workerCode: string;
  firstName: string;
  lastName: string;
  nickname?: string;
  thaiNationalId: string;
  passportNo?: string;
  dateOfBirth: number;
  nationality: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  contactPhone: string;
  email?: string;
  address?: string;
  currentPositionId: string;
  jobMode: JobMode;
  workerStatus: WorkerStatus;
  readinessStatus: ReadinessStatus;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  skills: string[];
  notes?: string;
  disciplinaryNotes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PositionCertificateRequirement {
  id: string;
  certificateName: string;
  certificateCode: string;
  required: boolean;
  validityMonths: number;
  notes?: string;
}

export interface PositionPPERequirement {
  id: string;
  itemName: string;
  itemCode: string;
  quantityDefault: number;
  required: boolean;
  notes?: string;
}

export interface PositionToolRequirement {
  id: string;
  itemName: string;
  itemCode: string;
  itemType: 'tool' | 'equipment' | 'consumable';
  quantityDefault: number;
  allowed: boolean;
  notes?: string;
}

export interface OfficeStaff {
  id: string;
  staffCode: string;
  fullName: string;
  nickname?: string;
  department: string;
  positionTitle: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  salaryType: 'MONTHLY' | 'DAILY';
  monthlySalary: number;
  startDate: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  taxId?: string;
  socialSecurityNo?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'RESIGNED';
  notes?: string;
  linkedUserId?: string;
  supervisorId?: string;
  createdAt: number;
  createdBy?: string;
  updatedAt: number;
  updatedBy?: string;
}

export interface Customer {
  id: string;
  customerCode: string;
  name: string;
  taxId: string;
  registeredAddress: string;
  billingAddress: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  creditTerms?: string;
  billingTerms?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContactPerson {
  id: string;
  name: string;
  department: string;
  role: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  notes?: string;
}

export interface MainContract {
  id: string;
  contractNumber: string;
  customerId: string;
  title: string;
  projectId?: string;
  startDate: number;
  endDate: number;
  status: 'pending' | 'active' | 'expired' | 'closed';
  currency: string;
  billingTerms: string;
  paymentTerms: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PositionRate {
  id: string;
  positionId: string;
  sellRate: number;
  costBaseline: number;
  billingUnit: 'daily' | 'monthly' | 'hourly';
  active: boolean;
  overtimeRule: string;
  notes?: string;
}

export interface PurchaseOrder {
  id: string;
  poCode: string;
  contractId: string;
  customerId: string;
  title: string;
  projectName: string;
  description: string;
  startDate: number;
  endDate: number;
  status: 'pending' | 'active' | 'closed';
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface POLine {
  id: string;
  poId: string;
  positionId: string;
  quantity: number;
  startDate: number;
  endDate: number;
  sellRateSnapshot: number;
  costBaselineSnapshot: number;
  billingUnitSnapshot: string;
  overtimeRuleSnapshot: string;
  status: 'active' | 'cancelled' | 'completed';
}

export type SalesContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'CLOSED' | 'CANCELLED';

export interface SalesContractTerm {
  id: string;
  customerId: string;
  mainContractId: string;
  purchaseOrderId: string;
  title: string;
  contractNo: string;
  status: SalesContractStatus;
  effectiveDate: string; // Date-only string (e.g., YYYY-MM-DD)
  endDate: string; // Date-only string (e.g., YYYY-MM-DD)
  currency: string;
  billingCycle: string;
  paymentTermsDays: number;
  vatPercent: number;
  withholdingTaxPercent: number;
  notes?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface Assignment {
  id: string;
  assignmentNo: string;
  workerId: string;
  waveId: string;
  poId: string;
  poLineId: string;
  positionId: string;
  customerId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  deploymentStatus: DeploymentStatus;
  clientApprovalStatus: ClientApprovalStatus;
  readinessStatus: 'incomplete' | 'ready';
  readinessSummary: {
    passportValid: ChecklistItemStatus;
    medicalValid: ChecklistItemStatus;
    certificatesComplete: ChecklistItemStatus;
    safetyTrainingComplete: ChecklistItemStatus;
    fitToWork: ChecklistItemStatus;
    ppeIssued: ChecklistItemStatus;
    toolsIssued: ChecklistItemStatus;
    overlapClear: ChecklistItemStatus;
    clientApproved: ChecklistItemStatus;
  };
  clientComments?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type ChecklistItemStatus = 'pass' | 'fail' | 'warning' | 'missing';

export interface Wave {
  id: string;
  waveCode: string;
  poId: string;
  poLineId: string;
  customerId: string;
  projectName: string;
  siteLocation: string;
  startDate: string;
  endDate: string;
  status: WaveStatus;
  plannedWorkers: number;
  assignedWorkers: number;
  rotationPattern: string;
  mobilizationDate?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** Central Audit Log for security and compliance */
export interface AuditLog {
  id: string;
  actionType: string; // e.g., 'CREATE', 'APPROVE', 'REJECT', 'LOCK'
  entityType: string; // e.g., 'DailyTimesheet', 'PayrollBatch'
  entityId: string;
  entityLabel?: string; // Descriptive name for logs (e.g., Worker Name or PO Code)
  actorUserId: string;
  actorName: string;
  actorRole: string;
  permissionProfileKey?: string | null;
  sourceModule?: string;
  sourcePath?: string;
  linkedIds?: string[];
  beforeSummary?: string;
  afterSummary?: string;
  changedFields?: string[];
  reasonCode?: string;
  reasonText?: string;
  eventAt: number;
  requestId?: string;
  sessionId?: string;
}

export interface ClientUser {
  id: string;
  customerId: string;
  email: string;
  displayName: string;
  isSharedAccount: boolean;
  active: boolean;
  createdAt: number;
}

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
}

export interface AccountsReceivable {
  id: string;
  customerId: string;
  documentNo: string;
  referenceType: 'TAX_INVOICE' | 'BILLING_NOTE';
  referenceId: string;
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
  status: BankAccountStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type BankAccountType = 'SAVINGS' | 'CURRENT' | 'CASH';
export type BankAccountStatus = 'ACTIVE' | 'INACTIVE';

export interface BillingNote {
  id: string;
  billingNoteNo: string;
  customerId: string;
  contractId?: string;
  poId?: string;
  billingDate: string;
  dueDate: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  amountBeforeTax: number;
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

export type BillingNoteStatus = 'DRAFT' | 'ISSUED' | 'SUBMITTED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export interface BillingNoteLine {
  id: string;
  billingNoteId: string;
  description: string;
  referenceType: BillingNoteReferenceType;
  referenceId?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  createdAt: number;
  updatedAt: number;
}

export type BillingNoteReferenceType = 'CONTRACT' | 'PO' | 'TIMESHEET' | 'SERVICE';

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
}

export type CashbookEntryType = 'CUSTOMER_RECEIPT' | 'SUPPLIER_PAYMENT' | 'PAYROLL' | 'TAX' | 'TRANSFER' | 'OTHER';
export type PaymentMethod = 'TRANSFER' | 'CASH' | 'CHEQUE' | 'OTHER';

export interface OfficePayrollRun {
  id: string;
  payrollRunNo: string;
  payrollMonth: string; // YYYY-MM
  payrollPeriodStart: string;
  payrollPeriodEnd: string;
  status: PayrollRunStatus;
  staffCount: number;
  grossAmount: number;
  totalAllowances: number;
  totalDeductions: number;
  netAmount: number;
  hrApprovedBy?: string;
  financeApprovedBy?: string;
  lockedAt?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OfficePayrollLine {
  id: string;
  staffId: string;
  staffName: string;
  department: string;
  positionTitle: string;
  baseSalary: number;
  allowance: number;
  bonus: number;
  deductions: number;
  tax: number;
  socialSecurity: number;
  grossPay: number;
  netPay: number;
  createdAt: number;
  updatedAt: number;
}

export interface PayrollRun {
  id: string;
  payrollRunNo: string;
  payrollPeriodStart: string;
  payrollPeriodEnd: string;
  payrollType: PayrollType;
  currency: string;
  status: PayrollRunStatus;
  workerCount: number;
  grossAmount: number;
  totalAllowance: number;
  totalDeduction: number;
  netAmount: number;
  sourceTimesheetBatchIds: string[];
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  hrApprovedAt?: number;
  hrApprovedBy?: string;
  financeApprovedAt?: number;
  financeApprovedBy?: string;
  lockedAt?: number;
  lockedBy?: string;
  notes?: string;
}

export type PayrollType = 'MONTHLY' | 'WAVE_BASED' | 'SPECIAL_RUN' | 'ADJUSTMENT';

export interface PayrollLine {
  id: string;
  workerId: string;
  assignmentId: string;
  waveId: string;
  positionId: string;
  normalDays: number;
  normalHours: number;
  otHours15: number;
  otHours20: number;
  otHours30: number;
  holidayHours: number;
  standbyDays: number;
  travelDays: number;
  unpaidDays: number;
  baseRateSnapshot: number;
  otRateSnapshot: number;
  allowanceSnapshot: number;
  deductionSnapshot: number;
  grossPay: number;
  totalAllowance: number;
  totalDeduction: number;
  netPay: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Purchase {
  id: string;
  purchaseNo: string;
  vendorId: string;
  purchaseDate: string;
  purchaseType: PurchaseType;
  amountBeforeTax: number;
  vatAmount: number;
  totalAmount: number;
  storeReceiptStatus: 'PENDING' | 'PARTIAL' | 'COMPLETED';
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  status: PurchaseStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type PurchaseType = 'CASH' | 'CREDIT';
export type PurchaseStatus = 'DRAFT' | 'ISSUED' | 'COMPLETED' | 'CANCELLED';

export interface PurchaseLine {
  id: string;
  purchaseId: string;
  itemDescription: string;
  itemId?: string; // Optional if not a master item
  quantity: number;
  unitPrice: number;
  amount: number;
  createdAt: number;
}

export interface Receipt {
  id: string;
  receiptNo: string;
  customerId: string;
  receiptDate: string;
  paymentMethod: PaymentMethod;
  bankAccountId: string;
  receivedAmount: number;
  status: ReceiptStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type ReceiptStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';

export interface ReceiptAllocation {
  id: string;
  receiptId: string;
  taxInvoiceId: string;
  amountAllocated: number;
  createdAt: number;
}

export interface StoreItem {
  id: string;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  minimumStock: number;
  currentStock: number;
  isPPE: boolean;
  isTool: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StoreTransaction {
  id: string;
  itemId: string;
  transactionType: TransactionType;
  quantity: number;
  workerId?: string;
  assignmentId?: string;
  waveId?: string;
  transactionDate: string;
  referenceType?: string; // SLIP, RECEIPT, etc.
  referenceId?: string;
  notes?: string;
  createdAt: number;
  createdBy: string;
}

export type TransactionType = 'RECEIVE' | 'ISSUE' | 'RETURN' | 'WRITEOFF' | 'DAMAGED' | 'LOST';

export interface TaxInvoice {
  id: string;
  taxInvoiceNo: string;
  billingNoteId: string;
  customerId: string;
  issueDate: string;
  taxableAmount: number;
  vatAmount: number;
  withholdingTaxAmount: number;
  totalAmount: number;
  currency: string;
  status: TaxInvoiceStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type TaxInvoiceStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';

export interface Vendor {
  id: string;
  vendorCode: string;
  vendorName: string;
  vendorType: VendorType;
  taxId: string;
  branchNo: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  paymentTerms: string;
  creditDays: number;
  defaultCurrency: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankName: string;
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

export interface WorkerDocument {
  id: string;
  workerId: string;
  documentType: string;
  documentNo: string;
  documentUrl?: string;
  issueDate: number;
  expiryDate: number;
  status: 'valid' | 'expired' | 'missing';
  createdAt: number;
  updatedAt: number;
  _path?: string;
}

export interface WorkerMedicalRecord {
  id: string;
  workerId: string;
  medicalType: string;
  examDate: number;
  expiryDate: number;
  fitStatus: 'fit' | 'unfit' | 'fit_with_restrictions';
  hospitalOrClinic: string;
  documentUrl?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  _path?: string;
}

export interface WorkerDrugTest {
  id: string;
  workerId: string;
  testDate: number;
  expiryDate: number;
  result: 'negative' | 'positive';
  laboratory: string;
  documentUrl?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  _path?: string;
}

export interface WorkerCertificate {
  id: string;
  workerId: string;
  certificateName: string;
  certificateCode: string;
  certificateNo: string;
  issueDate: number;
  expiryDate: number;
  issuer?: string;
  documentUrl?: string;
  status: 'valid' | 'expired' | 'pending_renewal';
  createdAt: number;
  updatedAt: number;
  _path?: string;
}

export type MobilizationStatus = 'PENDING' | 'READY_TO_MOBILIZE' | 'MOBILIZING' | 'ACTIVE' | 'FAILED_CHECK';

/**
 * Additive models for Contract Terms
 */
export type LaborCostContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'CLOSED' | 'CANCELLED';
export type LaborScopeType = 'SPECIFIC_PO' | 'GENERAL_CUSTOMER' | 'PROJECT_BASED' | 'OTHER';

export interface LaborCostContractTerm {
  id: string;
  title: string;
  relatedCustomerId: string;
  relatedPurchaseOrderId: string;
  scopeType: LaborScopeType;
  status: LaborCostContractStatus;
  effectiveDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  notes?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Rate Calculation & Event Conditions
 */
export type RateConditionEventType = 
  | 'work_day' 
  | 'off_day_worked' 
  | 'public_holiday_worked' 
  | 'travel_day' 
  | 'standby_day' 
  | 'mobilization_day' 
  | 'demobilization_day' 
  | 'training_day' 
  | 'sick_leave_paid' 
  | 'vacation_paid' 
  | 'unpaid_leave' 
  | 'night_shift' 
  | 'half_day' 
  | 'early_return' 
  | 'client_cancellation' 
  | 'replacement_day' 
  | 'other';

export type RateConditionParentType = 'SALES_CONTRACT' | 'LABOR_COST_CONTRACT' | 'PO_SNAPSHOT' | 'WAVE_SNAPSHOT';
export type RateConditionAppliesTo = 'SALES' | 'COST';
export type RateConditionUnitType = 'DAY' | 'HALF_DAY' | 'HOUR' | 'TRIP' | 'FIXED';
export type RateConditionCalculationMethod = 'FLAT' | 'MULTIPLIER' | 'PERCENTAGE' | 'FORMULA';

export interface RateCondition {
  id: string;
  parentType: RateConditionParentType;
  parentId: string;
  appliesTo: RateConditionAppliesTo;
  workerCategoryId?: string;
  positionId?: string;
  siteId?: string;
  workMode: JobMode | 'BOTH';
  eventType: RateConditionEventType;
  unitType: RateConditionUnitType;
  calculationMethod: RateConditionCalculationMethod;
  baseRate?: number;
  multiplier?: number;
  percentageOfBase?: number;
  fixedAmount?: number;
  minimumUnits?: number;
  roundingRule?: 'UP' | 'DOWN' | 'NEAREST';
  payableConditionText?: string;
  billableConditionText?: string;
  requiresApproval: boolean;
  effectiveDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  displayOrder: number;
  isActive: boolean;
}

/**
 * Additive Snapshot Models for Pricing Stability
 */

/**
 * Deep snapshot of all commercial and cost rules applicable to a PO.
 */
export interface PurchaseOrderCommercialSnapshot {
  id: string;
  purchaseOrderId: string;
  effectiveDateContext: string; // YYYY-MM-DD
  salesContractTermIdSnapshot: string;
  laborCostContractTermIdSnapshot: string;
  // Deep copies of conditions to prevent historical changes from affecting logic
  salesConditionsSnapshot: RateCondition[];
  costConditionsSnapshot: RateCondition[];
  currencySnapshot: string;
  summaryNote?: string;
  createdAt: number;
  createdBy: string;
}

/**
 * Locks in the rates for a specific wave deployment.
 */
export interface WaveRateSnapshot {
  id: string;
  waveId: string;
  poCommercialSnapshotId: string;
  // Allows for wave-specific overrides if needed, otherwise derived from PO snapshot
  appliedConditionsSnapshot: RateCondition[];
  effectiveStartDate: string;
  effectiveEndDate: string;
  createdAt: number;
  createdBy: string;
}

/**
 * Worker Payment Profile for Payroll and Financial Tracking
 */
export type WorkerPaymentMethod = 'BANK_TRANSFER' | 'CASH' | 'PROMPTPAY' | 'OTHER';
export type WorkerPaymentProfileStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING_VERIFICATION';

export interface WorkerPaymentProfile {
  id: string;
  workerId: string;
  paymentMethod: WorkerPaymentMethod;
  bankCode?: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  branchName?: string;
  promptPayId?: string;
  isPrimary: boolean;
  effectiveDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  attachmentUrl?: string;
  status: WorkerPaymentProfileStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Daily Timesheet for precise tracking of worker activity
 */
export type DailyTimesheetStatus = 
  | 'DRAFT' 
  | 'SUBMITTED' 
  | 'OPS_REVIEWED' 
  | 'CLIENT_APPROVED' 
  | 'LOCKED' 
  | 'REJECTED' 
  | 'CORRECTION_REQUIRED';

export type TimesheetShiftType = 'DAY' | 'NIGHT' | 'MIXED' | 'STANDBY';

export interface DailyTimesheet {
  id: string;
  date: string; // YYYY-MM-DD
  workerId: string;
  workerNameSnapshot: string;
  assignmentId: string;
  waveId: string;
  contractId: string;
  salesContractTermId?: string;
  laborCostContractTermId?: string;
  purchaseOrderId: string;
  siteId: string;
  positionId: string;
  workMode: JobMode;
  eventType: RateConditionEventType;
  shiftType: TimesheetShiftType;
  normalHours: number;
  ot15Hours: number;
  ot20Hours: number;
  ot30Hours: number;
  holidayHours: number;
  standbyUnits: number;
  travelUnits: number;
  mobUnits: number;
  demobUnits: number;
  paidLeaveUnits: number;
  unpaidLeaveUnits: number;
  quantityOverride?: number | null;
  remark?: string;
  evidenceAttachments: string[];
  status: DailyTimesheetStatus;
  submittedBy?: string;
  submittedAt?: number;
  opsReviewedBy?: string;
  opsReviewedAt?: number;
  clientApprovedBy?: string;
  clientApprovedAt?: number;
  lockedBy?: string;
  lockedAt?: number;
  rejectionReason?: string;
  correctionReason?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Worker Wave Acceptance for detailed tracking of client approvals/rejections per assignment.
 */
export type WorkerWaveAcceptanceStatus = 'pending' | 'accepted' | 'rejected' | 'replacement_requested';

export interface WorkerWaveAcceptance {
  id: string;
  waveId: string;
  assignmentId: string;
  workerId: string;
  customerPortalUserId: string;
  status: WorkerWaveAcceptanceStatus;
  remark?: string;
  approvedDate?: string; // YYYY-MM-DD
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Payroll Period for cycle management
 */
export type PayrollCycleType = 'MONTHLY' | 'FORTNIGHTLY' | 'WEEKLY' | 'CUSTOM';
export type PayrollPeriodStatus = 'OPEN' | 'PROCESSING' | 'LOCKED' | 'CLOSED';

export interface PayrollPeriod {
  id: string;
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  cycleType: PayrollCycleType;
  status: PayrollPeriodStatus;
  generatedBy: string;
  generatedAt: number;
}

/**
 * Payroll Batch for collective processing
 */
export interface PayrollBatch {
  id: string;
  payrollPeriodId: string;
  workModeScope: JobMode | 'BOTH';
  status: PayrollRunStatus;
  totalWorkers: number;
  grossAmount: number;
  totalDeductions: number;
  netAmount: number;
  notes?: string;
  hrApprovedBy?: string;
  hrApprovedAt?: number;
  financePreparedBy?: string;
  financePreparedAt?: number;
  lockedBy?: string;
  lockedAt?: number;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Payroll Batch Line for individual calculation snapshots
 */
export interface PayrollBatchLine {
  id: string;
  payrollBatchId: string;
  workerId: string;
  workerNameSnapshot: string;
  workerPaymentProfileSnapshot: Partial<WorkerPaymentProfile>;
  assignmentIds: string[];
  sourceTimesheetIds: string[];
  periodStartDate: string;
  periodEndDate: string;
  eventBreakdown: Record<string, number>; // Maps eventType to count/units
  earningsBreakdown: Record<string, number>; // Maps specific earning category to amount
  deductionsBreakdown: Record<string, number>; // Maps specific deduction category to amount
  grossAmount: number;
  netAmount: number;
  exportStatus: 'pending' | 'exported' | 'failed';
  remarks?: string;
}

/**
 * Batch for managing payment files for banks
 */
export type PaymentExportStatus = 'draft' | 'generated' | 'downloaded' | 'superseded';

export interface PaymentExportBatch {
  id: string;
  payrollBatchId: string;
  exportTemplateCode: string; // e.g., 'KBANK_PAYROLL_V1', 'SCB_DIRECT_DEBIT'
  companyBankAccountId: string;
  fileName?: string;
  fileUrl?: string;
  totalLines: number;
  totalAmount: number;
  status: PaymentExportStatus;
  generatedBy?: string;
  generatedAt?: number;
  createdBy: string;
  createdAt: number;
}

/**
 * Profit estimation snapshots for commercial analysis
 */
export interface PurchaseOrderProfitSnapshot {
  id: string;
  purchaseOrderId: string;
  waveId?: string | null;
  periodStartDate: string;
  periodEndDate: string;
  estimatedRevenue: number;
  estimatedLaborCost: number;
  estimatedGrossProfit: number;
  estimatedGrossMarginPercent: number;
  calculationBasisSummary: string;
  generatedAt: number;
  generatedBy: string;
}

/**
 * Document Numbering Sequence tracking
 */
export interface NumberSequence {
  id: string;
  sequenceKey: string;
  label: string;
  prefix: string;
  department: DeptType;
  entityType: string;
  resetPolicy: 'none' | 'yearly' | 'monthly';
  year?: number | null;
  month?: number | null;
  paddingLength: number;
  lastNumber: number;
  lastIssuedCode?: string | null;
  isActive: boolean;
  updatedAt: number;
  updatedBy: string;
}

export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export interface Quotation {
  id: string;
  quotationNo: string;
  customerId: string;
  title: string;
  description: string;
  totalAmount: number;
  currency: string;
  status: QuotationStatus;
  issueDate: string;
  expiryDate: string;
  notes?: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

export interface QuotationLine {
  id: string;
  quotationId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}
