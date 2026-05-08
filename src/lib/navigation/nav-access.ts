/**
 * มาตรฐานการตรวจสิทธิ์ตาม path — ให้สอดคล้องกับเมนู sidebar
 * (รายละเอียดรายเมนูปรับเพิ่มได้ภายหลังที่นี่และใน permissions)
 */

import type { User, PermissionProfile } from '@/lib/types';
import {
  type ModuleKey,
  canView,
  canApprovePurchaseAsManager,
  canSeeHrPillarUi,
  canSeeSalesPillarUi,
  canSeeOperationsPillarUi,
  canSeeStorePillarUi,
  canSeeAccountingPillarUi,
  isClient,
  isPrimaryHrOfficer,
} from '@/lib/permissions';
import {
  isSystemAdmin,
  isHrManager,
  isOperationManager,
  isPayrollOfficer,
  getPrimaryLegacyRole,
} from '@/lib/permission-core';
import { isSimpleAccounting, isSimpleAdmin, isSimpleInternalEligible } from '@/lib/simple-tier-model';
import { deriveBusinessRoleKey } from '@/lib/auth-mapping';
import { getFlattenedHrNavItems, type HrNavItem } from '@/lib/navigation/hr-nav-items';

export function pathMatches(pathname: string, href: string): boolean {
  const base = href.split('#')[0].split('?')[0];
  if (pathname === base) return true;
  if (base !== '/' && pathname.startsWith(`${base}/`)) return true;
  return false;
}

/**
 * Simplified RBAC: do not use per-path matrix override here (was duplicating legacy matrix and could deny
 * operations_manager / others while sidebar still showed links). Always fall through to canView / canViewHrHubItem.
 */
export function sidebarMatrixVisibilityForPath(_user: User, _pathname: string): boolean | null {
  return null;
}

/**
 * หมวด «การจ่ายค่าจ้าง (Payroll)» — จำกัดเมนูย่อยให้ผู้กำกับงานจ่ายค่าจ้างโดยตรง + แอดมิน
 * (ไม่รวม hr_officer / operations_officer ทั่วไป — ใช้เมนู Operations / ทะเบียน ตามสิทธิ์แทน)
 */
export function canViewHrPayrollFlowSubsection(
  user: User,
  _profile: PermissionProfile | null,
  admin: boolean,
): boolean {
  if (admin) return true;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return true;
  if (isHrManager(user) || isOperationManager(user) || isPayrollOfficer(user)) return true;
  /** สอดคล้องเมนู «อนุมัติ» — กรณี assignedRoleKey/โปรไฟล์ยังไม่ sync กับ getPrimaryLegacyRole */
  const d = deriveBusinessRoleKey(user);
  return d === 'hr_manager' || d === 'operations_manager' || d === 'payroll_officer';
}

/** หมวดลงเวลา (รายวัน / รายเดือน) — หัวหน้างานจ่ายค่าจ้าง หรือ operations_officer ที่มีสิทธิ์ timesheets */
export function canViewHrFieldTimesheetSubsection(
  user: User,
  profile: PermissionProfile | null,
  admin: boolean,
): boolean {
  if (admin) return true;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return true;
  if (canViewHrPayrollFlowSubsection(user, profile, admin)) return true;
  if (getPrimaryLegacyRole(user) === 'operations_officer' && canView(user, 'timesheets', profile)) {
    return true;
  }
  return false;
}

/** หมวด «อนุมัติ (Approval)» ใน HR sidebar — เฉพาะผู้จัดการปฏิบัติการ / HR (+ แอดมิน) */
export function canViewHrApprovalSubsection(user: User, admin: boolean): boolean {
  if (admin) return true;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return true;
  if (isHrManager(user) || isOperationManager(user)) return true;
  /** สอดคล้อง UI (derive) กรณี assigned role / โปรไฟล์ไม่ตรง getPrimaryLegacyRole โดยตรง */
  const d = deriveBusinessRoleKey(user);
  return d === 'hr_manager' || d === 'operations_manager';
}

/** Paths under HR “อนุมัติ” — ศูนย์อนุมัติ, คิว timesheet รอบเดือน, D6 payroll (manager ไม่รวม payroll_officer) */
const HR_MANAGER_ONLY_PATH_PREFIXES = [
  '/hr/approval-center',
  '/hr/timesheet-month-approval',
  '/hr/payroll-approval',
] as const;

export function isHrManagerOnlyApprovalPath(p: string): boolean {
  const path = (p.split('?')[0] || '/').trim() || '/';
  return HR_MANAGER_ONLY_PATH_PREFIXES.some(
    (pre) => path === pre || path.startsWith(`${pre}/`)
  );
}

