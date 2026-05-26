/**
 * Mapping: UI module key → Firestore collection paths
 *
 * ใช้ generate `firestore.rules` จาก matrix overrides ในหน้า `/system-admin/menu-permissions`
 *
 * แต่ละ moduleKey อาจ map ไปยัง:
 *  - collection หลัก (เช่น `customers/{id}`)
 *  - subcollection (เช่น `customers/{customerId}/{document=**}`)
 *  - collection ที่เกี่ยวข้องในทาง business (เช่น module `worker_payroll` แตะ
 *    payroll_runs, payroll_batches, payroll_periods, worker_payment_profiles)
 *
 * โครงสร้างนี้เป็น manual mapping — admin/dev ต้องตรวจสอบและปรับเอง
 * generator (`generateRulesPreview`) อ่านข้อมูลนี้แล้วผลิตคำแนะนำเป็น text
 */

import type { ModuleKey } from '@/lib/permissions';

export interface FirestorePathSpec {
  /** Path pattern (ไม่ต้องมี `match` keyword) เช่น `customers/{id}` */
  path: string;
  /**
   * รูปแบบ rule ที่ต้องการให้สร้าง:
   * - 'crud'      = `allow read/create/update/delete` แยกตาม capability ของ module
   * - 'read-only' = อ่านได้อย่างเดียว (เช่น catalog หรือ portal view)
   * - 'admin-only' = `allow read, write: if isAdmin()` (ตั้งค่าระบบ)
   * - 'append-only' = create เปิด, update/delete admin only (เช่น audit logs)
   */
  shape?: 'crud' | 'read-only' | 'admin-only' | 'append-only';
  /** หมายเหตุพิเศษ (เช่น มี portal exception, มี wildcard subcollection ที่ต้องเขียนแยก) */
  note?: string;
}

export interface ModuleFirestoreSpec {
  /** moduleKey จาก `getPermissions()` */
  moduleKey: ModuleKey;
  /** ชื่อภาษาไทยสั้น ๆ — โผล่ใน generator output เป็น comment */
  label: string;
  /** กลุ่ม domain — ใช้จัดกลุ่ม output (commercial/hr/ops/accounting/admin) */
  domain: 'commercial' | 'hr' | 'ops' | 'store' | 'accounting' | 'admin' | 'portal' | 'self';
  /** Firestore paths ที่ module นี้ควบคุม */
  paths: FirestorePathSpec[];
  /** capability function prefix — generator จะตั้งชื่อ `can{Prefix}Matrix()` */
  fnPrefix: string;
  /** หมายเหตุระดับ module */
  note?: string;
}

