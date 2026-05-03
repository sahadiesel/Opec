/**
 * OPEC OpsFlow - Permission core (access groups, domains, gates).
 * Source of truth for getEffectiveAccessGroup, canAccessDomain, isOperationGroupMember.
 * See docs/permissions-architecture.md.
 */

import type { BusinessRoleKey, DeptType, User } from './types';
import { normalizeBusinessRoleKey, normalizePermissionProfileDocumentId } from './role-key-normalizer';
import { isActiveForApp, isInternalTypeUser, isSimpleAdmin, isSimpleAccounting } from './simple-tier-model';

// ---------------------------------------------------------------------------
// Canonical types
// ---------------------------------------------------------------------------

/** Primary access partition (internal + client portal bucket). */
export type AccessGroup = 'admin' | 'operations' | 'accounting' | 'client';

/** Rank within an access group (aligns with User.accessLevel). */
export type CoreAccessLevel = 'viewer' | 'officer' | 'manager' | 'admin';

/** Coarse business areas for routing / future rules (not Firestore module keys). */
export type AccessDomain =
  | 'sales'
  | 'operations'
  | 'hr'
  | 'store'
  | 'accounting'
  | 'system'
  | 'client';

/** Minimum required role keys for the new model (extend via string for legacy). */
export type CorePrimaryRoleKey =
  | 'system_admin'
  | 'operations_officer'
  | 'operations_manager'
  | 'accounting_officer'
  | 'accounting_manager'
  | 'client_user'
  | 'employee_self';

/** Canonical keys for tests and future UI. */
export const CORE_PRIMARY_ROLE_KEYS = [
  'system_admin',
  'operations_officer',
  'operations_manager',
  'accounting_officer',
  'accounting_manager',
  'client_user',
  'employee_self',
] as const satisfies readonly CorePrimaryRoleKey[];

export const ALL_ACCESS_DOMAINS: readonly AccessDomain[] = [
  'sales',
  'operations',
  'hr',
  'store',
  'accounting',
  'system',
  'client',
];

/**
 * Base domain coverage per access group (before legacy union).
 * - admin: all domains
 * - operations: sales / operations / hr / store (inventory & procurement live in ops pillar)
 * - accounting: sales / hr / store / accounting
 * - client: client only
 */
export const DOMAINS_BY_ACCESS_GROUP: Record<AccessGroup, readonly AccessDomain[]> = {
  admin: ALL_ACCESS_DOMAINS,
  operations: ['sales', 'operations', 'hr', 'store'],
  accounting: ['sales', 'hr', 'store', 'accounting'],
  client: ['client'],
};

const LEVEL_RANK: Record<CoreAccessLevel, number> = {
  viewer: 0,
  officer: 1,
  manager: 2,
  admin: 3,
};

// ---------------------------------------------------------------------------
// Business role → core metadata
// ---------------------------------------------------------------------------

const PRIMARY_ASSIGNED_ROLE_KEYS = new Set<string>([
  'system_admin',
  'hr_manager',
  'hr_officer',
  'payroll_officer',
  'sales_officer',
  'sales_manager',
  'store_officer',
  'operations_manager',
  'operations_officer',
  'accounting_officer',
  'accounting_manager',
  'client_user',
  'employee_self',
]);

function normalizeAssignedPrimaryRole(roleKey?: string | null): string | null {
  const raw = normalizeBusinessRoleKey(roleKey);
  if (!raw) return null;
  /** permission_profiles admin row id; business role on user is system_admin. */
  if (raw === 'admin_admin') return 'system_admin';
  return PRIMARY_ASSIGNED_ROLE_KEYS.has(raw) ? raw : null;
}

/** Maps BusinessRoleKey to core primary key + group + level. */
export const BUSINESS_ROLE_TO_CORE: Record<
  BusinessRoleKey,
  { group: AccessGroup; level: CoreAccessLevel; primaryKey: CorePrimaryRoleKey | string }
