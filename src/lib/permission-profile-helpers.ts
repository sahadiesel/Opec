/**
 * Permission profile helpers: departmentGroup (new) ↔ legacy department, user↔profile assignment rules.
 */

import type {
  PermissionProfile,
  User,
  DeptType,
  AccessLevel,
  DepartmentGroup,
  BusinessRoleKey,
} from './types';
import { getEffectiveAccessGroup } from './permission-core';

export type { DepartmentGroup };

export function legacyDeptToDepartmentGroup(d: DeptType | undefined): DepartmentGroup {
  if (!d) return 'operation';
  if (d === 'admin') return 'admin';
  if (d === 'client') return 'client';
  if (d === 'accounting') return 'accounting';
  /** คลัง/จัดซื้ออยู่ภายใต้ partition operation (สอดคล้อง user accessGroup + เมนูจัดการผู้ใช้) */
  if (d === 'store') return 'operation';
  return 'operation';
}

/** Resolved group for a profile (new field wins, else infer from legacy department). */
export function getProfileDepartmentGroup(profile: PermissionProfile): DepartmentGroup {
  if (profile.department === 'store' && profile.departmentGroup === 'accounting') {
    return 'operation';
  }
  if (profile.departmentGroup) return profile.departmentGroup;
  return legacyDeptToDepartmentGroup(profile.department);
}

/**
 * Best-effort legacy `department` for Firestore consumers still reading it.
 */
export function deriveLegacyDepartmentForGroup(
  group: DepartmentGroup,
  level: AccessLevel
): DeptType {
  switch (group) {
    case 'admin':
      return 'admin';
    case 'client':
      return 'client';
    case 'accounting':
      return 'accounting';
    case 'operation':
      if (level === 'admin') return 'operations';
      return 'hr';
    default:
      return 'hr';
  }
}

/** Allowed levels per group (admin rank only for admin group). */
export const ACCESS_LEVELS_BY_DEPARTMENT_GROUP: Record<DepartmentGroup, readonly AccessLevel[]> = {
  admin: ['viewer', 'officer', 'manager', 'admin'],
  operation: ['viewer', 'officer', 'manager', 'admin'],
  accounting: ['viewer', 'officer', 'manager', 'admin'],
  client: ['viewer', 'officer', 'manager'],
};

export function isAccessLevelAllowedForGroup(
  group: DepartmentGroup,
  level: AccessLevel
): boolean {
  return ACCESS_LEVELS_BY_DEPARTMENT_GROUP[group].includes(level);
}

/** Target user may only be assigned profiles in the same access group. */
export function profileAllowedForTargetUser(
  profile: PermissionProfile,
  targetUser: User
): boolean {
  const uGroup = getEffectiveAccessGroup(targetUser);
  const pGroup = getProfileDepartmentGroup(profile);
  if (!uGroup || !pGroup) return false;
  return uGroup === pGroup;
}

/** Cross-group assignment attempt (e.g. accounting user + operation profile). */
export function validateProfileAssignment(
  profile: PermissionProfile,
  targetUser: User
): { ok: true } | { ok: false; message: string } {
  if (!profileAllowedForTargetUser(profile, targetUser)) {
    return {
      ok: false,
      message: `โปรไฟล์นี้อยู่ในกลุ่ม ${getProfileDepartmentGroup(profile)} แต่ผู้ใช้อยู่ในกลุ่ม ${getEffectiveAccessGroup(targetUser)} — ห้ามผูกข้ามกลุ่ม`,
    };
  }
  return { ok: true };
}

/** Build user document fields from a chosen permission profile (with legacy compatibility). */
export function getUserFieldsFromPermissionProfile(
  profile: PermissionProfile
): Partial<User> {
  const group = getProfileDepartmentGroup(profile);
  const legacyDept = profile.department ?? deriveLegacyDepartmentForGroup(group, profile.level);
  return {
    permissionProfileKey: profile.profileKey,
    permissionProfileKeys: [profile.profileKey],
    accessGroup: group,
    departmentGroup: group,
    accessLevel: profile.level,
    department: legacyDept,
    level: profile.level,
    updatedAt: Date.now(),
  };
}

export type ProfileAuditIssue =
  | 'no_profile_key'
  | 'profile_not_found'
  | 'group_mismatch'
  | 'inactive_profile'
  | 'legacy_only'
  | 'role_profile_mismatch'
  | 'role_field_conflict';