/** TEMPLATE: เริ่มต้นด้วยรายการที่ตรวจสอบแล้วใน firestore.rules ปัจจุบัน (อาจไม่ครบ — admin/dev เติมได้) */
export const MODULE_FIRESTORE_SPECS: ModuleFirestoreSpec[] = [
  // ---------- Commercial ----------
  {
    moduleKey: 'customers',
    label: 'ทะเบียนลูกค้า',
    domain: 'commercial',
    fnPrefix: 'Customers',
    paths: [
      { path: 'customers/{id}', shape: 'crud' },
      { path: 'customers/{customerId}/{document=**}', shape: 'crud', note: 'subcollection ของลูกค้า' },
    ],
  },
  {
    moduleKey: 'quotations',
    label: 'ใบเสนอราคา',
    domain: 'commercial',
    fnPrefix: 'Quotations',
    paths: [
      { path: 'quotations/{id}', shape: 'crud' },
      { path: 'quotations/{quotationId}/lines/{lineId}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'main_contracts',
    label: 'สัญญาหลัก',
    domain: 'commercial',
    fnPrefix: 'MainContracts',
    paths: [
      { path: 'main_contracts/{id}', shape: 'crud' },
      { path: 'main_contracts/{contractId}/position_rates/{rateId}', shape: 'crud' },
      { path: 'main_contracts/{contractId}/{document=**}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'customer_pos',
    label: 'ใบสั่งซื้อลูกค้า',
    domain: 'commercial',
    fnPrefix: 'CustomerPos',
    paths: [
      { path: 'purchase_orders/{id}', shape: 'crud', note: 'portal customer อ่านได้ของตนเอง' },
      { path: 'purchase_orders/{poId}/po_lines/{lineId}', shape: 'crud' },
      { path: 'purchase_orders/{poId}/{document=**}', shape: 'crud' },
      { path: 'po_active_bundles/{id}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'sales_contract_terms',
    label: 'เงื่อนไขการขาย',
    domain: 'commercial',
    fnPrefix: 'SalesContractTerms',
    paths: [{ path: 'sales_contract_terms/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'rate_conditions',
    label: 'กฎการคำนวณราคา',
    domain: 'commercial',
    fnPrefix: 'RateConditions',
    paths: [{ path: 'rate_conditions/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'profit_estimates',
    label: 'ประมาณการกำไร',
    domain: 'commercial',
    fnPrefix: 'ProfitEstimates',
    paths: [{ path: 'profit_estimates/{id}', shape: 'crud' }],
  },

  // ---------- Operations Scheduling ----------
  {
    moduleKey: 'waves',
    label: 'Waves/รอบงาน',
    domain: 'ops',
    fnPrefix: 'Waves',
    paths: [
      { path: 'waves/{id}', shape: 'crud' },
      { path: 'worker_wave_acceptances/{id}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'assignments',
    label: 'การมอบหมาย',
    domain: 'ops',
    fnPrefix: 'Assignments',
    paths: [{ path: 'assignments/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'mobilization',
    label: 'การส่งตัว',
    domain: 'ops',
    fnPrefix: 'Mobilization',
    paths: [
      { path: 'mobilizations/{id}', shape: 'crud' },
      { path: 'mobilizations/{mobId}/fulfillment_lines/{lineId}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'draft_invoices',
    label: 'ใบแจ้งหนี้ (commercial invoice)',
    domain: 'ops',
    fnPrefix: 'CommercialInvoices',
    paths: [
      {
        path: 'commercial_invoices/{id}',
        shape: 'crud',
        note: 'รูปแบบ approval/PENDING_CUSTOMER/ISSUED ต้องคงไว้ใน match block เดิม — generator แตะแค่ baseline read/create',
      },
    ],
  },
  {
    moduleKey: 'operations_petty_cash',
    label: 'Petty Cash หน้างาน',
    domain: 'ops',
    fnPrefix: 'OperationsPettyCash',
    paths: [{ path: 'petty_cash_entries/{id}', shape: 'crud' }],
  },

  // ---------- Store / Vendor ----------
  {
    moduleKey: 'vendors',
    label: 'คู่ค้า',
    domain: 'store',
    fnPrefix: 'Vendors',
    paths: [{ path: 'vendors/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'purchases',
    label: 'ใบสั่งซื้อ (PO)',
    domain: 'store',
    fnPrefix: 'Purchases',
    paths: [
      { path: 'purchases/{purchaseId}', shape: 'crud' },
      { path: 'purchases/{purchaseId}/{document=**}', shape: 'crud' },
      { path: 'purchase_requests/{id}', shape: 'crud' },
      { path: 'purchase_requests/{prId}/{document=**}', shape: 'crud' },
      { path: 'purchase_vendor_bills/{id}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'store_inventory',
    label: 'คลังอุปกรณ์',
    domain: 'store',
    fnPrefix: 'StoreInventory',
    paths: [
      { path: 'store_items/{id}', shape: 'crud' },
      { path: 'store_transactions/{id}', shape: 'crud' },
      { path: 'store_receipts/{id}', shape: 'crud' },
      { path: 'store_issue_slips/{id}', shape: 'crud' },
      { path: 'store_return_slips/{id}', shape: 'crud' },
    ],
  },

  // ---------- HR / Payroll ----------
  {
    moduleKey: 'workers',
    label: 'ทะเบียนคนงาน',
    domain: 'hr',
    fnPrefix: 'Workers',
    paths: [
      { path: 'workers/{workerId}', shape: 'crud' },
      { path: 'workers/{workerId}/{document=**}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'positions',
    label: 'ตำแหน่งงาน',
    domain: 'hr',
    fnPrefix: 'Positions',
    paths: [
      { path: 'positions/{id}', shape: 'crud' },
      { path: 'positions/{positionId}/{document=**}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'office_staff',
    label: 'พนักงานออฟฟิศ',
    domain: 'hr',
    fnPrefix: 'OfficeStaff',
    paths: [{ path: 'office_staff/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'worker_documents',
    label: 'แคตตาล็อกเอกสารบุคลากร',
    domain: 'hr',
    fnPrefix: 'WorkerDocCatalog',
    paths: [{ path: 'worker_document_catalog/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'bank_registry',
    label: 'ทะเบียนธนาคาร',
    domain: 'hr',
    fnPrefix: 'BankNameCatalog',
    paths: [{ path: 'bank_name_catalog/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'sso_hospital_registry',
    label: 'ทะเบียนโรงพยาบาล สปส.',
    domain: 'hr',
    fnPrefix: 'SsoHospitalCatalog',
    paths: [{ path: 'sso_hospital_catalog/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'labor_cost_contract_terms',
    label: 'เงื่อนไขต้นทุนแรงงาน',
    domain: 'hr',
    fnPrefix: 'LaborCostContractTerms',
    paths: [{ path: 'labor_cost_contract_terms/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'timesheets',
    label: 'ลงเวลา',
    domain: 'hr',
    fnPrefix: 'Timesheets',
    paths: [
      { path: 'daily_timesheets/{id}', shape: 'crud' },
      { path: 'exception_requests/{id}', shape: 'crud' },
      { path: 'attendance_punches/{id}', shape: 'crud' },
      { path: 'attendance_correction_requests/{id}', shape: 'crud' },
      { path: 'attendance_day_overrides/{id}', shape: 'crud' },
      { path: 'leave_requests/{id}', shape: 'crud' },
      { path: 'wave_month_timesheet_reviews/{id}', shape: 'crud' },
      { path: 'po_month_timesheet_reviews/{id}', shape: 'crud' },
      { path: 'po_location_month_timesheets/{id}', shape: 'crud' },
      { path: 'monthly_timesheet_documents/{id}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'worker_payroll',
    label: 'จ่ายเงินคนงาน',
    domain: 'hr',
    fnPrefix: 'WorkerPayroll',
    paths: [
      { path: 'payroll_runs/{id}', shape: 'crud' },
      { path: 'payroll_batches/{id}', shape: 'crud' },
      { path: 'payroll_batches/{batchId}/lines/{lineId}', shape: 'crud' },
      { path: 'payroll_batches/{batchId}/{document=**}', shape: 'crud' },
      { path: 'payroll_periods/{id}', shape: 'crud' },
      { path: 'payroll_policies/{id}', shape: 'crud' },
      { path: 'worker_payment_profiles/{id}', shape: 'crud' },
      { path: 'payroll_correction_requests/{id}', shape: 'crud' },
      { path: 'payroll_wht_certificates/{id}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'payroll_runs',
    label: 'รอบจ่ายคนงาน',
    domain: 'hr',
    fnPrefix: 'PayrollRuns',
    paths: [{ path: 'payroll_runs/{id}', shape: 'crud', note: 'ทับซ้อน worker_payroll — เลือกใช้ฟังก์ชันใดฟังก์ชันหนึ่ง' }],
    note: 'โมดูลย่อย ภายใต้ worker_payroll',
  },
  {
    moduleKey: 'payslips',
    label: 'สลิปเงินเดือนคนงาน',
    domain: 'hr',
    fnPrefix: 'Payslips',
    paths: [{ path: 'payroll_batches/{batchId}/lines/{lineId}', shape: 'crud', note: 'payslip = batch line' }],
  },
  {
    moduleKey: 'office_payroll',
    label: 'เงินเดือนออฟฟิศ',
    domain: 'hr',
    fnPrefix: 'OfficePayroll',
    paths: [
      { path: 'office_payroll_runs/{id}', shape: 'crud' },
      { path: 'office_payroll_runs/{runId}/lines/{lineId}', shape: 'crud' },
      { path: 'office_payroll_runs/{runId}/{document=**}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'payment_export_batches',
    label: 'ไฟล์โอนเงินธนาคาร',
    domain: 'hr',
    fnPrefix: 'PaymentExportBatches',
    paths: [{ path: 'payment_export_batches/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'cash_advances',
    label: 'เบิกเงินล่วงหน้า',
    domain: 'hr',
    fnPrefix: 'CashAdvanceRequests',
    paths: [{ path: 'cash_advance_requests/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'hr_hub',
    label: 'ศูนย์กลาง HR (configuration)',
    domain: 'hr',
    fnPrefix: 'HrHub',
    paths: [{ path: 'hr_configuration/{docId}', shape: 'crud' }],
  },
  {
    moduleKey: 'employee_self_profile',
    label: 'โปรไฟล์ของฉัน',
    domain: 'self',
    fnPrefix: 'EmployeeSelfProfile',
    paths: [
      {
        path: 'workers/{workerId}',
        shape: 'crud',
        note: 'self read = own doc เท่านั้น — generator ไม่จัดการ doc-level scope แนะนำให้ตรวจสอบเอง',
      },
    ],
    note: 'logic ขอบเขต self ต้องเขียนใน match block เดิม — generator ออกเฉพาะ baseline gate',
  },

  // ---------- Accounting ----------
  {
    moduleKey: 'accounting_dashboard',
    label: 'แดชบอร์ดบัญชี',
    domain: 'accounting',
    fnPrefix: 'AccountingDashboard',
    paths: [],
    note: 'ไม่มี collection ผูกตรง — ใช้กรอง UI ในเมนูเท่านั้น',
  },
  {
    moduleKey: 'billing_notes',
    label: 'ใบวางบิลลูกหนี้',
    domain: 'accounting',
    fnPrefix: 'BillingNotes',
    paths: [
      { path: 'billing_notes/{id}', shape: 'crud' },
      { path: 'billing_notes/{billingNoteId}/lines/{lineId}', shape: 'crud' },
      { path: 'billing_notes/{billingNoteId}/{document=**}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'tax_invoices',
    label: 'ใบกำกับภาษี',
    domain: 'accounting',
    fnPrefix: 'TaxInvoices',
    paths: [
      { path: 'tax_invoices/{id}', shape: 'crud' },
      { path: 'tax_invoices/{taxInvoiceId}/{document=**}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'receipts',
    label: 'ใบเสร็จรับเงิน',
    domain: 'accounting',
    fnPrefix: 'Receipts',
    paths: [{ path: 'receipts/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'ap_bills',
    label: 'รับวางบิลเจ้าหนี้',
    domain: 'accounting',
    fnPrefix: 'ApBills',
    paths: [{ path: 'ap_bills/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'accounts_receivable',
    label: 'ลูกหนี้การค้า (AR)',
    domain: 'accounting',
    fnPrefix: 'AccountsReceivable',
    paths: [{ path: 'accounts_receivable/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'accounts_payable',
    label: 'เจ้าหนี้การค้า (AP)',
    domain: 'accounting',
    fnPrefix: 'AccountsPayable',
    paths: [{ path: 'accounts_payable/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'withholding_tax_items',
    label: 'หัก ณ ที่จ่าย',
    domain: 'accounting',
    fnPrefix: 'WithholdingTaxItems',
    paths: [
      { path: 'withholding_at_source_items/{id}', shape: 'crud' },
      { path: 'withholding_certificate_issues/{id}', shape: 'crud' },
      { path: 'withholding_certificate_documents/{id}', shape: 'crud' },
    ],
  },
  {
    moduleKey: 'cashbook',
    label: 'สมุดรับ-จ่าย',
    domain: 'accounting',
    fnPrefix: 'Cashbook',
    paths: [{ path: 'cashbook_entries/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'bank_accounts',
    label: 'บัญชีธนาคาร',
    domain: 'accounting',
    fnPrefix: 'BankAccounts',
    paths: [{ path: 'bank_accounts/{id}', shape: 'crud' }],
  },
  {
    moduleKey: 'executive_payroll',
    label: 'เงินเดือนผู้บริหาร',
    domain: 'accounting',
    fnPrefix: 'ExecutivePayroll',
    paths: [
      { path: 'executive_payroll_runs/{id}', shape: 'crud' },
      { path: 'executive_payroll_runs/{runId}/lines/{lineId}', shape: 'crud' },
      { path: 'executive_payroll_runs/{runId}/{document=**}', shape: 'crud' },
      { path: 'executive_payroll_staff/{id}', shape: 'crud' },
    ],
  },

  // ---------- Admin ----------
  {
    moduleKey: 'system_admin',
    label: 'จัดการระบบ',
    domain: 'admin',
    fnPrefix: 'SystemAdmin',
    paths: [
      { path: 'users/{userId}', shape: 'admin-only', note: 'user CRUD — ตรวจ portal กับ self read แยกใน match เดิม' },
      { path: 'roles_system_admin/{id}', shape: 'admin-only' },
      { path: 'permission_profiles/{id}', shape: 'admin-only' },
      { path: 'system/{docId}', shape: 'admin-only' },
    ],
  },
  {
    moduleKey: 'document_numbering',
    label: 'เลขที่เอกสาร',
    domain: 'admin',
    fnPrefix: 'DocumentNumbering',
    paths: [{ path: 'number_sequences/{id}', shape: 'crud', note: 'มี logic numberSequenceAllowsWrite เดิม — generator ออก gate เพิ่มเติมเท่านั้น' }],
  },
  {
    moduleKey: 'audit_logs',
    label: 'ประวัติกิจกรรม',
    domain: 'admin',
    fnPrefix: 'AuditLogs',
    paths: [{ path: 'audit_logs/{id}', shape: 'append-only', note: 'append-only: read admin / create internal' }],
  },

  // ---------- Portal ----------
  {
    moduleKey: 'client_portal',
    label: 'Client Portal',
    domain: 'portal',
    fnPrefix: 'ClientPortal',
    paths: [{ path: 'client_portal/{document=**}', shape: 'crud', note: 'portal scope ต่อ customerId ต้องเขียนใน match เดิม' }],
  },

  // ---------- Overview ----------
  {
    moduleKey: 'overview_dashboard',
    label: 'แดชบอร์ดหลัก',
    domain: 'self',
    fnPrefix: 'OverviewDashboard',
    paths: [],
    note: 'ไม่มี collection — เป็นแค่หน้า aggregate; ใช้ filter UI เท่านั้น',
  },
];

export function getModuleFirestoreSpec(moduleKey: ModuleKey): ModuleFirestoreSpec | undefined {
  return MODULE_FIRESTORE_SPECS.find((s) => s.moduleKey === moduleKey);
}
