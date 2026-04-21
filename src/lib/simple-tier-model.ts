/**
 * 3-tier access model (align with firestore.rules):
 * - admin: system_admin
 * - accounting: accounting_manager | accounting_officer
 * - internal: any other active internal user (default)
 */
import type { User } from '@/lib/types';

/** Prefer explicit `role` (snake_case doc) then assignedRoleKey. */
export function getEffectiveSimpleRole(user: Partial<User> | null | undefined): string | null {
  if (!user) return null;
  const r = (user as { role?: string }).role;
  if (typeof r === 'string' && r.trim()) return r.trim().toLowerCase();
  if (user.assignedRoleKey && String(user.assignedRoleKey).trim()) {
    return String(user.assignedRoleKey).trim().toLowerCase();
  }
  return null;
}

export function isActiveForApp(user: Partial<User> | null | undefined): boolean {
  if (!user) return false;
  if (user.isActive === false) return false;
  const ap = user.approvalStatus;
  if (ap === 'SUSPENDED' || ap === 'REJECTED') return false;
  /** Firestore truth wins over optional snake_case `status` (avoid stale status blocking ACTIVE users). */
  if (ap === 'ACTIVE' || ap === 'APPROVED') return true;
  if (ap === 'PENDING') return false;

  const st = (user as { status?: string }).status;
  if (typeof st === 'string') {
    const s = st.toLowerCase();
    if (s === 'suspended') return false;
    if (s === 'pending') return false;
    if (s === 'active') return true;
  }
  return user.isActive === true;
}

export function isInternalTypeUser(user: Partial<User> | null | undefined): boolean {
  if (!user) return false;
  const ut = (user as { user_type?: string }).user_type;
  if (typeof ut === 'string' && ut === 'internal') return true;
  if (user.userType === 'internal') return true;
  if (user.userType === 'customer_portal') return false;
  if ((user as { user_type?: string }).user_type === 'customer_portal') return false;
  return user.userType !== 'customer_portal';
}

export function isSimpleAdmin(user: Partial<User> | null | undefined): boolean {
  if (!user || !isActiveForApp(user) || !isInternalTypeUser(user)) return false;
  const rk = getEffectiveSimpleRole(user);
  if (rk === 'system_admin') return true;
  return false;
}

export function isSimpleAccounting(user: Partial<User> | null | undefined): boolean {
  if (!user || !isActiveForApp(user) || !isInternalTypeUser(user)) return false;
  const rk = getEffectiveSimpleRole(user);
  return rk === 'accounting_manager' || rk === 'accounting_officer';
}

export function isSimpleInternalEligible(user: Partial<User> | null | undefined): boolean {
  return !!user && isActiveForApp(user) && isInternalTypeUser(user);
}

/** Modules only admin sees in UI (and Firestore: admin-only collections). */
export const ADMIN_ONLY_MODULE_KEYS = new Set<string>([
  'system_admin',
  'document_numbering',
  'audit_logs',
  'client_portal',
]);

/** Modules only accounting + admin (matches accounting Firestore collections). */
export const ACCOUNTING_ONLY_MODULE_KEYS = new Set<string>([
  'billing_notes',
  'tax_invoices',
  'ap_bills',
  'accounts_receivable',
  'accounts_payable',
  'withholding_tax_items',
  'cashbook',
  'bank_accounts',
  'executive_payroll',
]);
