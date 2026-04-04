/**
 * มาตรฐานการตรวจสิทธิ์ตาม path — ให้สอดคล้องกับเมนู sidebar
 * (รายละเอียดรายเมนูปรับเพิ่มได้ภายหลังที่นี่และใน permissions)
 */

import type { User, PermissionProfile } from '@/lib/types';
import {
  type ModuleKey,
  canView,
  canSeeHrPillarUi,
  canSeeSalesPillarUi,
  canSeeOperationsPillarUi,
  canSeeStorePillarUi,
  canSeeAccountingPillarUi,
  canAccess,
  isClient,
} from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { getFlattenedHrNavItems, type HrNavItem } from '@/lib/navigation/hr-nav-items';

export function pathMatches(pathname: string, href: string): boolean {
  const base = href.split('#')[0];
  if (pathname === base) return true;
  if (base !== '/' && pathname.startsWith(`${base}/`)) return true;
  return false;
}

/** แม็ป path → โมดูล matrix (ถ้ามี) — ต้องครอบคลุม dynamic segments */
export function resolveMatrixModuleForPath(pathname: string): string | null {
  const p = pathname.split('?')[0];
  if (p === '/workers' || p.startsWith('/workers/')) return 'workers';
  if (p === '/positions' || p.startsWith('/positions/')) return 'positions';
  if (p === '/worker-document-catalog' || p.startsWith('/worker-document-catalog/')) return 'worker_documents';
  if (p === '/assignments' || p.startsWith('/assignments/')) return 'assignments';
  if (p === '/mobilization' || p.startsWith('/mobilization/')) return 'mobilization';
  if (p.startsWith('/timesheets')) return 'timesheets';
  if (p.startsWith('/payroll/batches')) return 'worker_payroll';
  if (p.startsWith('/payroll/periods')) return 'payroll_runs';
  return null;
}

/**
 * ถ้าคืน null = ไม่ใช้ matrix สำหรับ role นี้หรือ path นี้ — ใช้ canView ต่อ
 */
export function sidebarMatrixVisibilityForPath(user: User, pathname: string): boolean | null {
  const role = user.assignedRoleKey;
  if (!role) return null;

  if (!['system_admin', 'hr_officer', 'payroll_officer', 'operation_manager'].includes(role)) {
    return null;
  }

  const module = resolveMatrixModuleForPath(pathname);
  if (!module) return null;

  return canAccess(user, module, 'view');
}

export function canViewHrHubItem(
  user: User,
  profile: PermissionProfile | null,
  admin: boolean,
  item: HrNavItem
): boolean {
  if (admin) return true;
  const byMatrix = sidebarMatrixVisibilityForPath(user, item.href.split('#')[0]);
  if (byMatrix !== null) return byMatrix;
  if (canView(user, item.key, profile)) return true;
  if (item.href.startsWith('/hr/')) {
    return canSeeHrPillarUi(user, profile);
  }
  return false;
}

const MODULE_PREFIXES: Array<[string, ModuleKey]> = [
  ['/accounting/executive-payroll', 'executive_payroll'],
  ['/office-payroll', 'office_payroll'],
  ['/purchase-orders', 'customer_pos'],
  ['/main-contracts', 'main_contracts'],
  ['/sales-terms', 'sales_contract_terms'],
  ['/labor-cost-terms', 'labor_cost_contract_terms'],
  ['/worker-document-catalog', 'workers'],
  ['/accounts-receivable', 'accounts_receivable'],
  ['/accounts-payable', 'accounts_payable'],
  ['/billing-notes', 'billing_notes'],
  ['/tax-invoices', 'tax_invoices'],
  ['/bank-accounts', 'bank_accounts'],
  ['/customers', 'customers'],
  ['/quotations', 'quotations'],
  ['/assignments', 'assignments'],
  ['/mobilization', 'mobilization'],
  ['/purchases', 'purchases'],
  ['/ap-bills', 'ap_bills'],
  ['/receipts', 'receipts'],
  ['/cashbook', 'cashbook'],
  ['/office-staff', 'office_staff'],
  ['/positions', 'positions'],
  ['/workers', 'workers'],
  ['/vendors', 'vendors'],
  ['/waves', 'waves'],
  ['/store', 'store_inventory'],
];

const SORTED_PREFIXES = [...MODULE_PREFIXES].sort((a, b) => b[0].length - a[0].length);

/**
 * ผู้ใช้ที่ล็อกอินแล้ว (internal) เข้า path นี้ได้หรือไม่ — ใช้ใน AppShell
 * - system_admin: ผ่านทุก path (ยกเว้นจะแยก logic client ด้านล่าง)
 * - ลูกค้า portal: เฉพาะ /client-portal/*
 * - internal: ไม่ให้เข้า /client-portal
 */
export function userMayAccessPath(user: User, profile: PermissionProfile | null, pathname: string): boolean {
  const p = (pathname.split('?')[0] || '/').trim() || '/';
  const admin = isSystemAdmin(user);

  if (admin) return true;

  if (isClient(user)) {
    return p.startsWith('/client-portal');
  }

  if (p.startsWith('/client-portal')) {
    return false;
  }

  if (p.startsWith('/users') || p.startsWith('/system-admin')) {
    return false;
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

  const hrSorted = getFlattenedHrNavItems().sort((a, b) => b.href.length - a.href.length);
  for (const item of hrSorted) {
    const baseHref = item.href.split('#')[0];
    if (pathMatches(p, baseHref)) {
      return canViewHrHubItem(user, profile, false, item);
    }
  }

  for (const [prefix, key] of SORTED_PREFIXES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) {
      const byMatrix = sidebarMatrixVisibilityForPath(user, p);
      if (byMatrix !== null) return byMatrix;
      return canView(user, key, profile);
    }
  }

  /* เส้นทางที่ยังไม่ลงทะเบียน: ไม่บล็อกเพื่อไม่ให้หน้าใหม่พัง — ค่อยเพิ่ม prefix ใน MODULE_PREFIXES */
  return true;
}
