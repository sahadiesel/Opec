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

  return patch;
}

// ---------------------------------------------------------------------------
// Baseline permission profiles (create if missing)
// ---------------------------------------------------------------------------

// Operation = sales + hr + operations + store (store moved to operation per spec)
const OPERATION_MODULE_KEYS: string[] = [
  'customers', 'main_contracts', 'customer_pos', 'quotations', 'sales_contract_terms',
  'rate_conditions', 'profit_estimates',
  'timesheets', 'worker_payroll', 'office_payroll', 'payment_export_batches',
  'labor_cost_contract_terms', 'positions', 'workers', 'office_staff',
  'waves', 'assignments', 'mobilization',
  'vendors', 'purchases', 'store_inventory',
];

// Accounting = sales + hr (no timesheets) + store + finance per spec
const ACCOUNTING_MODULE_KEYS: string[] = [
  'customers', 'main_contracts', 'customer_pos', 'quotations', 'sales_contract_terms',
  'rate_conditions', 'profit_estimates',
  'worker_payroll', 'office_payroll', 'payment_export_batches',
  'labor_cost_contract_terms', 'positions', 'workers', 'office_staff',
  'vendors', 'purchases', 'store_inventory',
  'billing_notes', 'tax_invoices', 'receipts', 'ap_bills',
  'accounts_receivable', 'accounts_payable', 'cashbook', 'bank_accounts',
];

function clonePermission(p: ModulePermission): ModulePermission {
  return { ...p };
}

function buildPermissionMap(
  allowedKeys: readonly string[],
  access: ModulePermission
): Record<string, ModulePermission> {
  const allowedSet = new Set(allowedKeys);
  return SYSTEM_MODULES.reduce((acc, mod) => {
    if (mod.key === 'overview_dashboard') {
      acc[mod.key] = clonePermission(READ_ONLY);
    } else if (allowedSet.has(mod.key)) {
      acc[mod.key] = clonePermission(access);
    } else {
      acc[mod.key] = clonePermission(NO_ACCESS);
    }
    return acc;
  }, {} as Record<string, ModulePermission>);
}

