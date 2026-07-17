/**
 * มาตรฐานการตรวจสิทธิ์ตาม path — ให้สอดคล้องกับเมนู sidebar
 * (รายละเอียดรายเมนูปรับเพิ่มได้ภายหลังที่นี่และใน permissions)
 */

import type { User, PermissionProfile } from '@/lib/types';
import {
  type ModuleKey,
  canView,
  canApprovePurchaseAsManager,
  canSeeSalesPillarUi,
  canSeeOperationsPillarUi,
  canSeeStorePillarUi,
  canSeeAccountingPillarUi,
  isClient,
  isPrimaryHrOfficer,
} from '@/lib/permissions';
import {
  isSystemAdmin,
  isExecutiveViewer,
  isHrManager,
  isOperationManager,
  isPayrollOfficer,
  getPrimaryLegacyRole,
  isTimekeeper,
} from '@/lib/permission-core';
import { isSimpleAdmin, isSimpleInternalEligible } from '@/lib/simple-tier-model';
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

/** หมวดลงเวลา (รายวัน / รายเดือน + เมนูย่อยในหมวดเดียวกัน) — หัวหน้างานจ่ายค่าจ้าง หรือ operations_officer/timekeeper ที่มีสิทธิ์ timesheets; รายการจัดการ Kiosk แยกไปใช้ {@link canViewHrPayrollFlowSubsection} ผ่าน payrollAttendanceManageOnly */
export function canViewHrFieldTimesheetSubsection(
  user: User,
  profile: PermissionProfile | null,
  admin: boolean,
): boolean {
  if (admin) return true;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return true;
  if (canViewHrPayrollFlowSubsection(user, profile, admin)) return true;
  const fieldTsRole = getPrimaryLegacyRole(user);
  if (
    (fieldTsRole === 'operations_officer' || fieldTsRole === 'timekeeper') &&
    canView(user, 'timesheets', profile)
  ) {
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

/** เมนูเตรียมจ่าย / อนุมัติ payroll — ไม่แสดงให้ hr_officer (ไม่มี worker_payroll) */
function hrOfficerExcludedFromHrNavItem(user: User, item: HrNavItem): boolean {
  if (!isPrimaryHrOfficer(user)) return false;
  const full = item.href;
  const base = full.split('#')[0];
  if (full.includes('#hr-action-queue')) return true;
  if (base.startsWith('/hr/payroll-workbench')) return true;
  if (base.startsWith('/hr/payroll-approval')) return true;
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
  if (item.payrollAttendanceManageOnly) {
    if (canViewHrPayrollFlowSubsection(user, profile, admin)) return true;
    /** เจ้าหน้าที่บันทึกเวลา — เฉพาะเมนูจัดการ Kiosk / QR */
    if (isTimekeeper(user) && canView(user, 'timesheets', profile)) return true;
    return false;
  }
  /** เมนู หัก ณ ที่จ่าย / ปกส. ใต้กลุ่ม Payroll — เปิดให้ payroll lead โดยไม่ต้องผ่าน module accounting */
  if (item.payrollLeadOnly) {
    return canViewHrPayrollFlowSubsection(user, profile, admin);
  }
  const rkForHrHub = getPrimaryLegacyRole(user);
  if (
    (rkForHrHub === 'operations_officer' || rkForHrHub === 'timekeeper') &&
    operationsOfficerExcludedHrMasterHref(baseHref)
  ) {
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
  return canView(user, item.key, profile);
}

/** เข้าหน้าจัดการลงเวลา / Kiosk QR — Payroll lead หรือ Timekeeper (มีโมดูล timesheets) */
export function canAccessHrAttendanceKioskPages(
  user: User | null,
  profile: PermissionProfile | null,
): boolean {
  if (!user) return false;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return true;
  if (canViewHrPayrollFlowSubsection(user, profile, false)) return true;
  return isTimekeeper(user) && canView(user, 'timesheets', profile);
}

const MODULE_PREFIXES: Array<[string, ModuleKey]> = [
  ['/draft-invoices', 'draft_invoices'],
  ['/accounting/trip-billing', 'draft_invoices'],
  ['/accounting/executive-payroll', 'executive_payroll'],
  ['/accounting/withholding-payroll/executive', 'executive_payroll'],
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
  ['/accounting/contracts', 'accounts_payable'],
  ['/accounting/rental-contracts', 'accounts_payable'],
  ['/accounting/outgoing-review', 'accounts_payable'],
  ['/accounting/withholding-tax', 'withholding_tax_items'],
  ['/accounting/withholding-payroll', 'worker_payroll'],
  ['/accounting/withholding-vendor', 'withholding_tax_items'],
  ['/accounting/withholding-opec', 'withholding_tax_items'],
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
  ['/hr/leaves', 'hr_hub'],
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
  const executiveViewer = isExecutiveViewer(user);
  const fullMenuAccess = admin || executiveViewer;

  if (fullMenuAccess) return true;

  if (isClient(user)) {
    return p.startsWith('/client-portal');
  }

  if (p.startsWith('/client-portal')) {
    return false;
  }

  const denyWarehouseDocsRole = getPrimaryLegacyRole(user);
  if (
    !admin &&
    (denyWarehouseDocsRole === 'operations_officer' || denyWarehouseDocsRole === 'timekeeper')
  ) {
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

  /** เจ้าหน้าที่ปฏิบัติการ — ไม่เปิดหน้า Commercial (อ่านข้อมูล PO/สัญญาในคิว PO Active ผ่าน Firestore โดยตรง) */
  if (!admin && denyWarehouseDocsRole === 'operations_officer') {
    const deniedCommercial = [
      '/billing-client',
      '/customers',
      '/quotations',
      '/main-contracts',
      '/purchase-orders',
      '/sales-terms',
      '/labor-cost-terms',
      '/sales/dashboard',
    ] as const;
    if (deniedCommercial.some((pre) => p === pre || p.startsWith(`${pre}/`))) {
      return false;
    }
  }

  if (p.startsWith('/users') || p.startsWith('/system-admin')) {
    return false;
  }

  /**
   * เมนูใต้กลุ่ม Payroll ที่ลิงก์ไปยังหน้าใต้ /accounting/... — เปิดให้ payroll lead
   * (hr_manager · operations_manager · payroll_officer) เข้าได้นอกเหนือจากฝั่งบัญชี
   *  - หัก ณ ที่จ่าย (พนักงาน)  → /accounting/withholding-payroll
   *  - จ่ายประกันสังคม          → /accounting/social-security-payroll
   * ส่วน /accounting/withholding-payroll/executive ใต้พาธเดียวกัน — เปิดให้ payroll lead เห็น
   * เฉพาะหน้านี้ (เพราะใช้ url ภายใต้ /accounting/withholding-payroll/) ก็ผ่าน prefix นี้เช่นกัน
   */
  const payrollLeadAccountingPaths = [
    '/accounting/withholding-payroll',
    '/accounting/social-security-payroll',
  ];
  if (
    payrollLeadAccountingPaths.some((pre) => p === pre || p.startsWith(`${pre}/`))
    && canViewHrPayrollFlowSubsection(user, profile, admin)
  ) {
    return true;
  }

  const accountingPathModules: Array<[string, ModuleKey]> = [
    ['/billing-notes', 'billing_notes'],
    ['/tax-invoices', 'tax_invoices'],
    ['/receipts', 'receipts'],
    ['/ap-bills', 'ap_bills'],
    ['/accounts-receivable', 'accounts_receivable'],
    ['/accounts-payable', 'accounts_payable'],
    ['/accounting/contracts', 'accounts_payable'],
    ['/accounting/rental-contracts', 'accounts_payable'],
    ['/cashbook', 'cashbook'],
    ['/bank-accounts', 'bank_accounts'],
    ['/accounting/executive-payroll', 'executive_payroll'],
    ['/accounting/withholding-payroll/executive', 'executive_payroll'],
    ['/accounting/withholding-tax', 'withholding_tax_items'],
    ['/accounting/withholding-payroll', 'withholding_tax_items'],
    ['/accounting/withholding-vendor', 'withholding_tax_items'],
    ['/accounting/social-security-payroll', 'withholding_tax_items'],
    ['/accounting/dashboard', 'accounting_dashboard'],
    ['/accounting/office-payroll', 'office_payroll'],
    ['/accounting/worker-payroll', 'worker_payroll'],
    ['/accounting/cash-advances-payout', 'cash_advances'],
  ];
  accountingPathModules.sort((a, b) => b[0].length - a[0].length);
  for (const [pre, key] of accountingPathModules) {
    if (p === pre || p.startsWith(`${pre}/`)) {
      return admin || canView(user, key, profile);
    }
  }

  if (p === '/' || p === '') {
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

  /** ลงเวลาผ่านมือถือหลังสแกน QR — พนักงาน internal ที่ล็อกอินแล้ว */
  if (pathMatches(p, '/hr/attendance/mobile')) {
    return isSimpleInternalEligible(user);
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

  /** บัญชี: ดูรายการจ่ายลูกจ้าง (หลัง manager อนุมัติ batch) */
  if (
    !admin &&
    (p === '/payroll/batches' ||
      p.startsWith('/payroll/batches/') ||
      p === '/accounting/worker-payroll' ||
      p.startsWith('/accounting/worker-payroll/')) &&
    canView(user, 'worker_payroll', profile)
  ) {
    return true;
  }

  /** บัญชี: คิวจ่ายเบิกล่วงหน้าหลังผู้จัดการอนุมัติ */
  if (
    !admin &&
    (p === '/accounting/cash-advances-payout' || p.startsWith('/accounting/cash-advances-payout/')) &&
    canView(user, 'cash_advances', profile)
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

  /** path อ้างอิงใน menu-permission-map (ไม่มี route แยก — map ตาม module) */
  if (p === '/hr/payroll') {
    return canView(user, 'worker_payroll', profile);
  }
  if (p === '/hr/approval') {
    return canView(user, 'hr_hub', profile);
  }

  return true;
}
