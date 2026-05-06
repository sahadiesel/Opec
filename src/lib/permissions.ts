/**
 * Simplified 3-tier RBAC: admin | accounting | internal (default).
 * Align with firestore.rules (status/user_type/role + legacy camelCase).
 */

import {
  User,
  PermissionProfile,
  ModulePermission,
  RoleType,
  BusinessRoleKey,
} from './types';
import { resolvePermissionModuleKey } from './permission-module-map';
import {
  isSystemAdmin,
  getEffectiveAccessGroup,
  getEffectiveAccessLevel,
  getPrimaryLegacyRole,
  isHrManager,
  canManageWaveRecords,
  isOperationManager,
  isStoreOfficer,
  canEditMasterContractCostBaseline,
  isOperationsOfficer,
  isPayrollOfficer,
  canRecordTaxInvoiceBillingCustomerApproval,
  canEditEmployeeCompensation,
  canActAsHrManager,
  getUserAccessContext,
  mapBusinessRoleToCore,
  mapLegacyBusinessRoleToCore,
  isDepartmentGroup,
  hasMinimumLevel,
  canAccessDomain,
  canManageSystem,
  isAccountingGroupMember,
  isOperationGroupMember,
  isOperationsPillarExecutive,
  isPrimaryHrOfficer,
  canAccessOpsSchedulingModules,
  canAccessAccountingFinanceModules,
  DOMAINS_BY_ACCESS_GROUP,
  ALL_ACCESS_DOMAINS,
  BUSINESS_ROLE_TO_CORE,
  LEGACY_BUSINESS_ROLE_TO_CORE,
  CORE_PRIMARY_ROLE_KEYS,
  type AccessGroup,
  type CoreAccessLevel,
  type AccessDomain,
  type CorePrimaryRoleKey,
  type UserAccessContext,
} from './permission-core';
import { normalizePermissionProfileDocumentId } from './role-key-normalizer';
import type { PayrollMatrixAction, PayrollMatrixResource } from './permission-payroll-matrix';
import {
  ACCOUNTING_ONLY_MODULE_KEYS,
  ADMIN_ONLY_MODULE_KEYS,
  isActiveForApp,
  isInternalTypeUser,
  isSimpleAccounting,
  isSimpleAdmin,
  isSimpleInternalEligible,
  getEffectiveSimpleRole,
} from './simple-tier-model';

export {
  isSystemAdmin,
  getEffectiveAccessGroup,
  getEffectiveAccessLevel,
  getPrimaryLegacyRole,
  isHrManager,
  canManageWaveRecords,
  isOperationManager,
  isStoreOfficer,
  canEditMasterContractCostBaseline,
  isOperationsOfficer,
  isPayrollOfficer,
  canRecordTaxInvoiceBillingCustomerApproval,
  canEditEmployeeCompensation,
  canActAsHrManager,
  getUserAccessContext,
  mapBusinessRoleToCore,
  mapLegacyBusinessRoleToCore,
  isDepartmentGroup,
  hasMinimumLevel,
  canAccessDomain,
  canManageSystem,
  isAccountingGroupMember,
  isOperationGroupMember,
  isOperationsPillarExecutive,
  isPrimaryHrOfficer,
  canAccessOpsSchedulingModules,
  canAccessAccountingFinanceModules,
  DOMAINS_BY_ACCESS_GROUP,
  ALL_ACCESS_DOMAINS,
  BUSINESS_ROLE_TO_CORE,
  LEGACY_BUSINESS_ROLE_TO_CORE,
  CORE_PRIMARY_ROLE_KEYS,
  type AccessGroup,
  type CoreAccessLevel,
  type AccessDomain,
  type CorePrimaryRoleKey,
  type UserAccessContext,
} from './permission-core';

export {
  legacyDeptToDepartmentGroup,
  getProfileDepartmentGroup,
  deriveLegacyDepartmentForGroup,
  ACCESS_LEVELS_BY_DEPARTMENT_GROUP,
  isAccessLevelAllowedForGroup,
  profileAllowedForTargetUser,
  validateProfileAssignment,
  getUserFieldsFromPermissionProfile,
  analyzeUserProfileBinding,
  deriveBusinessRoleKeyFromPermissionProfile,
  accessGroupFromAssignedRoleKey,
  type ProfileAuditIssue,
} from './permission-profile-helpers';