/** เมนูเตรียมจ่าย / อนุมัติ payroll — ไม่แสดงให้ hr_officer */
function hrOfficerExcludedFromHrNavItem(user: User, item: HrNavItem): boolean {
  if (!isPrimaryHrOfficer(user)) return false;
  const full = item.href;
  const base = full.split('#')[0];
  if (full.includes('#hr-action-queue')) return true;
  if (base.startsWith('/hr/payroll-workbench')) return true;
  if (base.startsWith('/hr/payroll-approval')) return true;
  if (base.startsWith('/hr/approval-center')) return true;
  if (base.startsWith('/hr/timesheet-month-approval')) return true;
  if (base.startsWith('/timesheets')) return true;
  if (base.startsWith('/payroll/')) return true;
  if (base === '/office-payroll' || base.startsWith('/office-payroll/')) return true;
  return false;
}

/** เมนูทะเบียน HR ที่ ops officer ไม่ต้องเห็น (ธนาคาร / สปส. / ตั้งค่า) */
function operationsOfficerExcludedHrMasterHref(baseHref: string): boolean {
  return (
    baseHref === '/hr/bank-registry' ||
    baseHref.startsWith('/hr/bank-registry/') ||
    baseHref === '/hr/hospital-registry' ||
    baseHref.startsWith('/hr/hospital-registry/') ||
    baseHref === '/hr/settings' ||
    baseHref.startsWith('/hr/settings/')
  );
}

export function canViewHrHubItem(
  user: User,
  profile: PermissionProfile | null,
  admin: boolean,
  item: HrNavItem
): boolean {
  if (admin) return true;
  if (hrOfficerExcludedFromHrNavItem(user, item)) return false;
  const baseHref = item.href.split('#')[0].split('?')[0];
  if (getPrimaryLegacyRole(user) === 'operations_officer' && operationsOfficerExcludedHrMasterHref(baseHref)) {
    return false;
  }
  if (baseHref === '/purchases' && canApprovePurchaseAsManager(user)) return true;
  if (baseHref === '/store/purchase-requests' && canApprovePurchaseAsManager(user)) return true;
  /** คิวอนุมัติ (D6/เดือน/Overview) — ไม่อาศัย canSeeHrPillarUi; ops/HR manager อาจไม่มี module HR ใน matrix */
  if (
    (baseHref === '/hr/approval-center' ||
      baseHref === '/hr/payroll-approval' ||
      baseHref === '/hr/timesheet-month-approval' ||
      baseHref.startsWith('/hr/approval-center/') ||
      baseHref.startsWith('/hr/payroll-approval/') ||
      baseHref.startsWith('/hr/timesheet-month-approval/')) &&
    canViewHrApprovalSubsection(user, admin)
  ) {
    return true;
  }
  const byMatrix = sidebarMatrixVisibilityForPath(user, item.href.split('#')[0]);
  if (byMatrix !== null) return byMatrix;
  if (canView(user, item.key, profile)) return true;
  if (item.href.startsWith('/hr/')) {
    return canSeeHrPillarUi(user, profile);
  }
  return false;
}

const MODULE_PREFIXES: Array<[string, ModuleKey]> = [
  ['/draft-invoices', 'draft_invoices'],
  ['/accounting/executive-payroll', 'executive_payroll'],
  ['/accounting/office-payroll', 'office_payroll'],
  ['/accounting/worker-payroll', 'worker_payroll'],
  ['/accounting/cash-advances-payout', 'cash_advances'],
  ['/office-payroll', 'office_payroll'],
  ['/payroll', 'worker_payroll'],
  ['/timesheets', 'timesheets'],
  ['/purchase-orders', 'customer_pos'],
  ['/main-contracts', 'main_contracts'],
  ['/sales-terms', 'sales_contract_terms'],
  ['/labor-cost-terms', 'labor_cost_contract_terms'],
  ['/worker-document-catalog', 'worker_documents'],
  ['/accounts-receivable', 'accounts_receivable'],
  ['/accounts-payable', 'accounts_payable'],
  ['/accounting/outgoing-review', 'accounts_payable'],
  ['/accounting/withholding-tax', 'withholding_tax_items'],
  ['/accounting/withholding-payroll', 'worker_payroll'],
  ['/accounting/withholding-vendor', 'withholding_tax_items'],
  ['/billing-notes', 'billing_notes'],
  ['/tax-invoices', 'tax_invoices'],
  ['/receipts', 'receipts'],
  ['/accounting/dashboard', 'accounting_dashboard'],
  ['/bank-accounts', 'bank_accounts'],
  ['/billing-client', 'customers'],
  ['/customers', 'customers'],
  ['/quotations', 'quotations'],
  ['/assignments', 'assignments'],
  ['/mobilization', 'mobilization'],
  ['/store/vendor-bills', 'store_inventory'],
  ['/purchases', 'purchases'],
  ['/ap-bills/vendor-bills', 'ap_bills'],
  ['/ap-bills', 'ap_bills'],
  ['/cashbook', 'cashbook'],
  ['/office-staff', 'office_staff'],
  ['/positions', 'positions'],
  ['/workers', 'workers'],
  ['/vendors', 'vendors'],
  ['/operations/petty-cash', 'operations_petty_cash'],
  ['/my-profile', 'employee_self_profile'],
  ['/hr/cash-advances', 'cash_advances'],
  ['/po-active-quota-queue', 'waves'],
  ['/store', 'store_inventory'],
];

