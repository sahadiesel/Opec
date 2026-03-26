/**
 * @fileOverview OPEC OpsFlow - Permission Module Mapping
 *
 * Maps Firestore collections/domains to UI Module Keys defined in SYSTEM_MODULES.
 * Does not import from permissions.ts — avoids circular dependency (permissions imports this file).
 */

/**
 * Registry of Domain-to-Module aliases.
 */
export const DOMAIN_TO_MODULE_MAP: Record<string, string> = {
  'purchase_orders': 'customer_pos',
  'daily_timesheets': 'timesheets',
  'payroll_batches': 'worker_payroll',
  'payroll_runs': 'worker_payroll',
  'office_payroll_runs': 'office_payroll',
  'executive_payroll_runs': 'executive_payroll',
  'mobilizations': 'mobilization',
  'store_items': 'store_inventory',
  'store_transactions': 'store_inventory',
  'store_receipts': 'store_inventory',
  'store_issue_slips': 'store_inventory',
  'store_return_slips': 'store_inventory',
  'store_writeoffs': 'store_inventory',
  'cashbook_entries': 'cashbook',
  'number_sequences': 'document_numbering',
};

export function resolvePermissionModuleKey(key: string): string {
  const mapped = DOMAIN_TO_MODULE_MAP[key];
  return mapped || key;
}