export const BASELINE_PROFILES: Partial<PermissionProfile>[] = [
  {
    profileKey: 'admin_admin',
    profileNameEn: 'System Administrator',
    profileNameTh: 'ผู้ดูแลระบบสูงสุด',
    departmentGroup: 'admin',
    primaryRoleTemplateKey: 'admin_admin',
    department: 'admin',
    level: 'admin',
    isActive: true,
    permissions: SYSTEM_MODULES.reduce((acc, mod) => {
      acc[mod.key] = clonePermission(FULL_ACCESS);
      return acc;
    }, {} as Record<string, ModulePermission>),
  },
  {
    profileKey: 'operation_manager',
    profileNameEn: 'Operations Manager (Sales/HR/Ops/Store)',
    profileNameTh: 'ผู้จัดการปฏิบัติการ (ขาย/บุคคล/คลัง)',
    departmentGroup: 'operation',
    primaryRoleTemplateKey: 'operation_manager',
    department: 'operations',
    level: 'manager',
    isActive: true,
    permissions: buildPermissionMap(OPERATION_MODULE_KEYS, FULL_ACCESS),
  },
  {
    profileKey: 'operation_officer',
    profileNameEn: 'Operations Officer (Sales/HR/Ops/Store)',
    profileNameTh: 'เจ้าหน้าที่ปฏิบัติการ (ขาย/บุคคล/คลัง)',
    departmentGroup: 'operation',
    primaryRoleTemplateKey: 'operation_officer',
    department: 'operations',
    level: 'officer',
    isActive: true,
    permissions: buildPermissionMap(OPERATION_MODULE_KEYS, OFFICER_ACCESS),
  },
  {
    profileKey: 'accounting_manager',
    profileNameEn: 'Accounting Manager',
    profileNameTh: 'ผู้จัดการฝ่ายบัญชี',
    departmentGroup: 'accounting',
    primaryRoleTemplateKey: 'accounting_manager',
    department: 'accounting',
    level: 'manager',
    isActive: true,
    permissions: buildPermissionMap(ACCOUNTING_MODULE_KEYS, FULL_ACCESS),
  },
  {
    profileKey: 'accounting_officer',
    profileNameEn: 'Accounting Officer',
    profileNameTh: 'เจ้าหน้าที่ฝ่ายบัญชี',
    departmentGroup: 'accounting',
    primaryRoleTemplateKey: 'accounting_officer',
    department: 'accounting',
    level: 'officer',
    isActive: true,
    permissions: buildPermissionMap(ACCOUNTING_MODULE_KEYS, OFFICER_ACCESS),
  },
  {
    profileKey: 'client_user',
    profileNameEn: 'Client Portal User',
    profileNameTh: 'ลูกค้า / ผู้ใช้งานภายนอก',
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

// ---------------------------------------------------------------------------
// Migration report
// ---------------------------------------------------------------------------

export interface UserMigrationEntry {
  userId: string;
  email: string;
  displayName: string;
  legacyRole?: string;
  legacyDepartment?: DeptType;
  legacyLevel?: AccessLevel;
  mappedCanonical: CanonicalRoleKey;
  confidence: 'high' | 'medium' | 'low' | 'needs_review';
  source: string;
  hasConflict: boolean;
  conflictDetails?: string;
  patchApplied: boolean;
  profileCreated?: string;
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
  profilesLegacyKept: string[];
  entries: UserMigrationEntry[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Migration runner (admin-only)
// ---------------------------------------------------------------------------

export async function ensureBaselineProfiles(
  firestore: Firestore,
  actorUid: string
): Promise<{ created: string[] }> {
  const created: string[] = [];
  const now = Date.now();

  for (const p of BASELINE_PROFILES) {
    const key = p.profileKey!;
    const profileRef = doc(firestore, 'permission_profiles', key);
    const existing = await getDoc(profileRef);
    if (!existing.exists()) {
      await setDoc(profileRef, {
        ...p,
        id: key,
        profileKey: key,
        updatedAt: now,
        updatedBy: actorUid,
        createdAt: now,
        createdBy: actorUid,
        notes: 'Created by user-auth migration',
      });
      created.push(key);
    }
  }
  return { created };
}

export async function runUserAuthMigration(
  firestore: Firestore,
  options: {
    actorUid: string;
    dryRun?: boolean;
    skipNeedsReview?: boolean;
  }
): Promise<MigrationReport> {
  const { actorUid, dryRun = true, skipNeedsReview = true } = options;
  const now = Date.now();

  const report: MigrationReport = {
    timestamp: now,
    actorUid,
    dryRun,
    usersProcessed: 0,
    usersPatched: 0,
    usersSkipped: 0,
    usersNeedsReview: 0,
    usersConflict: 0,
    profilesCreated: [],
    profilesLegacyKept: [],
    entries: [],
    errors: [],
  };

  try {
    // 1. Ensure baseline profiles exist
    const { created } = await ensureBaselineProfiles(firestore, actorUid);
    report.profilesCreated = created;

    // 2. Load all users
    const usersSnap = await getDocs(collection(firestore, 'users'));
    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Partial<User> & { id: string }));

    for (const user of users) {
      report.usersProcessed++;

      const mapping = mapLegacyToCanonical(user);

      // Conflict: has both operation and accounting indicators?
      const hasOp = hasAnyRole(user, OPERATION_ROLE_CANDIDATES) || ['hr', 'operations', 'sales', 'store'].includes(user.department || '');
      const hasAcct = hasAnyRole(user, ACCOUNTING_ROLE_CANDIDATES) || user.department === 'accounting';
      const hasConflict = hasOp && hasAcct && !hasAnyRole(user, ADMIN_ROLE_CANDIDATES);

      const entry: UserMigrationEntry = {
        userId: user.id!,
        email: user.email || '',
        displayName: user.displayName || '',
        legacyRole: (user.assignedRoleKey || user.roleId) as string,
        legacyDepartment: user.department,
        legacyLevel: user.level || user.accessLevel,
        mappedCanonical: mapping.canonical,
        confidence: mapping.confidence,
        source: mapping.source,
        hasConflict,
        conflictDetails: hasConflict ? 'User has both operation and accounting indicators' : undefined,
        patchApplied: false,
      };

      if (hasConflict) report.usersConflict++;
      if (mapping.confidence === 'needs_review') report.usersNeedsReview++;

      // Skip if needs_review and skipNeedsReview
      if (mapping.confidence === 'needs_review' && skipNeedsReview) {
        report.usersSkipped++;
        report.entries.push(entry);
        continue;
      }

      // Skip if already has new fields and no conflict
      if (
        user.departmentGroup &&
        user.accessGroup &&
        user.assignedRoleKey &&
        !hasConflict &&
        mapping.confidence === 'high'
      ) {
        report.usersSkipped++;
        report.entries.push(entry);
        continue;
      }

      const patch = buildMigrationFields(user, mapping);

      if (!dryRun) {
        try {
          const userRef = doc(firestore, 'users', user.id!);
          await updateDoc(userRef, patch as any);
          entry.patchApplied = true;
          report.usersPatched++;
        } catch (e: any) {
          report.errors.push(`User ${user.id}: ${e.message}`);
        }
      } else {
        entry.patchApplied = false;
        report.usersPatched++; // would-be
      }

      report.entries.push(entry);
    }

    return report;
  } catch (e: any) {
    report.errors.push(`Migration failed: ${e.message}`);
    return report;
  }
}
