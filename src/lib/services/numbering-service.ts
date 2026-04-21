'use client';

/**
 * @fileOverview Centralized document numbering service with validation safeguards and audit logging.
 * Ensures sequential, unique numbers using Firestore transactions and existence checks.
 */

import { Firestore, doc, runTransaction, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { DeptType, NumberSequence } from '../types';

export interface SequenceConfig {
  prefix: string;
  padding: number;
  dept: DeptType;
  resetPolicy: 'none' | 'yearly' | 'monthly';
  label: string;
  collectionName: string; // Target collection for uniqueness safeguard
  fieldName: string;      // Target field for uniqueness safeguard
}

/**
 * Registry of standard sequence configurations for the platform.
 * Includes metadata for automated uniqueness validation.
 */
export const SEQUENCE_REGISTRY: Record<string, SequenceConfig> = {
  main_contract: { label: 'Main Contract', prefix: 'MC-', padding: 5, dept: 'sales', resetPolicy: 'yearly', collectionName: 'main_contracts', fieldName: 'contractNumber' },
  customer: { label: 'Customer', prefix: 'CUS-', padding: 5, dept: 'sales', resetPolicy: 'none', collectionName: 'customers', fieldName: 'customerCode' },
  customer_po: { label: 'Customer PO', prefix: 'PO-', padding: 5, dept: 'sales', resetPolicy: 'yearly', collectionName: 'purchase_orders', fieldName: 'poCode' },
  quotation: { label: 'Quotation', prefix: 'QT-', padding: 5, dept: 'sales', resetPolicy: 'monthly', collectionName: 'quotations', fieldName: 'quotationNo' },
  sales_term: { label: 'Sales Term', prefix: 'SLT-', padding: 4, dept: 'sales', resetPolicy: 'yearly', collectionName: 'sales_contract_terms', fieldName: 'contractNo' },
  cost_term: { label: 'Cost Term', prefix: 'CST-', padding: 4, dept: 'sales', resetPolicy: 'yearly', collectionName: 'labor_cost_contract_terms', fieldName: 'id' },
  billing_note: { label: 'Billing Note', prefix: 'BN-', padding: 4, dept: 'accounting', resetPolicy: 'monthly', collectionName: 'billing_notes', fieldName: 'billingNoteNo' },
  tax_invoice: { label: 'Tax Invoice', prefix: 'INV-', padding: 4, dept: 'accounting', resetPolicy: 'monthly', collectionName: 'tax_invoices', fieldName: 'taxInvoiceNo' },
  commercial_invoice: {
    label: 'Draft commercial invoice',
    prefix: 'DFI-',
    padding: 4,
    dept: 'operations',
    resetPolicy: 'monthly',
    collectionName: 'commercial_invoices',
    fieldName: 'invoiceNo',
  },
  ap_bill: { label: 'AP Bill', prefix: 'APB-', padding: 4, dept: 'accounting', resetPolicy: 'monthly', collectionName: 'ap_bills', fieldName: 'apBillNo' },
  ar: { label: 'AR Reference', prefix: 'AR-', padding: 5, dept: 'accounting', resetPolicy: 'yearly', collectionName: 'accounts_receivable', fieldName: 'documentNo' },
  ap: { label: 'AP Reference', prefix: 'AP-', padding: 5, dept: 'accounting', resetPolicy: 'yearly', collectionName: 'accounts_payable', fieldName: 'documentNo' },
  cashbook_entry: { label: 'Cashbook Entry', prefix: 'CB-', padding: 6, dept: 'accounting', resetPolicy: 'monthly', collectionName: 'cashbook_entries', fieldName: 'entryNo' },
  bank_account: { label: 'Bank Account', prefix: 'BANK-', padding: 3, dept: 'accounting', resetPolicy: 'none', collectionName: 'bank_accounts', fieldName: 'accountCode' },
  petty_cash_account: {
    label: 'Petty Cash Account',
    prefix: 'PC-',
    padding: 3,
    dept: 'accounting',
    resetPolicy: 'none',
    collectionName: 'bank_accounts',
    fieldName: 'accountCode',
  },
  office_staff: { label: 'Office Staff', prefix: 'OFF-', padding: 4, dept: 'hr', resetPolicy: 'none', collectionName: 'office_staff', fieldName: 'staffCode' },
  worker: { label: 'Worker', prefix: 'WRK-', padding: 5, dept: 'hr', resetPolicy: 'none', collectionName: 'workers', fieldName: 'workerCode' },
  position: { label: 'Position', prefix: 'POS-', padding: 3, dept: 'hr', resetPolicy: 'none', collectionName: 'positions', fieldName: 'positionCode' },
  wave: { label: 'Wave', prefix: 'WV-', padding: 4, dept: 'operations', resetPolicy: 'yearly', collectionName: 'waves', fieldName: 'waveCode' },
  assignment: { label: 'Assignment', prefix: 'ASG-', padding: 6, dept: 'operations', resetPolicy: 'yearly', collectionName: 'mobilizations', fieldName: 'assignmentNo' },
  purchase: { label: 'Purchase', prefix: 'PUR-', padding: 5, dept: 'store', resetPolicy: 'monthly', collectionName: 'purchases', fieldName: 'purchaseNo' },
  purchase_vendor_bill: {
    label: 'Vendor bill receipt',
    prefix: 'VBR-',
    padding: 5,
    dept: 'store',
    resetPolicy: 'monthly',
    collectionName: 'purchase_vendor_bills',
    fieldName: 'receiptNo',
  },
  vendor: { label: 'Vendor', prefix: 'VEN-', padding: 4, dept: 'store', resetPolicy: 'none', collectionName: 'vendors', fieldName: 'vendorCode' },
  store_receive: { label: 'Store Receive', prefix: 'REC-', padding: 5, dept: 'store', resetPolicy: 'monthly', collectionName: 'store_receipts', fieldName: 'receiveNo' },
  store_issue: { label: 'Store Issue', prefix: 'ISS-', padding: 5, dept: 'store', resetPolicy: 'monthly', collectionName: 'store_issue_slips', fieldName: 'issueNo' },
  store_return: { label: 'Store Return', prefix: 'RET-', padding: 5, dept: 'store', resetPolicy: 'monthly', collectionName: 'store_return_slips', fieldName: 'returnNo' },
  store_writeoff: { label: 'Store Write-off', prefix: 'WOF-', padding: 5, dept: 'store', resetPolicy: 'monthly', collectionName: 'store_writeoffs', fieldName: 'writeoffNo' },
  payroll_run: { label: 'Worker Payroll', prefix: 'PR-', padding: 4, dept: 'hr', resetPolicy: 'monthly', collectionName: 'payroll_runs', fieldName: 'payrollRunNo' },
  office_payroll_run: { label: 'Office Payroll', prefix: 'OPR-', padding: 4, dept: 'hr', resetPolicy: 'monthly', collectionName: 'office_payroll_runs', fieldName: 'payrollRunNo' },
  executive_payroll_run: { label: 'Executive Payroll', prefix: 'EPR-', padding: 4, dept: 'accounting', resetPolicy: 'monthly', collectionName: 'executive_payroll_runs', fieldName: 'payrollRunNo' },
};

/**
 * Checks if a code is already in use in the target collection.
 */
export async function isCodeInUse(
  db: Firestore,
  collectionName: string,
  fieldName: string,
  code: string
): Promise<boolean> {
  const q = query(collection(db, collectionName), where(fieldName, '==', code), limit(1));
  const snap = await getDocs(q);
  return !snap.empty;
}

/**
 * Utility to format a document code string based on configuration and context.
 */
export function formatDocumentCode(
  config: SequenceConfig,
  runningNumber: number,
  date: Date = new Date()
): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  
  let dynamicPart = '';
  if (config.resetPolicy === 'yearly') {
    dynamicPart = `${year}-`;
  } else if (config.resetPolicy === 'monthly') {
    dynamicPart = `${year}-${month.toString().padStart(2, '0')}-`;
  }

  const paddedNum = runningNumber.toString().padStart(config.padding, '0');
  return `${config.prefix}${dynamicPart}${paddedNum}`;
}