export const SECURITY_SENSITIVE_FIELDS = [
  'roleId',
  'roleIds',
  'assignedRoleKey',
  'assignedRoleKeys',
  'permissionProfileKey',
  'permissionProfileKeys',
  'department',
  'level',
  'accessGroup',
  'accessLevel',
  'allowedModules',
  'isActive',
  'approvalStatus',
  'customerId',
  'userType',
  'user_type',
  'status',
  'role',
  'dataAccess',
  'portalRole',
  'mustResetPassword',
] as const;

export const SYSTEM_MODULES = [
  { group: 'Overview', key: 'overview_dashboard', label: 'แดชบอร์ดหลัก (Main Dashboard)' },
  { group: 'Commercial (การค้า)', key: 'customers', label: 'ทะเบียนลูกค้า (Customers)' },
  { group: 'Commercial (การค้า)', key: 'main_contracts', label: 'สัญญาหลัก (Contracts)' },
  { group: 'Commercial (การค้า)', key: 'customer_pos', label: 'ใบสั่งซื้อลูกค้า (Customer POs)' },
  { group: 'Commercial (การค้า)', key: 'quotations', label: 'ใบเสนอราคา (Quotations)' },
  { group: 'Commercial (การค้า)', key: 'sales_contract_terms', label: 'เงื่อนไขการขาย (Sales Terms)' },
  { group: 'Commercial (การค้า)', key: 'rate_conditions', label: 'กฎการคำนวณราคา (Rate Conditions)' },
  { group: 'Commercial (การค้า)', key: 'profit_estimates', label: 'ประมาณการกำไร (Profit Estimates)' },
  { group: 'HR & Payroll (บุคคล)', key: 'hr_hub', label: 'ศูนย์กลาง HR (แดชบอร์ด / ตั้งค่า)' },
  { group: 'HR & Payroll (บุคคล)', key: 'timesheets', label: 'ลงเวลาทำงาน (Timesheets)' },
  { group: 'HR & Payroll (บุคคล)', key: 'worker_payroll', label: 'จ่ายเงินคนงาน (Worker Payroll)' },
  { group: 'HR & Payroll (บุคคล)', key: 'payroll_runs', label: 'รอบจ่ายคนงาน (Payroll runs)' },
  { group: 'HR & Payroll (บุคคล)', key: 'payslips', label: 'สลิปเงินเดือนคนงาน (Payslips)' },
  { group: 'HR & Payroll (บุคคล)', key: 'office_payroll', label: 'เงินเดือนออฟฟิศ (Office Payroll — ดู/แก้ตามโปรไฟล์)' },
  { group: 'HR & Payroll (บุคคล)', key: 'payment_export_batches', label: 'ไฟล์โอนเงินธนาคาร (Payment Exports)' },
  { group: 'HR & Payroll (บุคคล)', key: 'labor_cost_contract_terms', label: 'เงื่อนไขต้นทุน (Labor Cost Terms)' },
  { group: 'HR & Payroll (บุคคล)', key: 'positions', label: 'ตำแหน่งงาน (Positions)' },
  { group: 'HR & Payroll (บุคคล)', key: 'workers', label: 'ทะเบียนคนงาน (Workers)' },
  { group: 'HR & Payroll (บุคคล)', key: 'worker_documents', label: 'เอกสารบุคลากรกลาง (Worker document catalog)' },
  { group: 'HR & Payroll (บุคคล)', key: 'office_staff', label: 'พนักงานออฟฟิศ (Office Staff)' },
  {
    group: 'HR & Payroll (บุคคล)',
    key: 'cash_advances',
    label: 'เบิกเงินล่วงหน้า (Cash advance)',
  },
  {
    group: 'HR & Payroll (บุคคล)',
    key: 'employee_self_profile',
    label: 'โปรไฟล์ของฉัน (My Profile)',
  },
  { group: 'Operations (ปฏิบัติการ)', key: 'waves', label: 'กลุ่มรอบการทำงาน (Waves)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'assignments', label: 'การมอบหมายงาน (Assignments)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'mobilization', label: 'การเตรียมส่งตัว (Mobilization)' },
  {
    group: 'Operations (ปฏิบัติการ)',
    key: 'draft_invoices',
    label: 'รายการใบแจ้งหนี้ — เรียกเก็บลูกค้า (Commercial invoice / billing)',
  },
  {
    group: 'Operations (ปฏิบัติการ)',
    key: 'operations_petty_cash',
    label: 'เบิกจ่าย Petty Cash (หน้างาน)',
  },
  { group: 'Operations (ปฏิบัติการ)', key: 'vendors', label: 'คู่ค้า/ผู้ขาย (Vendors)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'purchases', label: 'ใบสั่งซื้อ(Purchase Order)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'store_inventory', label: 'คลังอุปกรณ์ (Store / Inventory)' },
  { group: 'บัญชี (Accounting)', key: 'accounting_dashboard', label: 'แดชบอร์ดบัญชี (Accounting overview)' },
  { group: 'บัญชี (Accounting)', key: 'billing_notes', label: 'ใบวางบิลลูกหนี้ (Billing Notes)' },
  {
    group: 'บัญชี (Accounting)',
    key: 'tax_invoices',
    label: 'ใบกำกับภาษี (Tax invoice)',
  },
  {
    group: 'บัญชี (Accounting)',
    key: 'receipts',
    label: 'ใบเสร็จรับเงิน (ลูกค้า) — หลังยืนยันรับเงิน (Money receipt)',
  },
  { group: 'บัญชี (Accounting)', key: 'ap_bills', label: 'รับวางบิลเจ้าหนี้ (AP Bills)' },
  { group: 'บัญชี (Accounting)', key: 'accounts_receivable', label: 'ลูกหนี้การค้า (AR)' },
  { group: 'บัญชี (Accounting)', key: 'accounts_payable', label: 'เจ้าหนี้การค้า (AP)' },
  {
    group: 'บัญชี (Accounting)',
    key: 'withholding_tax_items',
    label: 'รายการหัก ณ ที่จ่าย (รอนำส่งสรรพากร)',
  },
  { group: 'บัญชี (Accounting)', key: 'cashbook', label: 'รายรับรายจ่าย (Cashbook)' },
  { group: 'บัญชี (Accounting)', key: 'bank_accounts', label: 'บัญชีธนาคาร (Bank Accounts)' },
  { group: 'บัญชี (Accounting)', key: 'executive_payroll', label: 'เงินเดือนผู้บริหาร (Executive Payroll)' },
  { group: 'Administration (ระบบ)', key: 'system_admin', label: 'จัดการผู้ใช้/ระบบ (System Admin)' },
  { group: 'Administration (ระบบ)', key: 'client_portal', label: 'Client Portal (หน้าของลูกค้า)' },
  { group: 'Administration (ระบบ)', key: 'document_numbering', label: 'รันเลขที่เอกสาร (Numbering)' },
  { group: 'Administration (ระบบ)', key: 'audit_logs', label: 'ประวัติกิจกรรม (Audit Logs)' },
] as const;

