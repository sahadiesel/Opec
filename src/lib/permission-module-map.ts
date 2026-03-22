/**
 * @fileOverview OPEC OpsFlow - Permission Module Mapping
 * 
 * Maps Firestore collections/domains to UI Module Keys defined in SYSTEM_MODULES.
 * This ensures that a check for a collection (e.g. 'purchase_orders') correctly 
 * resolves to the permission set for the UI module (e.g. 'customer_pos').
 */

import { ModuleKey } from './permissions';

/**
 * Registry of Domain-to-Module aliases.
 * Key: Firestore Collection or Domain Name
 * Value: UI Module Key (from SYSTEM_MODULES)
 */
export const DOMAIN_TO_MODULE_MAP: Record<string, string> = {
  // Commercial & Sales
  'purchase_orders': 'customer_pos',
  
  // HR & Payroll
  'daily_timesheets': 'timesheets',
  'payroll_batches': 'worker_payroll',
  'payroll_runs': 'worker_payroll',
  'office_payroll_runs': 'office_payroll',
  
  // Operations
  'mobilizations': 'mobilization',
  
  // Store & Inventory
  // Multiple technical collections map to one logical "Store" module in UI
  'store_items': 'store_inventory',
  'store_transactions': 'store_inventory',
  'store_receipts': 'store_inventory',
  'store_issue_slips': 'store_inventory',
  'store_return_slips': 'store_inventory',
  'store_writeoffs': 'store_inventory',
  
  // Finance & Accounting
  'cashbook_entries': 'cashbook',
  
  // Infrastructure
  'number_sequences': 'document_numbering',
};

/**
 * Resolves a raw key (collection name or alias) into a canonical UI ModuleKey.
 * If no mapping exists, it returns the original key assuming it's already a ModuleKey.
 * 
 * @param key The string to resolve (e.g. 'purchase_orders')
 * @returns A valid ModuleKey for permission lookup
 */
export function resolvePermissionModuleKey(key: string): ModuleKey {
  const mapped = DOMAIN_TO_MODULE_MAP[key];
  return (mapped || key) as ModuleKey;
}