> = {
  system_admin: { group: 'admin', level: 'admin', primaryKey: 'system_admin' },
  hr_manager: { group: 'operations', level: 'manager', primaryKey: 'operations_manager' },
  hr_officer: { group: 'operations', level: 'officer', primaryKey: 'operations_officer' },
  payroll_officer: { group: 'operations', level: 'officer', primaryKey: 'operations_officer' },
  sales_manager: { group: 'operations', level: 'manager', primaryKey: 'operations_manager' },
  sales_officer: { group: 'operations', level: 'officer', primaryKey: 'operations_officer' },
  accounting_manager: { group: 'accounting', level: 'manager', primaryKey: 'accounting_manager' },
  accounting_officer: { group: 'accounting', level: 'officer', primaryKey: 'accounting_officer' },
  store_officer: { group: 'operations', level: 'officer', primaryKey: 'operations_officer' },
  operations_officer: { group: 'operations', level: 'officer', primaryKey: 'operations_officer' },
  operations_manager: { group: 'operations', level: 'manager', primaryKey: 'operations_manager' },
  client_user: { group: 'client', level: 'viewer', primaryKey: 'client_user' },
  employee_self: { group: 'operations', level: 'viewer', primaryKey: 'employee_self' },
};

/** @deprecated use BUSINESS_ROLE_TO_CORE */
export const LEGACY_BUSINESS_ROLE_TO_CORE = BUSINESS_ROLE_TO_CORE;

/** Extra domains implied by DeptType (union with group defaults). */
function domainsFromLegacyDepartment(dept: DeptType | undefined): Set<AccessDomain> {
  const s = new Set<AccessDomain>();
  if (!dept) return s;
  switch (dept) {
    case 'admin':
      ALL_ACCESS_DOMAINS.forEach((d) => s.add(d));
      break;
    case 'sales':
      s.add('sales');
      break;
    case 'operations':
      s.add('operations');
      break;
    case 'hr':
      s.add('hr');
      break;
    case 'accounting':
      s.add('accounting');
      break;
    case 'store':
      s.add('store');
      break;
    case 'client':
      s.add('client');
      break;
    default:
      break;
  }
  return s;
}

/** Stored accessGroup on user doc; legacy `operation` (singular) maps to `operations`. */
function coerceStoredAccessGroup(raw: unknown): AccessGroup | null {
  if (raw === 'operations' || raw === 'operation') return 'operations';
  if (raw === 'admin' || raw === 'accounting' || raw === 'client') return raw;
  return null;
}

function isFutureAccessGroup(value: unknown): boolean {
  return coerceStoredAccessGroup(value) != null;
}

function isFutureAccessLevel(value: unknown): value is CoreAccessLevel {
  return value === 'admin' || value === 'manager' || value === 'officer' || value === 'viewer';
}

/**
 * Primary business role: assignedRoleKey / assignedRoleKeys[0] before legacy `role` scalar,
 * then permission profile ids. (Legacy `role` last — avoids stale scalar overwriting canonical keys.)
 */
export function getPrimaryLegacyRole(user: Partial<User> | null): string | null {
  if (!user) return null;

  const profileKeyCandidate =
    (typeof user.permissionProfileKey === 'string' && user.permissionProfileKey.trim() !== ''
      ? user.permissionProfileKey.trim()
      : null) ??
    (Array.isArray(user.permissionProfileKeys) &&
    typeof user.permissionProfileKeys[0] === 'string' &&
    user.permissionProfileKeys[0].trim() !== ''
      ? user.permissionProfileKeys[0].trim()
      : null);
  const normalizedProfile = normalizePermissionProfileDocumentId(profileKeyCandidate);

  const fromAssigned =
    typeof user.assignedRoleKey === 'string' && user.assignedRoleKey.trim() !== ''
      ? user.assignedRoleKey
      : null;
  const fromScalar = normalizeAssignedPrimaryRole(fromAssigned);
  /** Payroll on user doc wins over profile-derived hints. */
  if (fromScalar === 'payroll_officer') return 'payroll_officer';
  if (fromScalar) return fromScalar;

  const fromAssignedKeys0 =
    Array.isArray(user.assignedRoleKeys) &&
    typeof user.assignedRoleKeys[0] === 'string' &&
    user.assignedRoleKeys[0].trim() !== ''
      ? user.assignedRoleKeys[0].trim()
      : null;
  const fromKeysNorm = normalizeAssignedPrimaryRole(fromAssignedKeys0);
  if (fromKeysNorm === 'payroll_officer') return 'payroll_officer';
  if (fromKeysNorm) return fromKeysNorm;

  /**
   * โปรไฟล์ payroll_officer ชัดเจน — ใช้ก่อน scalar `role` เดิมบน user doc
   * (แก้กรณีค้าง hr_officer ใน role ทำให้ถูกบล็อก office_payroll / office_staff โดย HR officer block)
   */
  if (normalizedProfile === 'payroll_officer') return 'payroll_officer';

  const fromRoleField =
    typeof user.role === 'string' && user.role.trim() !== '' ? user.role.trim() : null;
  if (fromRoleField) {
    const normalizedField = normalizeAssignedPrimaryRole(fromRoleField);
    if (normalizedField) return normalizedField;
  }

  return normalizeAssignedPrimaryRole(profileKeyCandidate);
}