export type ModuleKey = (typeof SYSTEM_MODULES)[number]['key'];

export const FULL_ACCESS: ModulePermission = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  approve: true,
};

export const OFFICER_ACCESS: ModulePermission = {
  view: true,
  create: true,
  edit: true,
  delete: false,
  approve: false,
};

export const READ_ONLY: ModulePermission = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  approve: false,
};

export const NO_ACCESS: ModulePermission = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  approve: false,
};

/** Legacy matrix removed; kept export shape for older imports. */
export const PERMISSION_MATRIX: Record<string, unknown> = {};

type BasePermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve';

const MODULE_KEY_SET = new Set<ModuleKey>(SYSTEM_MODULES.map((m) => m.key));
const MODULE_KEYS_WITHOUT_DOMAIN_ALIAS: ReadonlySet<string> = new Set(['payroll_runs', 'payslips']);

/**
 * HR Officer: ทะเบียนลูกจ้าง (workers) สร้าง/แก้ไขได้ — ไม่มี commercial, ไม่มี payroll/timesheets,
 * ไม่มีทะเบียนพนักงานออฟฟิศ / office payroll
 */
const HR_OFFICER_BLOCKED_MODULE_KEYS = new Set<ModuleKey>([
  'customers',
  'quotations',
  'main_contracts',
  'customer_pos',
  'sales_contract_terms',
  'rate_conditions',
  'profit_estimates',
  'office_staff',
  'office_payroll',
  'timesheets',
  'worker_payroll',
  'payroll_runs',
  'payslips',
  'payment_export_batches',
  'cash_advances',
]);

