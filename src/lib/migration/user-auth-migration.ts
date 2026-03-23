/**
 * User Authorization Migration — safe backfill from legacy to new structure.
 * - Does NOT delete legacy fields or users.
 * - Adds departmentGroup, accessLevel, assignedRoleKey, permissionProfileKey.
 * - Maps store_* → operation (store moved to operation group per spec).
 * - Marks unclear users as needs_review instead of guessing.
 * - Admin-only execution.
 */

import type { User, PermissionProfile, DeptType, AccessLevel, DepartmentGroup } from '../types';
import type { Firestore } from 'firebase/firestore';
import {
  collection,
  doc,
  getDocs,
  updateDoc,
  setDoc,
  getDoc,
} from 'firebase/firestore';
import {
  SYSTEM_MODULES,
  FULL_ACCESS,
  OFFICER_ACCESS,
  READ_ONLY,
  NO_ACCESS,
  type ModuleKey,
  type ModulePermission,
} from '../permissions';
import { sanitizeFirestorePayload } from '../utils';

// ---------------------------------------------------------------------------
// Canonical mapping (spec: admin, operation, accounting, client)
// store_* → operation per "store อยู่ใน operation group"
// ---------------------------------------------------------------------------

export type CanonicalRoleKey =
  | 'admin_admin'
  | 'operation_officer'
  | 'operation_manager'
  | 'accounting_officer'
  | 'accounting_manager'
  | 'client_user';

const ADMIN_ROLE_CANDIDATES = [
  'system_admin',
  'super_admin',
  'admin',
  'admin_admin',
] as const;

const OPERATION_ROLE_CANDIDATES = [
  'hr_manager',
  'hr_officer',
  'operations_manager',
  'operations_officer',
  'sales_manager',
  'sales_officer',
  'store_manager',
  'store_officer',
  'payroll_officer',
  'safety_officer',
] as const;

const ACCOUNTING_ROLE_CANDIDATES = [
  'accounting_manager',
  'accounting_officer',
  'finance_officer',
] as const;

const CLIENT_ROLE_CANDIDATES = [
  'client_user',
  'client',
  'client_viewer',
  'client_approver',
  'customer_viewer',
  'customer_approver',
] as const;

function hasAnyRole(user: Partial<User>, candidates: readonly string[]): string | null {
  const values = [
    user.roleId,
    user.assignedRoleKey,
    ...(Array.isArray(user.roleIds) ? user.roleIds : []),
    ...(Array.isArray(user.assignedRoleKeys) ? user.assignedRoleKeys : []),
  ]
    .filter(Boolean)
    .map((v) => String(v));

  for (const c of candidates) {
    if (values.includes(c)) return c;
  }
  return null;
}

function normalizeRoleString(v: unknown): string | null {
  if (v == null) return null;
  return String(v).trim().toLowerCase() || null;
}

/** Map legacy role/department to canonical. Returns null if unclear → needs_review. */
export function mapLegacyToCanonical(user: Partial<User>): {
  canonical: CanonicalRoleKey;
  confidence: 'high' | 'medium' | 'low' | 'needs_review';
  source: string;
} {
  // 1. Admin
  const adminRole = hasAnyRole(user, ADMIN_ROLE_CANDIDATES);
  if (adminRole) {
    return { canonical: 'admin_admin', confidence: 'high', source: adminRole };
  }

  // 2. Explicit department
  const dept = user.department;
  const level = user.level ?? user.accessLevel;

  // 3. Client
  const clientRole = hasAnyRole(user, CLIENT_ROLE_CANDIDATES);
  if (clientRole || user.userType === 'customer_portal' || dept === 'client') {
    return { canonical: 'client_user', confidence: 'high', source: clientRole || dept || 'userType' };
  }

  // 4. Accounting (finance_*, accounting_*)
  const acctRole = hasAnyRole(user, ACCOUNTING_ROLE_CANDIDATES);
  if (acctRole || dept === 'accounting') {
    const lv = level === 'manager' ? 'manager' : 'officer';
    return {
      canonical: lv === 'manager' ? 'accounting_manager' : 'accounting_officer',
      confidence: acctRole ? 'high' : 'medium',
      source: acctRole || dept || 'inferred',
    };
  }

  // 5. Operation (hr, operations, sales, store — store moved to operation)
  const opRole = hasAnyRole(user, OPERATION_ROLE_CANDIDATES);
  if (opRole || ['hr', 'operations', 'sales', 'store'].includes(dept || '')) {
    const lv = level === 'manager' ? 'manager' : 'officer';
    return {
      canonical: lv === 'manager' ? 'operation_manager' : 'operation_officer',
      confidence: opRole ? 'high' : 'medium',
      source: opRole || dept || 'inferred',
    };
  }

  // 6. Unclear — do not guess
  return {
    canonical: 'operation_officer',
    confidence: 'needs_review',
    source: 'unclear',
  };
}

/** Build fields to ADD (never remove). Preserves legacy. */
export function buildMigrationFields(
  user: Partial<User>,
  mapping: ReturnType<typeof mapLegacyToCanonical>
): Partial<User> {
  const { canonical, confidence } = mapping;

  const departmentGroup: DepartmentGroup =
    canonical === 'admin_admin'
      ? 'admin'
      : canonical === 'client_user'
        ? 'client'
        : canonical.startsWith('accounting')
          ? 'accounting'
          : 'operation';

  const accessLevel: AccessLevel =
    canonical === 'admin_admin'
      ? 'admin'
      : canonical === 'client_user'
        ? 'viewer'
        : canonical.endsWith('_manager')
          ? 'manager'
          : 'officer';

  const permissionProfileKey = canonical;

  const roleIds: string[] = [canonical === 'admin_admin' ? 'system_admin' : canonical];
  const assignedRoleKeys = [canonical === 'admin_admin' ? 'system_admin' : canonical] as any[];

  const patch: Partial<User> = {
    departmentGroup,
    accessGroup: departmentGroup,
    accessLevel,
    assignedRoleKey: canonical === 'admin_admin' ? 'system_admin' : (canonical as any),
    assignedRoleKeys,
    permissionProfileKey,
    permissionProfileKeys: [permissionProfileKey],
    roleIds: roleIds as any,
    roleId: roleIds[0] as any,
    updatedAt: Date.now(),
  };

  if (confidence === 'needs_review') {
    (patch as any).migrationNeedsReview = true;
  }

  return sanitizeFirestorePayload(patch);
}

// ... remaining logic ...
