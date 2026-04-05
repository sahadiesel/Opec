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
  isClient,
} from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAccounting, isSimpleAdmin, isSimpleInternalEligible } from '@/lib/simple-tier-model';
import { getFlattenedHrNavItems, type HrNavItem } from '@/lib/navigation/hr-nav-items';

export function pathMatches(pathname: string, href: string): boolean {
  const base = href.split('#')[0];
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
  ['/payroll', 'worker_payroll'],
  ['/timesheets', 'timesheets'],
  ['/purchase-orders', 'customer_pos'],
  ['/main-contracts', 'main_contracts'],
  ['/sales-terms', 'sales_contract_terms'],
  ['/labor-cost-terms', 'labor_cost_contract_terms'],
  ['/worker-document-catalog', 'worker_documents'],
  ['/accounts-receivable', 'accounts_receivable'],
  ['/accounts-payable', 'accounts_payable'],
  ['/billing-notes', 'billing_notes'],
  ['/tax-invoices', 'tax_invoices'],
  ['/bank-accounts', 'bank_accounts'],
  ['/customers', 'customers'],
  ['/quotations', 'quotations'],
  ['/assignments', 'assignments'],
  ['/mobilization', 'mobilization'],
  ['/store/vendor-bills', 'store_inventory'],
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

  return true;
}