function clonePermission(p: ModulePermission): ModulePermission {
  return { ...p };
}

export function normalizeCurrentUserPermissions(user: Partial<User> | null | undefined): User | null {
  if (!user) return null;

  const roleIds = Array.isArray(user.roleIds) ? [...user.roleIds] : [];
  if (user.roleId && !roleIds.includes(user.roleId)) {
    roleIds.unshift(user.roleId as RoleType);
  }

  const assignedRoleKeys = Array.isArray(user.assignedRoleKeys) ? [...user.assignedRoleKeys] : [];
  if (user.assignedRoleKey && !assignedRoleKeys.includes(user.assignedRoleKey)) {
    assignedRoleKeys.unshift(user.assignedRoleKey as BusinessRoleKey);
  }

  const permissionProfileKeys = Array.isArray(user.permissionProfileKeys)
    ? [...user.permissionProfileKeys]
    : [];
  if (user.permissionProfileKey && !permissionProfileKeys.includes(user.permissionProfileKey)) {
    permissionProfileKeys.unshift(user.permissionProfileKey);
  }

  const normalizedProfileKeys = permissionProfileKeys.map(
    (k) => normalizePermissionProfileDocumentId(k) ?? k
  );

  const approvalStatus = user.approvalStatus ?? (user.isActive ? 'ACTIVE' : 'PENDING');
  const isActive = user.isActive ?? (approvalStatus === 'ACTIVE');

  let userType = user.userType;
  if (!userType) {
    const isPortalLike =
      user.portalRole != null ||
      user.accessGroup === 'client' ||
      user.department === 'client' ||
      roleIds.includes('client_user') ||
      assignedRoleKeys.includes('client_user');

    userType = isPortalLike ? 'customer_portal' : 'internal';
  }

  return {
    ...(user as User),
    roleIds,
    assignedRoleKeys,
    permissionProfileKeys: normalizedProfileKeys,
    permissionProfileKey: user.permissionProfileKey
      ? normalizePermissionProfileDocumentId(user.permissionProfileKey) ?? user.permissionProfileKey
      : user.permissionProfileKey,
    approvalStatus,
    isActive,
    userType,
  } as User;
}

export function isClient(user: User | null): boolean {
  return getEffectiveAccessGroup(user) === 'client';
}

export function isInternalUser(user: User | null): boolean {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  return isSimpleInternalEligible(u);
}