/** Mirrors mapBusinessRoleToAccessGroup in auth-mapping (avoid circular import). */
export function accessGroupFromAssignedRoleKey(key: string | undefined): DepartmentGroup | null {
  if (!key) return null;
  if (key === 'system_admin') return 'admin';
  if (key === 'client_user') return 'client';
  if (key === 'accounting_manager' || key === 'accounting_officer') {
    return 'accounting';
  }
  if (key === 'store_manager' || key === 'store_officer') {
    return 'operation';
  }
  return 'operation';
}

/**
 * Map a permission profile to the closest transitional BusinessRoleKey (for user doc sync).
 */
export function deriveBusinessRoleKeyFromPermissionProfile(profile: PermissionProfile): BusinessRoleKey {
  const pk = (profile.primaryRoleTemplateKey || profile.profileKey) as string;
  const direct = [
    'system_admin',
    'hr_manager',
    'hr_officer',
    'payroll_officer',
    'operation_manager',
    'operation_officer',
    'accounting_manager',
    'accounting_officer',
    'sales_manager',
    'sales_officer',
    'store_manager',
    'store_officer',
    'client_user',
  ];
  if (direct.includes(pk)) return pk as BusinessRoleKey;
  if (pk === 'admin_admin') return 'system_admin';

  const g = getProfileDepartmentGroup(profile);
  const level = profile.level;
  if (g === 'admin') return 'system_admin';
  if (g === 'client') return 'client_user';
  if (g === 'accounting') {
    return level === 'manager' || level === 'admin' ? 'accounting_manager' : 'accounting_officer';
  }
  const legacy = profile.department;
  if (legacy === 'sales') return level === 'manager' ? 'sales_manager' : 'sales_officer';
  if (legacy === 'hr') return level === 'manager' ? 'hr_manager' : 'hr_officer';
  if (legacy === 'operations') return level === 'manager' ? 'operation_manager' : 'operation_officer';
  if (legacy === 'store') return level === 'manager' ? 'store_manager' : 'store_officer';
  return level === 'manager' || level === 'admin' ? 'operation_manager' : 'operation_officer';
}

export function analyzeUserProfileBinding(
  user: User,
  profileByKey: Map<string, PermissionProfile>
): { issues: ProfileAuditIssue[]; summary: string } {
  const issues: ProfileAuditIssue[] = [];
  const key = user.permissionProfileKey ?? user.permissionProfileKeys?.[0];
  if (!key) {
    issues.push('no_profile_key');
    return { issues, summary: 'ไม่มี profile key' };
  }
  const profile = profileByKey.get(key);
  if (!profile) {
    issues.push('profile_not_found');
    return { issues, summary: 'ไม่พบเอกสาร profile' };
  }
  if (!profile.isActive) {
    issues.push('inactive_profile');
  }
  const ug = getEffectiveAccessGroup(user);
  const pg = getProfileDepartmentGroup(profile);
  if (ug && pg && ug !== pg) {
    issues.push('group_mismatch');
  }
  const roleG = accessGroupFromAssignedRoleKey(user.assignedRoleKey ?? user.roleId ?? undefined);
  if (roleG && ug && roleG !== ug) {
    issues.push('role_field_conflict');
  }
  if (roleG && pg && roleG !== pg) {
    issues.push('role_field_conflict');
  }
  if ((user.assignedRoleKey ?? user.roleId) === 'payroll_officer' && key === 'hr_officer') {
    issues.push('role_profile_mismatch');
  }
  if (!user.accessGroup && !user.department) {
    issues.push('legacy_only');
  }
  let summary = 'ปกติ';
  if (issues.includes('role_profile_mismatch')) summary = 'Payroll role ผูกกับ HR profile (legacy mismatch)';
  else if (issues.includes('role_field_conflict')) summary = 'ฟิลด์ role / accessGroup ขัดกัน';
  else if (issues.includes('group_mismatch')) summary = 'accessGroup ไม่ตรงกับโปรไฟล์';
  else if (issues.includes('profile_not_found')) summary = 'โปรไฟล์หาย';
  else if (issues.includes('inactive_profile')) summary = 'โปรไฟล์ปิดใช้งาน';
  else if (issues.includes('no_profile_key')) summary = 'ยังไม่ผูกโปรไฟล์';
  else if (issues.includes('legacy_only')) summary = 'ยังเป็น legacy field อย่างเดียว';
  return { issues, summary };
}