/**
 * Provides a non-final preview pattern for a sequence.
 */
export function getPreviewPattern(sequenceKey: string): string {
  const config = SEQUENCE_REGISTRY[sequenceKey];
  if (!config) return "(Auto-generated)";
  
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  
  let dynamicPart = '';
  if (config.resetPolicy === 'yearly') {
    dynamicPart = `${year}-`;
  } else if (config.resetPolicy === 'monthly') {
    dynamicPart = `${year}-${month.toString().padStart(2, '0')}-`;
  }

  const placeholder = 'X'.repeat(config.padding);
  return `${config.prefix}${dynamicPart}${placeholder}`;
}

/**
 * Atomicly generates the next sequential number for a given document type.
 */
export async function generateNextDocumentCode(
  db: Firestore,
  sequenceKey: string,
  options: { actor?: string; userId?: string; date?: Date } = {}
): Promise<{ code: string; metadata: NumberSequence }> {
  const config = SEQUENCE_REGISTRY[sequenceKey];
  if (!config) throw new Error(`Sequence configuration not found for key: ${sequenceKey}`);

  const seqRef = doc(db, 'number_sequences', sequenceKey);
  const date = options.date || new Date();
  const currentYear = date.getFullYear();
  const currentMonth = date.getMonth() + 1;
  const actor = options.actor || 'system';
  const userId = options.userId || 'system';

  let attempts = 0;
  const MAX_ATTEMPTS = 5;

  while (attempts < MAX_ATTEMPTS) {
    const result = await runTransaction(db, async (transaction) => {
      const seqSnap = await transaction.get(seqRef);
      let lastNumber = 0;
      let existingData: any = {};

      if (seqSnap.exists()) {
        existingData = seqSnap.data();
        lastNumber = existingData.lastNumber || 0;

        // Reset logic
        if (config.resetPolicy === 'yearly' && existingData.year !== currentYear) {
          lastNumber = 0;
        } else if (config.resetPolicy === 'monthly' && (existingData.month !== currentMonth || existingData.year !== currentYear)) {
          lastNumber = 0;
        }
      }

      const nextNumber = lastNumber + 1;
      const code = formatDocumentCode(config, nextNumber, date);

      const metadata: NumberSequence = {
        id: sequenceKey,
        sequenceKey,
        label: config.label,
        prefix: config.prefix,
        department: config.dept,
        entityType: sequenceKey,
        resetPolicy: config.resetPolicy,
        year: currentYear,
        month: currentMonth,
        paddingLength: config.padding,
        lastNumber: nextNumber,
        lastIssuedCode: code,
        isActive: true,
        updatedAt: Date.now(),
        updatedBy: actor
      };

      // Update sequence metadata
      transaction.set(seqRef, metadata, { merge: true });

      // Log issuance
      const auditRef = doc(collection(db, 'audit_logs'));
      transaction.set(auditRef, {
        id: auditRef.id,
        actionType: 'ISSUE_CODE',
        entityType: 'NumberSequence',
        entityId: sequenceKey,
        entityLabel: `${config.label}: ${code}`,
        actorUserId: userId,
        actorName: actor,
        actorRole: 'system',
        eventAt: Date.now(),
        afterSummary: `Issued code ${code} for ${sequenceKey}`,
        sourceModule: 'system'
      });

      return { code, metadata };
    });

    const inUse = await isCodeInUse(db, config.collectionName, config.fieldName, result.code);
    if (!inUse) {
      return result;
    }

    attempts++;
  }

  throw new Error(`Critical: Could not generate a unique code for ${sequenceKey}.`);
}