/** True when the resolved primary business role is HR Officer (narrow UI: no sales / payroll run modules). */
export function isPrimaryHrOfficer(user: Partial<User> | null | undefined): boolean {
  return getPrimaryLegacyRole(user ?? null) === 'hr_officer';
}

/** Effective access group: explicit User.accessGroup wins, else legacy-derived. */
export function getEffectiveAccessGroup(user: User | null): AccessGroup | null {
  if (!user) return null;
  const dep = String(user.department || '');

  const fromStored = coerceStoredAccessGroup(user.accessGroup);
  if (fromStored) {
    return fromStored;
  }
  const fromDeptGroup = coerceStoredAccessGroup(user.departmentGroup);
  if (fromDeptGroup) {
    return fromDeptGroup;
  }

  const legacyRole = getPrimaryLegacyRole(user);

  if (legacyRole === 'system_admin') return 'admin';
  if (legacyRole === 'client_user') return 'client';

  if (legacyRole === 'accounting_manager' || legacyRole === 'accounting_officer') {
    return 'accounting';
  }

  if (
    legacyRole === 'hr_manager' ||
    legacyRole === 'hr_officer' ||
    legacyRole === 'payroll_officer' ||
    legacyRole === 'sales_manager' ||
    legacyRole === 'sales_officer' ||
    legacyRole === 'operations_officer' ||
    legacyRole === 'operations_manager' ||
    legacyRole === 'store_officer'
  ) {
    return 'operations';
  }

  if (user.userType === 'customer_portal') return 'client';
  if (user.department === 'admin') return 'admin';
  if (user.department === 'accounting') return 'accounting';
  if (user.department === 'client') return 'client';
  if (dep === 'hr' || dep === 'sales' || dep === 'operations' || dep === 'operation' || dep === 'store') {
    return 'operations';
  }

  return null;
}

/** Effective access level: explicit User.accessLevel wins, else legacy-derived. */
export function getEffectiveAccessLevel(user: User | null): CoreAccessLevel {
  if (!user) return 'viewer';

  if (isFutureAccessLevel(user.accessLevel)) {
    return user.accessLevel;
  }

  const group = getEffectiveAccessGroup(user);
  if (group === 'admin') return 'admin';
  if (group === 'client') return user.portalRole === 'approver' ? 'manager' : 'viewer';

  const legacyRole = getPrimaryLegacyRole(user);
  if (
    legacyRole === 'hr_manager' ||
    legacyRole === 'sales_manager' ||
    legacyRole === 'operations_manager' ||
    legacyRole === 'accounting_manager'
  ) {
    return 'manager';
  }

  if (
    legacyRole === 'hr_officer' ||
    legacyRole === 'payroll_officer' ||
    legacyRole === 'sales_officer' ||
    legacyRole === 'operations_officer' ||
    legacyRole === 'accounting_officer' ||
    legacyRole === 'store_officer' ||
    legacyRole === 'finance_officer'
  ) {
    return 'officer';
  }

  if (user.level) return user.level as CoreAccessLevel;
  return 'officer';
}

