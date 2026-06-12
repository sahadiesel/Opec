/**
 * Canonical role and permission profile keys: trim + lowercase only.
 * Stored user docs and profile doc ids are expected to be lowercase snake_case.
 */

/** Legacy typo on some user docs / permission_profiles rows (singular operation). */
const BUSINESS_ROLE_KEY_ALIASES: Record<string, string> = {
  operation_manager: 'operations_manager',
  /** Legacy typos on user docs / permission_profiles rows */
  excutive: 'executive',
  execusive: 'executive',
};

export function normalizeBusinessRoleKey(roleKey?: string | null): string | null {
  if (!roleKey) return null;
  const trimmed = roleKey.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  return BUSINESS_ROLE_KEY_ALIASES[trimmed] ?? trimmed;
}

/** True if normalized assignedRoleKey equals one of the canonical candidates (lowercase). */
export function userMatchesBusinessRoleKey(
  assignedRoleKey: string | null | undefined,
  ...candidates: string[]
): boolean {
  const a = normalizeBusinessRoleKey(assignedRoleKey ?? undefined);
  if (a == null) return false;
  const want = new Set(candidates.map((c) => c.trim().toLowerCase()));
  return want.has(a);
}

/**
 * Firestore document IDs under permission_profiles for seeded / built-in rows
 * (lowercase snake_case). Custom profile IDs are not listed here.
 */
export const BUILTIN_PERMISSION_PROFILE_DOC_IDS = new Set([
  'system_admin',
  'admin_admin',
  'client_user',
  'employee_self',
  'sales_manager',
  'sales_officer',
  'hr_manager',
  'hr_officer',
  'payroll_officer',
  'operations_manager',
  'operation_manager',
  'operations_officer',
  'timekeeper',
  'accounting_manager',
  'accounting_officer',
  'store_officer',
  'executive',
]);

/**
 * Normalize a permission profile document id: lowercase; known built-ins must match the set above.
 */
export function normalizePermissionProfileDocumentId(key: string | null | undefined): string | null {
  if (!key || !String(key).trim()) return null;
  const lower = String(key).trim().toLowerCase();
  if (BUILTIN_PERMISSION_PROFILE_DOC_IDS.has(lower)) return lower;
  return lower;
}