export function getPermissions(
  user: User | null,
  rawModuleKey: string,
  _profile?: PermissionProfile | null
): ModulePermission {
  const u = normalizeCurrentUserPermissions(user);
  if (!u || !isActiveForApp(u)) return clonePermission(NO_ACCESS);

  if (getEffectiveAccessGroup(u) === 'client') {
    const moduleKey = resolvePermissionModuleKey(rawModuleKey) as ModuleKey;
    if (moduleKey === 'client_portal' || moduleKey === 'timesheets') {
      return u.portalRole === 'approver'
        ? { ...READ_ONLY, edit: true, approve: true }
        : clonePermission(READ_ONLY);
    }
    if (
      moduleKey === 'workers' ||
      moduleKey === 'quotations' ||
      moduleKey === 'customer_pos' ||
      moduleKey === 'main_contracts'
    ) {
      return clonePermission(READ_ONLY);
    }
    return clonePermission(NO_ACCESS);
  }

  if (!isInternalTypeUser(u)) return clonePermission(NO_ACCESS);

  if (isSimpleAdmin(u)) return clonePermission(FULL_ACCESS);

  const moduleKey = (
    MODULE_KEYS_WITHOUT_DOMAIN_ALIAS.has(rawModuleKey)
      ? rawModuleKey
      : resolvePermissionModuleKey(rawModuleKey)
  ) as ModuleKey;
  if (!MODULE_KEY_SET.has(moduleKey)) return clonePermission(NO_ACCESS);

  if (ADMIN_ONLY_MODULE_KEYS.has(moduleKey)) return clonePermission(NO_ACCESS);

  /** พนักงาน/ลูกจ้างที่เปิดบัญชีจากทะเบียน (employee_self) — เฉพาะโปรไฟล์ตนเอง + เบิกล่วงหน้า */
  if (getEffectiveSimpleRole(u) === 'employee_self') {
    if (moduleKey === 'employee_self_profile') {
      return clonePermission({ ...READ_ONLY, create: true, edit: true });
    }
    if (moduleKey === 'cash_advances') {
      return clonePermission({
        view: true,
        create: true,
        edit: false,
        delete: false,
        approve: false,
      });
    }
    return clonePermission(NO_ACCESS);
  }

  /** ใบกำกับร่าง + แนบสลิป: พนักงานภายใน (ไม่ใช่บัญชี) ดู/แก้ไขได้ แต่ไม่สร้างเอกสารใหม่ใน UI */
  if (
    moduleKey === 'tax_invoices' &&
    isSimpleInternalEligible(u) &&
    !isSimpleAccounting(u)
  ) {
    return { view: true, create: false, edit: true, delete: false, approve: false };
  }

  if (ACCOUNTING_ONLY_MODULE_KEYS.has(moduleKey)) {
    return isSimpleAccounting(u) ? clonePermission(FULL_ACCESS) : clonePermission(NO_ACCESS);
  }

  /**
   * รายการใบแจ้งหนี้ (draft commercial / เรียกเก็บ) — เฉพาะ system admin (ด้านบน) + รายต่อนี้
   * ไม่รวม accounting officer / หัวหน้าสายอื่น
   *
   * รองรับผู้จัดการปฏิบัติการที่ accessGroup/level ชัด แต่ primary legacy role ยังไม่ sync เป็น operations_manager
   * (สอดคล้องเงื่อนไขเดียวกับโมดูล operations_petty_cash — ไม่เปิดให้ sales_manager / store_officer)
   */
  if (moduleKey === 'draft_invoices') {
    if (isOperationManager(u) || isHrManager(u)) return clonePermission(FULL_ACCESS);
    if (
      isOperationsPillarExecutive(u) &&
      isOperationGroupMember(u) &&
      getEffectiveAccessLevel(u) === 'manager' &&
      getEffectiveAccessGroup(u) === 'operations' &&
      !isHrManager(u) &&
      getPrimaryLegacyRole(u) !== 'sales_manager' &&
      getPrimaryLegacyRole(u) !== 'store_officer'
    ) {
      return clonePermission(FULL_ACCESS);
    }
    if (getEffectiveSimpleRole(u) === 'accounting_manager') return clonePermission(FULL_ACCESS);
    return clonePermission(NO_ACCESS);
  }

  /** พอร์ทัลโปรไฟล์ — ทุกพนักงานภายในที่ล็อกอินได้เข้าเมนูได้ (หน้าตรวจสอบการเชื่อมทะเบียน) */
  if (moduleKey === 'employee_self_profile') {
    if (!isSimpleInternalEligible(u)) return clonePermission(NO_ACCESS);
    return clonePermission({ ...READ_ONLY, create: true, edit: true });
  }

  /**
   * เบิกเงินล่วงหน้า — Payroll / HR manager / Ops manager สร้างและไล่ขั้น;
   * บัญชีจ่ายหรือตัด Petty ตอนท้าย
   */
  if (moduleKey === 'cash_advances') {
    if (isSystemAdmin(u) || isSimpleAdmin(u)) return clonePermission(FULL_ACCESS);
    if (isSimpleAccounting(u)) return clonePermission(FULL_ACCESS);
    if (isPayrollOfficer(u) || isHrManager(u) || isOperationManager(u)) return clonePermission(FULL_ACCESS);
    return clonePermission(NO_ACCESS);
  }

  /** Petty Cash หน้างาน — ฝ่ายบัญชี + ผจก.ปฏิบัติการ (รวมกรณี level=manager + operations แต่ legacy role ยังไม่ sync) */
  if (moduleKey === 'operations_petty_cash') {
    if (isSimpleAccounting(u)) return clonePermission(FULL_ACCESS);
    if (isOperationManager(u)) return clonePermission(FULL_ACCESS);
    if (
      isOperationsPillarExecutive(u) &&
      isOperationGroupMember(u) &&
      getEffectiveAccessLevel(u) === 'manager' &&
      getEffectiveAccessGroup(u) === 'operations' &&
      !isHrManager(u) &&
      getPrimaryLegacyRole(u) !== 'sales_manager' &&
      getPrimaryLegacyRole(u) !== 'store_officer'
    ) {
      return clonePermission(FULL_ACCESS);
    }
    return clonePermission(NO_ACCESS);
  }

  /** HR Officer: จัดการทะเบียนเอกสารกลางได้ แต่ไม่ลบ (manager/admin ผ่าน FULL_ACCESS ด้านล่าง) */
  if (isPrimaryHrOfficer(u) && moduleKey === 'worker_documents') {
    return clonePermission(OFFICER_ACCESS);
  }

  /** HR Officer: ทะเบียนลูกจ้าง — สร้าง/แก้ไข ไม่ลบรายการหลัก (ลบตามนโยบาย manager/admin) */
  if (isPrimaryHrOfficer(u) && moduleKey === 'workers') {
    return clonePermission(OFFICER_ACCESS);
  }

  if (isPrimaryHrOfficer(u) && HR_OFFICER_BLOCKED_MODULE_KEYS.has(moduleKey)) {
    return clonePermission(NO_ACCESS);
  }

  return clonePermission(FULL_ACCESS);
}