/** Map a business role key to core metadata when possible. */
export function mapBusinessRoleToCore(roleKey: string): {
  group: AccessGroup;
  level: CoreAccessLevel;
  primaryKey: CorePrimaryRoleKey | string;
} | null {
  const canonical = normalizeBusinessRoleKey(roleKey) ?? roleKey.trim().toLowerCase();
  const mapped = BUSINESS_ROLE_TO_CORE[canonical as BusinessRoleKey];
  return mapped ?? null;
}

/** @deprecated use mapBusinessRoleToCore */
export function mapLegacyBusinessRoleToCore(roleKey: string) {
  return mapBusinessRoleToCore(roleKey);
}

export interface UserAccessContext {
  accessGroup: AccessGroup | null;
  accessLevel: CoreAccessLevel;
  /** Canonical core key when mappable, else resolved string. */
  primaryRoleKey: CorePrimaryRoleKey | string | null;
  /** Same as getPrimaryLegacyRole(user) — primary business role resolved from user doc. */
  resolvedBusinessRole: string | null;
  /** True when accessGroup/accessLevel were set on the user document. */
  explicitAccess: boolean;
  /** Domains the user may access (group defaults ∪ department hints). */
  domains: ReadonlySet<AccessDomain>;
}

function unionDomains(base: readonly AccessDomain[], extra: Set<AccessDomain>): Set<AccessDomain> {
  const out = new Set<AccessDomain>(base);
  extra.forEach((d) => out.add(d));
  return out;
}

/** Full resolved context for new + legacy users. */
export function getUserAccessContext(user: User | null): UserAccessContext | null {
  if (!user) return null;

  const explicitAccess =
    coerceStoredAccessGroup(user.accessGroup) != null && isFutureAccessLevel(user.accessLevel);

  const accessGroup = getEffectiveAccessGroup(user);
  const accessLevel = getEffectiveAccessLevel(user);
  const resolvedBusinessRole = getPrimaryLegacyRole(user);

  let primaryRoleKey: CorePrimaryRoleKey | string | null = null;
  if (resolvedBusinessRole) {
    const mapped = mapBusinessRoleToCore(resolvedBusinessRole);
    primaryRoleKey = mapped?.primaryKey ?? resolvedBusinessRole;
  }

  if (accessGroup === 'admin') {
    primaryRoleKey = primaryRoleKey ?? 'system_admin';
  }

  const baseDomains = accessGroup ? [...DOMAINS_BY_ACCESS_GROUP[accessGroup]] : [];
  const legacyExtra = domainsFromLegacyDepartment(user.department);
  const domains = unionDomains(baseDomains, legacyExtra);

  return {
    accessGroup,
    accessLevel,
    primaryRoleKey,
    resolvedBusinessRole,
    explicitAccess: Boolean(explicitAccess),
    domains,
  };
}

/** True if profile keys point at the system admin matrix row (system_admin or legacy admin_admin). */
function userReferencesAdminPermissionProfile(user: User): boolean {
  const keys = [
    user.permissionProfileKey,
    ...(Array.isArray(user.permissionProfileKeys) ? user.permissionProfileKeys : []),
  ];
  for (const k of keys) {
    if (typeof k !== 'string' || !k.trim()) continue;
    const id = normalizePermissionProfileDocumentId(k);
    if (id === 'admin_admin' || id === 'system_admin') return true;
  }
  return false;
}

/**
 * Full system administrator (single app gate; keep in sync with firestore.rules isAdminUser()).
 * Business role is always {@link BusinessRoleKey} `system_admin`. Profile doc id should be `system_admin`;
 * `admin_admin` is legacy only (still honored for existing user docs).
 */
export function isSystemAdmin(user: User | null): boolean {
  if (!user) return false;
  if (typeof user.role === 'string' && normalizeBusinessRoleKey(user.role) === 'system_admin') return true;
  if (getPrimaryLegacyRole(user) === 'system_admin') return true;
  if (user.accessGroup === 'admin') return true;
  if (user.departmentGroup === 'admin') return true;
  if (user.department === 'admin') return true;
  return userReferencesAdminPermissionProfile(user);
}

