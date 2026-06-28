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
  'commercial_invoices': 'draft_invoices',
  'purchase_orders': 'customer_pos',
  /** Firestore collection name ↔ UI module key worker_documents (permissions.ts / SYSTEM_MODULES) */
  'worker_document_catalog': 'worker_documents',
  'daily_timesheets': 'timesheets',
  'payroll_batches': 'worker_payroll',
  /** payroll_runs เป็น module key ของ UI — resolve ที่ getPermissions เท่านั้น (ไม่ alias) */
  'office_payroll_runs': 'office_payroll',
  'payroll_policies': 'hr_hub',
  'payroll_correction_requests': 'hr_hub',
  'timesheet_retro_adjustments': 'timesheets',
  'executive_payroll_runs': 'executive_payroll',
  'mobilizations': 'mobilization',
  'store_items': 'store_inventory',
  'store_transactions': 'store_inventory',
  'store_receipts': 'store_inventory',
  'store_issue_slips': 'store_inventory',
  'store_return_slips': 'store_inventory',
  'store_writeoffs': 'store_inventory',
  'cashbook_entries': 'cashbook',
  'withholding_at_source_items': 'withholding_tax_items',
  'number_sequences': 'document_numbering',
};

export function resolvePermissionModuleKey(key: string): string {
  const mapped = DOMAIN_TO_MODULE_MAP[key];
  return mapped || key;
}
