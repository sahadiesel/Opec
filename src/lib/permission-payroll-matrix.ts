/**
 * Payroll / timesheet / HR policy matrix — Role × Action × Resource (canonical rules).
 * Returns allow | deny | inherit (inherit → module fallback in permissions.ts).
 *
 * Personas: system admin, HR Manager, HR Officer, Accounting, other internal (inherit).
 */

import type { User } from './types';
import {
  getEffectiveAccessGroup,
  getPrimaryLegacyRole,
  isSystemAdmin,
} from './permission-core';

export type PayrollMatrixResource =
  | 'timesheet'
  | 'payroll_worker'
  | 'payroll_office'
  | 'policy'
  | 'worker'
  | 'office_staff'
  | 'rate_term_cost';

export type PayrollMatrixAction =
  | 'view'
  | 'create'
  | 'edit'
  | 'submit'
  | 'verify'
  | 'create_batch'
  | 'edit_batch'
  | 'approve'
  | 'lock'
  | 'export'
  | 'mark_paid'
  | 'override'
  | 'unlock'
  | 'finance_approve';

export type PayrollMatrixDecision = 'allow' | 'deny' | 'inherit';

function isActiveInternal(u: User): boolean {
  return Boolean(u?.isActive && u.approvalStatus === 'ACTIVE' && getEffectiveAccessGroup(u) !== 'client');
}

function resolvePersona(
  u: User | null
): 'admin' | 'hr_manager' | 'hr_officer' | 'payroll_officer' | 'accounting' | 'other' {
  if (!u || !isActiveInternal(u)) return 'other';
  if (isSystemAdmin(u)) return 'admin';

  const group = getEffectiveAccessGroup(u);
  if (group === 'accounting') return 'accounting';

  const role = getPrimaryLegacyRole(u);

  if (role === 'hr_manager') return 'hr_manager';
  if (role === 'hr_officer') return 'hr_officer';
  if (role === 'payroll_officer') return 'payroll_officer';
  if (role === 'operations_manager' || role === 'operation_manager') return 'hr_manager';

  return 'other';
}

/**
 * Core matrix: explicit allow/deny; `inherit` defers to module keys in permissions.ts.
 */
export function resolvePayrollMatrixDecision(
  user: User | null,
  resource: PayrollMatrixResource,
  action: PayrollMatrixAction
): PayrollMatrixDecision {
  if (!user) return 'deny';

  const persona = resolvePersona(user);

  if (persona === 'admin') {
    if (action === 'unlock' || action === 'override') return 'allow';
    return 'allow';
  }

  if (persona === 'accounting') {
    if (resource === 'timesheet' && action !== 'view') return 'deny';
    if (resource === 'payroll_worker' || resource === 'payroll_office') {
      if (action === 'view' || action === 'export' || action === 'mark_paid' || action === 'finance_approve') return 'allow';
      if (action === 'edit_batch' || action === 'create_batch' || action === 'approve' || action === 'lock')
        return 'deny';
      if (action === 'edit' || action === 'create') return 'deny';
    }
    if (resource === 'policy') return action === 'view' ? 'inherit' : 'deny';
    if (resource === 'worker' || resource === 'office_staff') return action === 'view' ? 'allow' : 'deny';
    if (resource === 'rate_term_cost') return action === 'view' ? 'allow' : 'deny';
    return 'inherit';
  }

  if (persona === 'hr_officer') {
    if (resource === 'timesheet') {
      if (action === 'view' || action === 'create' || action === 'edit' || action === 'submit') return 'allow';
      if (action === 'verify') return 'deny';
      return 'deny';
    }
    if (resource === 'payroll_worker') {
      if (action === 'view' || action === 'create_batch' || action === 'edit_batch') return 'allow';
      if (action === 'approve' || action === 'lock' || action === 'finance_approve') return 'deny';
      return 'deny';
    }
    if (resource === 'payroll_office') {
      if (['view', 'create', 'edit', 'submit'].includes(action)) return 'allow';
      if (action === 'approve' || action === 'lock' || action === 'finance_approve') return 'deny';
      return 'deny';
    }
    if (resource === 'policy') return action === 'view' ? 'allow' : 'deny';
    if (resource === 'worker' || resource === 'office_staff') return action === 'view' ? 'allow' : 'deny';
    if (resource === 'rate_term_cost') return action === 'view' ? 'allow' : 'deny';
    return 'inherit';
  }

  if (persona === 'payroll_officer') {
    if (resource === 'timesheet') return action === 'view' ? 'allow' : 'deny';
    if (resource === 'payroll_worker') {
      if (action === 'view' || action === 'create_batch' || action === 'edit_batch') return 'allow';
      if (action === 'approve' || action === 'lock' || action === 'finance_approve') return 'deny';
      return 'deny';
    }
    if (resource === 'payroll_office') {
      if (action === 'view' || action === 'create' || action === 'edit' || action === 'submit') return 'allow';
      if (action === 'approve' || action === 'lock' || action === 'finance_approve') return 'deny';
      return 'deny';
    }
    if (resource === 'policy') return action === 'view' ? 'allow' : 'deny';
    if (resource === 'worker' || resource === 'office_staff' || resource === 'rate_term_cost') return 'deny';
    return 'inherit';
  }

  if (persona === 'hr_manager') {
    if (resource === 'policy' && action === 'edit') return 'deny';
    if (resource === 'policy') return action === 'view' ? 'allow' : 'deny';

    if (resource === 'timesheet') {
      if (['view', 'create', 'edit', 'submit', 'verify'].includes(action)) return 'allow';
      return 'deny';
    }
    if (resource === 'payroll_worker') {
      if (['view', 'create_batch', 'edit_batch', 'approve', 'lock'].includes(action)) return 'allow';
      if (action === 'finance_approve' || action === 'mark_paid') return 'deny';
      return 'deny';
    }
    if (resource === 'payroll_office') {
      if (['view', 'create', 'edit', 'submit', 'approve', 'lock'].includes(action)) return 'allow';
      if (action === 'finance_approve') return 'deny';
      return 'deny';
    }
    if (resource === 'worker' || resource === 'office_staff') {
      if (['view', 'create', 'edit'].includes(action)) return 'allow';
      return 'deny';
    }
    if (resource === 'rate_term_cost') return action === 'view' ? 'allow' : 'inherit';

    return 'inherit';
  }

  return 'inherit';
}