const SORTED_PREFIXES = [...MODULE_PREFIXES].sort((a, b) => b[0].length - a[0].length);

/**
 * ผู้ใช้ที่ล็อกอินแล้ว (internal) เข้า path นี้ได้หรือไม่ — ใช้ใน AppShell
 * - isSystemAdmin (rules ยัง normalize เป็น system_admin): ผ่านทุก path ภายใน
 * - ลูกค้า portal: เฉพาะ /client-portal/*
 * - internal: ไม่ให้เข้า /client-portal
 */
export function userMayAccessPath(user: User, profile: PermissionProfile | null, pathname: string): boolean {
  const p = (pathname.split('?')[0] || '/').trim() || '/';
  const admin = isSystemAdmin(user) || isSimpleAdmin(user);
  const accounting = admin || isSimpleAccounting(user);

  if (admin) return true;

  if (isClient(user)) {
    return p.startsWith('/client-portal');
  }

  if (p.startsWith('/client-portal')) {
    return false;
  }

  if (!admin && getPrimaryLegacyRole(user) === 'operations_officer') {
    const denied = [
      '/vendors',
      '/purchases',
      '/store/vendor-bills',
      '/hr/bank-registry',
      '/hr/hospital-registry',
      '/hr/settings',
    ] as const;
    if (denied.some((pre) => p === pre || p.startsWith(`${pre}/`))) {
      return false;
    }
  }

  if (p.startsWith('/users') || p.startsWith('/system-admin')) {
    return false;
  }

  const accountingPrefixes = [
    '/billing-notes',
    '/tax-invoices',
    '/receipts',
    '/ap-bills',
    '/accounts-receivable',
    '/accounts-payable',
    '/cashbook',
    '/bank-accounts',
    '/accounting/executive-payroll',
    '/accounting/withholding-tax',
    '/accounting/withholding-payroll',
    '/accounting/withholding-vendor',
    '/accounting/dashboard',
  ];
  if (accountingPrefixes.some((pre) => p === pre || p.startsWith(`${pre}/`))) {
    return accounting;
  }

  if (p === '/' || p === '') {
    if (isSimpleInternalEligible(user)) return true;
    return canView(user, 'overview_dashboard', profile);
  }

  if (pathMatches(p, '/sales/dashboard')) {
    return canSeeSalesPillarUi(user, profile);
  }
  if (pathMatches(p, '/operations/dashboard')) {
    return canSeeOperationsPillarUi(user, profile) || canSeeStorePillarUi(user, profile);
  }
  if (pathMatches(p, '/accounting/dashboard')) {
    return canSeeAccountingPillarUi(user, profile);
  }

  if (isHrManagerOnlyApprovalPath(p)) {
    return canViewHrApprovalSubsection(user, admin);
  }

  const hrSorted = getFlattenedHrNavItems().sort((a, b) => b.href.length - a.href.length);
  for (const item of hrSorted) {
    const baseHref = item.href.split('#')[0];
    if (pathMatches(p, baseHref)) {
      return canViewHrHubItem(user, profile, false, item);
    }
  }

  /** รายละเอียดเบิกล่วงหน้า — พนักงานที่มีเมนู My Profile เปิดได้ (Firestore จำกัดเฉพาะแถวของตน) */
  if (p.startsWith('/hr/cash-advances/') && p !== '/hr/cash-advances/new' && canView(user, 'employee_self_profile', profile)) {
    return true;
  }

  /** บัญชี: ดูรายการจ่ายลูกจ้าง (หลัง manager อนุมัติ batch) — ไม่ต้องมี module worker_payroll ทั้งชุด */
  if (
    !admin &&
    isSimpleAccounting(user) &&
    (p === '/payroll/batches' ||
      p.startsWith('/payroll/batches/') ||
      p === '/accounting/worker-payroll' ||
      p.startsWith('/accounting/worker-payroll/'))
  ) {
    return true;
  }

  /** บัญชี: คิวจ่ายเบิกล่วงหน้าหลังผู้จัดการอนุมัติ */
  if (
    !admin &&
    isSimpleAccounting(user) &&
    (p === '/accounting/cash-advances-payout' || p.startsWith('/accounting/cash-advances-payout/'))
  ) {
    return true;
  }

  if (p === '/store/purchase-requests' || p.startsWith('/store/purchase-requests/')) {
    if (canApprovePurchaseAsManager(user) || canView(user, 'store_inventory', profile)) return true;
  }

  for (const [prefix, key] of SORTED_PREFIXES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) {
      if (prefix === '/purchases' && canApprovePurchaseAsManager(user)) return true;
      const byMatrix = sidebarMatrixVisibilityForPath(user, p);
      if (byMatrix !== null) return byMatrix;
      return canView(user, key, profile);
    }
  }

  return true;
}