/**
 * True if user is HR Manager (labour cost / payroll baseline on contracts).
 * Excludes hr_officer — cost baseline entry is manager + admin only in UI policy.
 */
export function isHrManager(user: User | null): boolean {
  if (!user) return false;
  return getPrimaryLegacyRole(user) === 'hr_manager';
}

/** ลบ Wave ใน UI (รายการ/ยืนยัน) — แอดมิน / ผู้จัดการปฏิบัติการ / ผู้จัดการ HR (ไม่รวม hr_officer) */
export function canManageWaveRecords(user: User | null): boolean {
  if (!user) return false;
  return (
    isSystemAdmin(user) ||
    isSimpleAdmin(user) ||
    isOperationManager(user) ||
    isHrManager(user)
  );
}

export function isOperationManager(user: User | null): boolean {
  if (!user) return false;
  return getPrimaryLegacyRole(user) === 'operations_manager';
}

export function isStoreOfficer(user: User | null): boolean {
  if (!user) return false;
  return getPrimaryLegacyRole(user) === 'store_officer';
}

/**
 * หัวหน้าแนวร่วมปฏิบัติการ (ขาย / ปฏิบัติการ / HR / คลัง / payroll ในแอป):
 * สิทธิ์เชิงธุรกิจใกล้เคียง system_admin แต่ไม่รวมเมนูระบบ (users, numbering, …) และโมดูลบัญชี — กำหนดที่ getPermissions / เส้นทาง
 */
export function isOperationsPillarExecutive(user: User | null): boolean {
  if (!user) return false;
  if (!isActiveForApp(user) || !isInternalTypeUser(user)) return false;
  if (isSystemAdmin(user)) return false;
  const rk = getPrimaryLegacyRole(user);
  if (rk === 'operations_manager' || rk === 'hr_manager' || rk === 'sales_manager') return true;
  return getEffectiveAccessGroup(user) === 'operations' && getEffectiveAccessLevel(user) === 'manager';
}

/**
 * แก้ “ฝั่งต้นทุน/OT ต่อตำแหน่ง” บน position_rates ของสัญญา (ไม่รวมราคาขาย) — ตามนโยบาย: Admin, HR Manager, Operations Manager
 * ค่าแรงฐาน OPEC กำหนดที่ /positions; ชื่อฟังก์ชันสะท้อน legacy ก่อนเฟส 5
 * รองรับผู้ใช้ที่แสดงเป็น manager ในกลุ่ม operations แต่เอกสารยังไม่มี assignedRoleKey = operations_manager
 * (ไม่ให้ทีมขายแก้ฝั่งต้นทุน)
 */
export function canEditMasterContractCostBaseline(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return true;
  if (isHrManager(user)) return true;
  if (isOperationManager(user)) return true;
  const rk = getPrimaryLegacyRole(user);
  if (rk === 'sales_manager' || rk === 'sales_officer') return false;
  const g = getEffectiveAccessGroup(user);
  const lvl = getEffectiveAccessLevel(user);
  return g === 'operations' && lvl === 'manager';
}

/** Combined operations pillar officer: full pillar menus in app matrix; no delete / no approve vs manager. */
export function isOperationsOfficer(user: User | null): boolean {
  if (!user) return false;
  return getPrimaryLegacyRole(user) === 'operations_officer';
}

export function isPayrollOfficer(user: User | null): boolean {
  if (!user) return false;
  return getPrimaryLegacyRole(user) === 'payroll_officer';
}

/** อนุมัติงวด office หลังฝ่ายเงินเดือนส่ง (HR_REVIEW) — ผู้จัดการปฏิบัติการ / HR manager + แอดมิน */
export function canApproveOfficePayrollAsManager(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return true;
  return isHrManager(user) || isOperationManager(user);
}

