/**
 * Centralized role-key normalization for legacy compatibility.
 * Keep all temporary backward-compatibility mappings in this single helper.
 */
export const LEGACY_ROLE_KEY_ALIASES: Record<string, string> = {
  finance_officer: 'accounting_officer',
  safety_officer: 'operation_officer',
  operations_manager: 'operation_manager',
  operations_officer: 'operation_officer',
  client: 'client_user',
  client_viewer: 'client_user',
  client_approver: 'client_user',
  customer_viewer: 'client_user',
  customer_approver: 'client_user',
  super_admin: 'system_admin',
  admin: 'system_admin',
};

export function normalizeBusinessRoleKey(roleKey?: string | null): string | null {
  if (!roleKey) return null;
  return LEGACY_ROLE_KEY_ALIASES[roleKey] || roleKey;
}