export function canAccess(
  user: Partial<User> | null | undefined,
  module: string,
  action: BasePermissionAction = 'view'
): boolean {
  const p = getPermissions(user as User, module, null);
  return Boolean(p[action]);
}

export function isMatrixControlledRole(_user: Partial<User> | null | undefined): boolean {
  return false;
}

export function canPreparePayroll(user: User | null): boolean {
  return isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
}

export function canGeneratePayslips(user: User | null, _payrollStatus?: string | null): boolean {
  return isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
}

export function canApprovePayroll(user: User | null): boolean {
  return isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
}

export function canExportPayroll(user: User | null, _payrollStatus?: string | null): boolean {
  return isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
}

/** ส่งงวดลูกจ้างต่อบัญชี (FINANCE_PREPARED) — payroll officer / ผู้จัดการ HR-Ops เป็นหลัก */
export function canHandoffWorkerPayrollToAccounting(user: User | null): boolean {
  const u = normalizeCurrentUserPermissions(user);
  if (!u || !isSimpleInternalEligible(u)) return false;
  if (isSimpleAdmin(u)) return true;
  if (isPayrollOfficer(u)) return true;
  if (isHrManager(u) || isOperationManager(u)) return true;
  return false;
}

/** บัญชียืนยันจ่ายงวดลูกจ้าง + บันทึก cashbook */
export function canConfirmWorkerPayrollPaid(user: User | null): boolean {
  const u = normalizeCurrentUserPermissions(user);
  if (!u || !isActiveForApp(u)) return false;
  if (isSimpleAdmin(u)) return true;
  return isSimpleAccounting(u);
}

export const INITIAL_PERMISSIONS_TEMPLATE: Record<string, ModulePermission> = SYSTEM_MODULES.reduce(
  (acc, mod) => {
    acc[mod.key] = clonePermission(NO_ACCESS);
    return acc;
  },
  {} as Record<string, ModulePermission>
);

function buildPermissionMap(keys: readonly ModuleKey[], perm: ModulePermission): Record<string, ModulePermission> {
  const out: Record<string, ModulePermission> = {};
  for (const k of keys) {
    out[k] = clonePermission(perm);
  }
  return out;
}

const ALL_MODULE_KEYS = SYSTEM_MODULES.map((m) => m.key as ModuleKey);
const ACCOUNTING_KEYS_LIST: ModuleKey[] = [
  'accounting_dashboard',
  'billing_notes',
  'tax_invoices',
  'receipts',
  'ap_bills',
  'accounts_receivable',
  'accounts_payable',
  'withholding_tax_items',
  'cashbook',
  'bank_accounts',
  'executive_payroll',
];

const HR_PILLAR_UI_KEYS: ModuleKey[] = [
  'hr_hub',
  'workers',
  'worker_documents',
  'worker_payroll',
  'office_payroll',
  'office_staff',
  'timesheets',
  'positions',
  'labor_cost_contract_terms',
  'payment_export_batches',
];

