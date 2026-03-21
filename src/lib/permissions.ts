
'use client';

/**
 * @fileOverview OPEC OpsFlow - Permissions & UI Access Utility
 * Primary source of truth for what a user can see and do.
 * Maps operational intents (e.g., "Generate Payroll") to the ModulePermission matrix.
 */

import { User, PermissionProfile, ModulePermission, DeptType, AccessLevel } from './types';
import { inferDeptAndLevel, isAdminUser } from './auth-mapping';

/**
 * Registry of all modules in the system.
 * This is the canonical source of truth for module keys and their UI groups.
 */
export const SYSTEM_MODULES = [
  { group: 'Overview', key: 'overview_dashboard', label: 'แดชบอร์ดหลัก (Main Dashboard)' },
  
  // Commercial
  { group: 'Commercial (การค้า)', key: 'customers', label: 'ทะเบียนลูกค้า (Customers)' },
  { group: 'Commercial (การค้า)', key: 'main_contracts', label: 'สัญญาหลัก (Contracts)' },
  { group: 'Commercial (การค้า)', key: 'customer_pos', label: 'ใบสั่งซื้อลูกค้า (Customer POs)' },
  { group: 'Commercial (การค้า)', key: 'quotations', label: 'ใบเสนอราคา (Quotations)' },
  { group: 'Commercial (การค้า)', key: 'sales_contract_terms', label: 'เงื่อนไขการขาย (Sales Terms)' },
  { group: 'Commercial (การค้า)', key: 'rate_conditions', label: 'กฎการคำนวณราคา (Rate Conditions)' },
  { group: 'Commercial (การค้า)', key: 'profit_estimates', label: 'ประมาณการกำไร (Profit Estimates)' },
  
  // HR & Payroll
  { group: 'HR & Payroll (บุคคล)', key: 'timesheets', label: 'ลงเวลาทำงาน (Timesheets)' },
  { group: 'HR & Payroll (บุคคล)', key: 'worker_payroll', label: 'จ่ายเงินคนงาน (Worker Payroll)' },
  { group: 'HR & Payroll (บุคคล)', key: 'office_payroll', label: 'เงินเดือนออฟฟิศ (Office Payroll)' },
  { group: 'HR & Payroll (บุคคล)', key: 'payment_export_batches', label: 'ไฟล์โอนเงินธนาคาร (Payment Exports)' },
  { group: 'HR & Payroll (บุคคล)', key: 'labor_cost_contract_terms', label: 'เงื่อนไขต้นทุน (Labor Cost Terms)' },
  { group: 'HR & Payroll (บุคคล)', key: 'positions', label: 'ตำแหน่งงาน (Positions)' },
  { group: 'HR & Payroll (บุคคล)', key: 'workers', label: 'ทะเบียนคนงาน (Workers)' },
  { group: 'HR & Payroll (บุคคล)', key: 'office_staff', label: 'พนักงานออฟฟิศ (Office Staff)' },
  
  // Operations
  { group: 'Operations (ปฏิบัติการ)', key: 'waves', label: 'กลุ่มรอบการทำงาน (Waves)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'assignments', label: 'การมอบหมายงาน (Assignments)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'mobilization', label: 'การเตรียมส่งตัว (Mobilization)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'vendors', label: 'คู่ค้า/ผู้ขาย (Vendors)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'purchases', label: 'การสั่งซื้อ (Purchases)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'store_inventory', label: 'คลังอุปกรณ์ (Store / Inventory)' },
  
  // Finance
  { group: 'Finance & Accounting (การเงิน)', key: 'billing_notes', label: 'ใบวางบิลลูกหนี้ (Billing Notes)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'tax_invoices', label: 'ใบกำกับภาษี (Tax Invoices)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'receipts', label: 'ใบเสร็จรับเงิน (Receipts)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'ap_bills', label: 'รับวางบิลเจ้าหนี้ (AP Bills)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'accounts_receivable', label: 'ลูกหนี้การค้า (AR)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'accounts_payable', label: 'เจ้าหนี้การค้า (AP)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'cashbook', label: 'รายรับรายจ่าย (Cashbook)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'bank_accounts', label: 'บัญชีธนาคาร (Bank Accounts)' },
  
  // System
  { group: 'Administration (ระบบ)', key: 'system_admin', label: 'จัดการผู้ใช้/ระบบ (System Admin)' },
  { group: 'Administration (ระบบ)', key: 'client_portal', label: 'Client Portal (หน้าของลูกค้า)' },
  { group: 'Administration (ระบบ)', key: 'document_numbering', label: 'รันเลขที่เอกสาร (Numbering)' },
  { group: 'Administration (ระบบ)', key: 'audit_logs', label: 'ประวัติกิจกรรม (Audit Logs)' },
] as const;

/**
 * Extract ModuleKey type from the registry
 */
export type ModuleKey = typeof SYSTEM_MODULES[number]['key'];

/**
 * Default Permission Templates
 */
export const FULL_ACCESS: ModulePermission = { view: true, create: true, edit: true, delete: true, approve: true };
export const OFFICER_ACCESS: ModulePermission = { view: true, create: true, edit: true, delete: false, approve: false };
export const READ_ONLY: ModulePermission = { view: true, create: false, edit: false, delete: false, approve: false };
export const NO_ACCESS: ModulePermission = { view: false, create: false, edit: false, delete: false, approve: false };

/**
 * Initial empty template for permissions
 */
export const INITIAL_PERMISSIONS_TEMPLATE: Record<string, ModulePermission> = 
  SYSTEM_MODULES.reduce((acc, mod) => ({ ...acc, [mod.key]: NO_ACCESS }), {});

/**
 * Baseline Permission Profile Definitions
 * Defines standard role-to-module mappings for the Opec OpsFlow platform.
 */
export function getBaselineProfiles(): Partial<PermissionProfile>[] {
  const baseline = (key: string, nameEn: string, nameTh: string, dept: DeptType, level: AccessLevel, perms: Record<string, Partial<ModulePermission>>) => ({
    profileKey: key,
    profileNameEn: nameEn,
    profileNameTh: nameTh,
    department: dept,
    level: level,
    isActive: true,
    notes: 'Generated by system baseline tool',
    permissions: SYSTEM_MODULES.reduce((acc, mod) => {
      const p = perms[mod.key] || NO_ACCESS;
      return { 
        ...acc, 
        [mod.key]: { ...NO_ACCESS, ...p } 
      };
    }, {} as Record<string, ModulePermission>)
  });

  return [
    // 1. Admin Admin
    baseline('admin_admin', 'System Administrator', 'ผู้ดูแลระบบสูงสุด', 'admin', 'admin', 
      SYSTEM_MODULES.reduce((acc, mod) => ({ ...acc, [mod.key]: FULL_ACCESS }), {})
    ),

    // 2. HR Manager
    baseline('hr_manager', 'HR Manager', 'ผู้จัดการฝ่ายบุคคล', 'hr', 'manager', {
      overview_dashboard: READ_ONLY,
      positions: { ...OFFICER_ACCESS, approve: true, delete: true },
      workers: { ...OFFICER_ACCESS, approve: true, delete: true },
      timesheets: { view: true, approve: true }, 
      worker_payroll: { view: true, create: true, approve: true }, 
      office_payroll: { view: true, create: true, approve: true },
      office_staff: { ...OFFICER_ACCESS, approve: true },
      waves: READ_ONLY,
      assignments: READ_ONLY,
      mobilization: READ_ONLY,
      labor_cost_contract_terms: { ...OFFICER_ACCESS, approve: true, delete: true },
      rate_conditions: { ...OFFICER_ACCESS, approve: true, delete: true },
      profit_estimates: READ_ONLY,
    }),

    // 3. HR Officer
    baseline('hr_officer', 'HR Officer', 'เจ้าหน้าที่ฝ่ายบุคคล', 'hr', 'officer', {
      overview_dashboard: READ_ONLY,
      positions: OFFICER_ACCESS,
      workers: OFFICER_ACCESS,
      timesheets: { view: true, create: true, edit: true }, 
      worker_payroll: { view: true }, 
      waves: READ_ONLY,
      assignments: READ_ONLY,
      mobilization: READ_ONLY,
      labor_cost_contract_terms: OFFICER_ACCESS,
      rate_conditions: OFFICER_ACCESS,
    }),

    // 4. Operations Manager
    baseline('operations_manager', 'Operations Manager', 'ผู้จัดการฝ่ายปฏิบัติการ', 'operations', 'manager', {
      overview_dashboard: READ_ONLY,
      waves: { ...OFFICER_ACCESS, approve: true, delete: true },
      assignments: { ...OFFICER_ACCESS, approve: true },
      mobilization: { ...OFFICER_ACCESS, approve: true },
      timesheets: { view: true, create: true, edit: true, approve: true }, 
      workers: READ_ONLY,
      positions: READ_ONLY,
      profit_estimates: READ_ONLY,
    }),

    // 5. Operations Officer
    baseline('operations_officer', 'Operations Officer', 'เจ้าหน้าที่ฝ่ายปฏิบัติการ', 'operations', 'officer', {
      overview_dashboard: READ_ONLY,
      waves: OFFICER_ACCESS,
      assignments: OFFICER_ACCESS,
      mobilization: OFFICER_ACCESS,
      timesheets: { view: true, create: true, edit: true }, 
      workers: READ_ONLY,
    }),

    // 6. Accounting Manager
    baseline('accounting_manager', 'Accounting Manager', 'ผู้จัดการฝ่ายบัญชี', 'accounting', 'manager', {
      overview_dashboard: READ_ONLY,
      billing_notes: { ...OFFICER_ACCESS, approve: true, delete: true },
      tax_invoices: { ...OFFICER_ACCESS, approve: true, delete: true },
      receipts: { ...OFFICER_ACCESS, approve: true },
      ap_bills: { ...OFFICER_ACCESS, approve: true },
      cashbook: { ...OFFICER_ACCESS, approve: true },
      bank_accounts: { ...OFFICER_ACCESS, approve: true },
      accounts_receivable: READ_ONLY,
      accounts_payable: READ_ONLY,
      worker_payroll: { view: true, edit: true, approve: true }, 
      office_payroll: { view: true, edit: true, approve: true },
      payment_export_batches: { view: true, create: true, approve: true }, 
      sales_contract_terms: READ_ONLY,
      labor_cost_contract_terms: READ_ONLY,
      rate_conditions: READ_ONLY,
      profit_estimates: READ_ONLY,
    }),

    // 7. Accounting Officer
    baseline('accounting_officer', 'Accounting Officer', 'เจ้าหน้าที่ฝ่ายบัญชี', 'accounting', 'officer', {
      overview_dashboard: OFFICER_ACCESS,
      billing_notes: OFFICER_ACCESS,
      tax_invoices: OFFICER_ACCESS,
      receipts: OFFICER_ACCESS,
      ap_bills: OFFICER_ACCESS,
      cashbook: OFFICER_ACCESS,
      accounts_receivable: READ_ONLY,
      accounts_payable: READ_ONLY,
      worker_payroll: { view: true },
      sales_contract_terms: READ_ONLY,
      labor_cost_contract_terms: READ_ONLY,
    }),

    // 8. Sales Manager
    baseline('sales_manager', 'Sales Manager', 'ผู้จัดการฝ่ายขาย', 'sales', 'manager', {
      overview_dashboard: READ_ONLY,
      customers: { ...OFFICER_ACCESS, approve: true, delete: true },
      main_contracts: { ...OFFICER_ACCESS, approve: true, delete: true },
      customer_pos: { ...OFFICER_ACCESS, approve: true },
      quotations: { ...OFFICER_ACCESS, approve: true, delete: true },
      sales_contract_terms: { ...OFFICER_ACCESS, approve: true, delete: true },
      rate_conditions: OFFICER_ACCESS,
      profit_estimates: READ_ONLY,
      billing_notes: READ_ONLY,
    }),

    // 9. Sales Officer
    baseline('sales_officer', 'Sales Officer', 'เจ้าหน้าที่ฝ่ายขาย', 'sales', 'officer', {
      overview_dashboard: READ_ONLY,
      customers: OFFICER_ACCESS,
      main_contracts: OFFICER_ACCESS,
      customer_pos: OFFICER_ACCESS,
      quotations: OFFICER_ACCESS,
      sales_contract_terms: OFFICER_ACCESS,
      profit_estimates: READ_ONLY,
    }),

    // 10. Store Officer
    baseline('store_officer', 'Store Officer', 'เจ้าหน้าที่คลังสินค้า', 'store', 'officer', {
      overview_dashboard: READ_ONLY,
      vendors: OFFICER_ACCESS,
      purchases: OFFICER_ACCESS,
      store_inventory: OFFICER_ACCESS,
      ap_bills: READ_ONLY,
    }),

    // 11. Client User
    baseline('client_user', 'Client User', 'ลูกค้า', 'client', 'viewer', {
      overview_dashboard: READ_ONLY,
      client_portal: { view: true, approve: true, edit: true }, 
      timesheets: { view: true, approve: true },
      workers: READ_ONLY,
      quotations: READ_ONLY,
      customer_pos: READ_ONLY,
    })
  ];
}

/**
 * Primary helper to check permissions for a specific module
 * Maps business "Intents" to the 5 standard boolean flags.
 */
export function getPermissions(
  user: User | null, 
  moduleKey: ModuleKey, 
  profile?: PermissionProfile | null
): ModulePermission {
  if (!user || !user.isActive) return NO_ACCESS;

  // 1. Full Admin Override - High Priority Bypass
  if (isAdminUser(user)) {
    return FULL_ACCESS;
  }

  // 2. Others must be approved to access anything
  if (user.approvalStatus !== 'ACTIVE') {
    return NO_ACCESS;
  }

  // 3. Profile-based check (Primary)
  if (profile && profile.isActive && profile.permissions?.[moduleKey]) {
    return profile.permissions[moduleKey];
  }

  // 4. Graceful Fallback Logic (Legacy Support & Automated Scoping)
  const { dept, level } = inferDeptAndLevel(user);
  
  if (moduleKey === 'overview_dashboard') return READ_ONLY;
  
  // 4a. Automated Customer Portal Fallbacks
  if (user.userType === 'customer_portal' || dept === 'client') {
    const isApprover = user.portalRole === 'approver' || level === 'manager';
    
    if (moduleKey === 'client_portal' || moduleKey === 'timesheets') {
      return isApprover ? { ...READ_ONLY, approve: true, edit: true } : READ_ONLY;
    }
    if (['workers', 'quotations', 'customer_pos', 'main_contracts'].includes(moduleKey)) {
      return READ_ONLY;
    }
    // Strict block on internal modules for customers
    return NO_ACCESS;
  }

  // 4b. Basic Internal Operational Fallbacks
  if (dept === 'hr' && ['workers', 'positions', 'timesheets', 'worker_payroll'].includes(moduleKey)) return OFFICER_ACCESS;
  if (dept === 'store' && ['store_inventory', 'vendors', 'purchases'].includes(moduleKey)) return OFFICER_ACCESS;
  if (dept === 'accounting' && ['cashbook', 'billing_notes', 'tax_invoices', 'receipts', 'ap_bills'].includes(moduleKey)) return OFFICER_ACCESS;
  if (dept === 'operations' && ['waves', 'assignments', 'mobilization', 'timesheets'].includes(moduleKey)) return OFFICER_ACCESS;
  
  return NO_ACCESS;
}

/**
 * Functional shorthand helpers
 */
export const canView = (user: User | null, moduleKey: ModuleKey, profile?: PermissionProfile | null) => 
  getPermissions(user, moduleKey, profile).view;

export const canCreate = (user: User | null, moduleKey: ModuleKey, profile?: PermissionProfile | null) => 
  getPermissions(user, moduleKey, profile).create;

export const canEdit = (user: User | null, moduleKey: ModuleKey, profile?: PermissionProfile | null) => 
  getPermissions(user, moduleKey, profile).edit;

export const canDelete = (user: User | null, moduleKey: ModuleKey, profile?: PermissionProfile | null) => 
  getPermissions(user, moduleKey, profile).delete;

export const canApprove = (user: User | null, moduleKey: ModuleKey, profile?: PermissionProfile | null) => 
  getPermissions(user, moduleKey, profile).approve;
