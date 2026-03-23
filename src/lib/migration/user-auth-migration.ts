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
  writeBatch,
} from 'firebase/firestore';
import {
  getBaselineProfiles,
} from '../permissions';
import { sanitizeFirestorePayload } from '../utils';

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

export interface UserMigrationEntry {
  userId: string;
  email: string;
  displayName: string;
  legacyRole: string | null;
  legacyDepartment: string | null;
  legacyLevel: string | null;
  mappedCanonical: string;
  confidence: 'high' | 'medium' | 'low' | 'needs_review';
  hasConflict: boolean;
  patchApplied: boolean;
}

export interface MigrationReport {
  timestamp: number;
  actorUid: string;
  dryRun: boolean;
  usersProcessed: number;
  usersPatched: number;
  usersSkipped: number;
  usersNeedsReview: number;
  usersConflict: number;
  profilesCreated: string[];
  entries: UserMigrationEntry[];
  errors: string[];
}

/**
 * Executes the user authorization migration process.
 */
export async function runUserAuthMigration(
  db: Firestore,
  options: { actorUid: string; dryRun?: boolean; skipNeedsReview?: boolean }
): Promise<MigrationReport> {
  const { actorUid, dryRun = true, skipNeedsReview = true } = options;
  const report: MigrationReport = {
    timestamp: Date.now(),
    actorUid,
    dryRun,
    usersProcessed: 0,
    usersPatched: 0,
    usersSkipped: 0,
    usersNeedsReview: 0,
    usersConflict: 0,
    profilesCreated: [],
    entries: [],
    errors: [],
  };

  try {
    // 1. Ensure baseline profiles exist if not dry run
    if (!dryRun) {
      const baselines = getBaselineProfiles();
      const batch = writeBatch(db);
      for (const p of baselines) {
        if (!p.profileKey) continue;
        const profileRef = doc(db, 'permission_profiles', p.profileKey);
        const snap = await getDoc(profileRef);
        if (!snap.exists()) {
          batch.set(profileRef, {
            ...p,
            id: p.profileKey,
            updatedAt: Date.now(),
            updatedBy: 'Migration Tool',
          });
          report.profilesCreated.push(p.profileKey);
        }
      }
      await batch.commit();
    }

    // 2. Fetch all users
    const usersSnap = await getDocs(collection(db, 'users'));
    const users = usersSnap.docs.map(d => ({ ...d.data(), id: d.id } as User));
    report.usersProcessed = users.length;

    const batch = writeBatch(db);
    let patchCount = 0;

    for (const user of users) {
      const mapping = mapLegacyToCanonical(user);
      const entry: UserMigrationEntry = {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        legacyRole: user.assignedRoleKey || user.roleId || null,
        legacyDepartment: user.department || null,
        legacyLevel: user.level || null,
        mappedCanonical: mapping.canonical,
        confidence: mapping.confidence,
        hasConflict: false,
        patchApplied: false,
      };

      // Conflict check: if user already has new fields and they differ from mapping
      const migrationFields = buildMigrationFields(user, mapping);
      if (user.departmentGroup && user.departmentGroup !== migrationFields.departmentGroup) {
        entry.hasConflict = true;
        report.usersConflict++;
      }

      if (mapping.confidence === 'needs_review') {
        report.usersNeedsReview++;
      }

      const shouldPatch = !entry.hasConflict && (mapping.confidence !== 'needs_review' || !skipNeedsReview);

      if (shouldPatch) {
        // Only patch if missing or changed
        if (user.departmentGroup !== migrationFields.departmentGroup || user.accessLevel !== migrationFields.accessLevel) {
          if (!dryRun) {
            batch.update(doc(db, 'users', user.id), migrationFields);
          }
          entry.patchApplied = true;
          report.usersPatched++;
          patchCount++;
        } else {
          report.usersSkipped++;
        }
      } else {
        report.usersSkipped++;
      }

      report.entries.push(entry);
    }

    if (!dryRun && patchCount > 0) {
      await batch.commit();
    }

  } catch (e: any) {
    console.error('Migration failed:', e);
    report.errors.push(e.message);
  }

  return report;
}