const SALES_PILLAR_UI_KEYS: ModuleKey[] = [
  'customers',
  'quotations',
  'main_contracts',
  'customer_pos',
  'rate_conditions',
  'profit_estimates',
];

const OPS_PILLAR_UI_KEYS: ModuleKey[] = ['waves', 'assignments', 'mobilization', 'draft_invoices'];
const STORE_PILLAR_UI_KEYS: ModuleKey[] = ['vendors', 'purchases', 'store_inventory'];
const ACCOUNTING_PILLAR_UI_KEYS: ModuleKey[] = [
  'accounting_dashboard',
  'billing_notes',
  'tax_invoices',
  'receipts',
  'ap_bills',
  'accounts_receivable',
  'accounts_payable',
  'withholding_tax_items',
  'cashbook',
  'bank_accounts',
  'office_payroll',
  'executive_payroll',
];

export const canView = (user: User | null, moduleKey: string, profile?: PermissionProfile | null) =>
  getPermissions(user, moduleKey, profile).view;

export const canCreate = (user: User | null, moduleKey: string, profile?: PermissionProfile | null) =>
  getPermissions(user, moduleKey, profile).create;

export const canEdit = (user: User | null, moduleKey: string, profile?: PermissionProfile | null) =>
  getPermissions(user, moduleKey, profile).edit;

export const canDelete = (user: User | null, moduleKey: string, profile?: PermissionProfile | null) =>
  getPermissions(user, moduleKey, profile).delete;

export const canApprove = (user: User | null, moduleKey: string, profile?: PermissionProfile | null) =>
  getPermissions(user, moduleKey, profile).approve;