/**
 * บันทึก "ลูกค้าอนุมัติ billing" บน draft tax invoice (แยกจาก payroll) —
 * ผู้จัดการปฏิบัติการ/HR/ขาย, บัญชี, แอดมิน; ไม่รวม payroll_officer เป็นค่าเริ่มต้น
 */
export function canRecordTaxInvoiceBillingCustomerApproval(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return true;
  if (isSimpleAccounting(user)) return true;
  if (isOperationManager(user)) return true;
  if (isOperationsPillarExecutive(user)) return true;
  return false;
}

/** แก้ฐานเงินเดือน/ค่าจ้างใน master (เช่น office_staff.monthlySalary) — HR/OPS manager + payroll officer */
export function canEditEmployeeCompensation(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  const r = getPrimaryLegacyRole(user);
  return r === 'hr_manager' || r === 'operations_manager' || r === 'payroll_officer';
}

/**
 * Aligns with {@code canViewPayroll()} in firestore.rules (read on payroll_batches/…/lines,
 * office_payroll_runs/…/lines, collectionGroup "lines", etc.). Stricter than {@link ModuleKey}
 * {@code worker_payroll.view} — e.g. sales_manager may have matrix view but rules deny list.
 */
export function canViewPayrollPerFirestoreRules(user: User | null): boolean {
  if (!user) return false;
  if (!user.isActive) return false;
  const st = user.approvalStatus;
  if (st && st !== 'ACTIVE' && st !== 'APPROVED') return false;
  if (user.userType === 'customer_portal') return false;
  if (getEffectiveAccessGroup(user) === 'client') return false;
  return true;
}

export function canActAsHrManager(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  const role = getPrimaryLegacyRole(user);
  return (
    role === 'hr_manager' ||
    role === 'operations_manager' ||
    role === 'hr_officer' ||
    role === 'payroll_officer'
  );
}

/** แก้ไขตั้งค่าภาษี/ประกันสังคมในหน้า HR settings (เขียน payroll_policies) */
export function canEditHrStatutoryPayrollSettings(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  if (canManageSystem(user)) return true;
  const role = getPrimaryLegacyRole(user);
  return (
    role === 'hr_manager' ||
    role === 'hr_officer' ||
    role === 'payroll_officer' ||
    role === 'operations_manager'
  );
}

/**
 * Whether the user belongs to the given access group (same as "department group" in the new model).
 */
export function isDepartmentGroup(user: User | null, group: AccessGroup): boolean {
  return getEffectiveAccessGroup(user) === group;
}

/** Compare effective level to a minimum (inclusive). */
export function hasMinimumLevel(user: User | null, minLevel: CoreAccessLevel): boolean {
  const lv = getEffectiveAccessLevel(user);
  return LEVEL_RANK[lv] >= LEVEL_RANK[minLevel];
}

/** Domain access: uses resolved domain set (group ∪ legacy department). */
export function canAccessDomain(user: User | null, domain: AccessDomain): boolean {
  const ctx = getUserAccessContext(user);
  if (!ctx) return false;
  return ctx.domains.has(domain);
}

/** System management (users, security, numbering, audit): admin group + admin level or legacy system admin. */
export function canManageSystem(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  const g = getEffectiveAccessGroup(user);
  const l = getEffectiveAccessLevel(user);
  return g === 'admin' && l === 'admin';
}

/** Admin or accounting access group (finance / store / HR minus timesheet routing). */
export function isAccountingGroupMember(user: User | null): boolean {
  return isSystemAdmin(user) || isDepartmentGroup(user, 'accounting');
}

/** Admin or operation access group (sales / ops scheduling / HR timesheets / waves). */
export function isOperationGroupMember(user: User | null): boolean {
  return isSystemAdmin(user) || isDepartmentGroup(user, 'operations');
}

/** Timesheets + waves + assignments + mobilization: admin or operation only (not accounting-only). */
export function canAccessOpsSchedulingModules(user: User | null): boolean {
  return isOperationGroupMember(user);
}

/** Finance & accounting module gate: admin or accounting (not operation-only). */
export function canAccessAccountingFinanceModules(user: User | null): boolean {
  return isAccountingGroupMember(user);
}