export function canSeeHrPillarUi(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  return HR_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeSalesPillarUi(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  return SALES_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeOperationsPillarUi(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  return OPS_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeStorePillarUi(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  return STORE_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeAccountingPillarUi(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  return ACCOUNTING_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export const isHRStaff = (user: User | null) => isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
export const isOperationsStaff = (user: User | null) => isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
export const isSalesStaff = (user: User | null) => isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
export const isAccountingStaff = (user: User | null) =>
  isSimpleAdmin(user) || isSimpleAccounting(user);
export const isStoreStaff = (user: User | null) => isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
export const isInternalStaff = (user: User | null) => isSimpleInternalEligible(normalizeCurrentUserPermissions(user));

/** อนุมัติใบสั่งซื้อภายใน (คลังส่งขอ) — ผู้จัดการปฏิบัติการ / หัวหน้าแนวเดียวกับ admin ธุรกิจ */
export function canApprovePurchaseAsManager(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  return isOperationManager(user) || isOperationsPillarExecutive(user);
}

/** บันทึกว่าจ่ายเงินตามใบรับวางบิลจากคลัง */
export function canMarkPurchaseVendorBillPaid(user: User | null): boolean {
  if (!user) return false;
  return isSystemAdmin(user) || isSimpleAccounting(user);
}

/** หนังสือรับรองหัก ณ ที่จ่าย (ม.50 ทวิ) — อ่านได้ถ้าเข้าถึง AP หรือเมนูหัก ณ ที่จ่าย */
export function canReadWhtCertificates(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  return canView(user, 'accounts_payable', profile) || canView(user, 'withholding_tax_items', profile);
}

/** สร้าง / ตรวจสอบ / พิมพ์ร่าง — เทียบเท่าเจ้าหน้าที่บัญชี */
export function canCreateVerifyPrintWhtCertificate(user: User | null): boolean {
  return canMarkPurchaseVendorBillPaid(user);
}

/**
 * พรีวิว / พิมพ์ตัวอย่างหัก ณ ที่จ่ายจากหน้าใบวางบิลคลัง — บัญชีหรือเจ้าหน้าที่คลัง (ส่งเอกสารให้คู่ค้า)
 * การพิมพ์ทางการหลัง ISSUED และการสร้างหนังสือในระบบยังใช้ canCreateVerifyPrintWhtCertificate
 */
export function canPreviewVendorBillWhtCertificate(user: User | null): boolean {
  if (!user) return false;
  if (canCreateVerifyPrintWhtCertificate(user)) return true;
  return isStoreOfficer(user) && canView(user, 'store_inventory');
}

/** ตรวจสอบความถูกต้อง (DRAFT → VERIFIED) — เจ้าหน้าที่/ผู้จัดการบัญชี */
export function canVerifyWhtCertificate(user: User | null): boolean {
  return canCreateVerifyPrintWhtCertificate(user);
}

/** ออกเลขที่ (ISSUED) / ยกเลิก — ผู้จัดการบัญชีหรือแอดมินเท่านั้น */
export function canIssueWhtCertificate(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  return getEffectiveSimpleRole(user) === 'accounting_manager';
}

export function canCancelWhtCertificate(user: User | null): boolean {
  return canIssueWhtCertificate(user);
}

/** Generate internal XML payload — เจ้าหน้าที่บัญชีที่มีสิทธิ์ลงรายการจ่าย + ผู้จัดการ */
export function canGenerateWhtXmlPayload(user: User | null): boolean {
  return canMarkPurchaseVendorBillPaid(user);
}

export function getBaselineProfiles(): Partial<PermissionProfile>[] {
  const adminPerms = SYSTEM_MODULES.reduce(
    (acc, mod) => {
      acc[mod.key] = clonePermission(FULL_ACCESS);
      return acc;
    },
    {} as Record<string, ModulePermission>
  );

  const internalPerms = {
    ...INITIAL_PERMISSIONS_TEMPLATE,
    ...buildPermissionMap(
      ALL_MODULE_KEYS.filter((k) => !ADMIN_ONLY_MODULE_KEYS.has(k) && !ACCOUNTING_ONLY_MODULE_KEYS.has(k)),
      FULL_ACCESS
    ),
  };

  const accountingPerms = {
    ...internalPerms,
    ...buildPermissionMap(ACCOUNTING_KEYS_LIST, FULL_ACCESS),
  };

  return [
    {
      profileKey: 'system_admin',
      profileNameEn: 'System Administrator',
      profileNameTh: 'ผู้ดูแลระบบสูงสุด',
      departmentGroup: 'admin',
      primaryRoleTemplateKey: 'system_admin',
      department: 'admin',
      level: 'admin',
      isActive: true,
      permissions: adminPerms,
    },
    {
      profileKey: 'accounting_manager',
      profileNameEn: 'Accounting Manager',
      profileNameTh: 'ผู้จัดการบัญชี',
      departmentGroup: 'accounting',
      primaryRoleTemplateKey: 'accounting_manager',
      department: 'accounting',
      level: 'manager',
      isActive: true,
      permissions: accountingPerms,
    },
    {
      profileKey: 'accounting_officer',
      profileNameEn: 'Accounting Officer',
      profileNameTh: 'เจ้าหน้าที่บัญชี',
      departmentGroup: 'accounting',
      primaryRoleTemplateKey: 'accounting_officer',
      department: 'accounting',
      level: 'officer',
      isActive: true,
      permissions: accountingPerms,
    },
    {
      profileKey: 'operations_officer',
      profileNameEn: 'Internal staff (default)',
      profileNameTh: 'พนักงานภายใน (ค่าเริ่มต้น)',
      departmentGroup: 'operations',
      primaryRoleTemplateKey: 'operations_officer',
      department: 'operations',
      level: 'officer',
      isActive: true,
      permissions: internalPerms,
    },
    {
      profileKey: 'client_user',
      profileNameEn: 'Client Portal User',
      profileNameTh: 'ลูกค้า',
      departmentGroup: 'client',
      primaryRoleTemplateKey: 'client_user',
      department: 'client',
      level: 'viewer',
      isActive: true,
      permissions: buildPermissionMap(
        ['client_portal', 'timesheets', 'workers', 'quotations', 'customer_pos', 'main_contracts'],
        READ_ONLY
      ),
    },
  ];
}

export type { PayrollMatrixResource, PayrollMatrixAction };

export function canPayrollPermission(
  user: User | null,
  _resource: PayrollMatrixResource,
  _action: PayrollMatrixAction
): boolean {
  return isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
}

export function assertPayrollPermission(
  user: User | null,
  resource: PayrollMatrixResource,
  action: PayrollMatrixAction,
  message?: string
): void {
  if (!canPayrollPermission(user, resource, action)) {
    throw new Error(message || `Permission denied: ${resource}.${action}`);
  }
}
