'use client';

/**
 * @fileOverview Centralized document numbering service.
 * Ensures sequential, unique numbers using Firestore transactions.
 * Supports automated resets (Yearly/Monthly) based on policy.
 */

import { Firestore, doc, runTransaction } from 'firebase/firestore';
import { DeptType, NumberSequence } from '../types';

export interface SequenceConfig {
  prefix: string;
  padding: number;
  dept: DeptType;
  resetPolicy: 'none' | 'yearly' | 'monthly';
  label: string;
}

/**
 * Registry of standard sequence configurations for the platform.
 * Provides safe defaults for automatic numbering across all departments.
 */
export const SEQUENCE_REGISTRY: Record<string, SequenceConfig> = {
  main_contract: { label: 'Main Contract', prefix: 'MC-', padding: 5, dept: 'sales', resetPolicy: 'yearly' },
  customer: { label: 'Customer', prefix: 'CUS-', padding: 5, dept: 'sales', resetPolicy: 'none' },
  customer_po: { label: 'Customer PO', prefix: 'PO-', padding: 5, dept: 'sales', resetPolicy: 'yearly' },
  quotation: { label: 'Quotation', prefix: 'QT-', padding: 5, dept: 'sales', resetPolicy: 'monthly' },
  billing_note: { label: 'Billing Note', prefix: 'BN-', padding: 4, dept: 'accounting', resetPolicy: 'monthly' },
  tax_invoice: { label: 'Tax Invoice', prefix: 'INV-', padding: 4, dept: 'accounting', resetPolicy: 'monthly' },
  receipt: { label: 'Receipt', prefix: 'RCT-', padding: 4, dept: 'accounting', resetPolicy: 'monthly' },
  ap_bill: { label: 'AP Bill', prefix: 'APB-', padding: 4, dept: 'accounting', resetPolicy: 'monthly' },
  ar: { label: 'Accounts Receivable', prefix: 'AR-', padding: 5, dept: 'accounting', resetPolicy: 'yearly' },
  ap: { label: 'Accounts Payable', prefix: 'AP-', padding: 5, dept: 'accounting', resetPolicy: 'yearly' },
  cashbook_entry: { label: 'Cashbook Entry', prefix: 'CB-', padding: 6, dept: 'accounting', resetPolicy: 'monthly' },
  bank_account: { label: 'Bank Account', prefix: 'BANK-', padding: 3, dept: 'accounting', resetPolicy: 'none' },
  office_staff: { label: 'Office Staff', prefix: 'OFF-', padding: 4, dept: 'hr', resetPolicy: 'none' },
  worker: { label: 'Worker', prefix: 'WRK-', padding: 5, dept: 'hr', resetPolicy: 'none' },
  position: { label: 'Position', prefix: 'POS-', padding: 3, dept: 'hr', resetPolicy: 'none' },
  wave: { label: 'Wave', prefix: 'WV-', padding: 4, dept: 'operations', resetPolicy: 'yearly' },
  assignment: { label: 'Assignment', prefix: 'ASG-', padding: 6, dept: 'operations', resetPolicy: 'yearly' },
  purchase: { label: 'Purchase', prefix: 'PUR-', padding: 5, dept: 'store', resetPolicy: 'monthly' },
  vendor: { label: 'Vendor', prefix: 'VEN-', padding: 4, dept: 'store', resetPolicy: 'none' },
  payroll_run: { label: 'Worker Payroll', prefix: 'PR-', padding: 4, dept: 'hr', resetPolicy: 'monthly' },
  office_payroll_run: { label: 'Office Payroll', prefix: 'OPR-', padding: 4, dept: 'hr', resetPolicy: 'monthly' },
};

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
  options: { actor?: string; date?: Date } = {}
): Promise<{ code: string; metadata: NumberSequence }> {
  const config = SEQUENCE_REGISTRY[sequenceKey];
  if (!config) throw new Error(`Sequence configuration not found for key: ${sequenceKey}`);

  const seqRef = doc(db, 'number_sequences', sequenceKey);
  const date = options.date || new Date();
  const currentYear = date.getFullYear();
  const currentMonth = date.getMonth() + 1;
  const actor = options.actor || 'system';

  return await runTransaction(db, async (transaction) => {
    const seqSnap = await transaction.get(seqRef);
    let lastNumber = 0;
    let existingData: Partial<NumberSequence> = {};

    if (seqSnap.exists()) {
      existingData = seqSnap.data() as NumberSequence;
      lastNumber = existingData.lastNumber || 0;

      // Reset logic
      if (config.resetPolicy === 'yearly' && existingData.year !== currentYear) {
        lastNumber = 0;
      } else if (config.resetPolicy === 'monthly' && (existingData.month !== currentMonth || existingData.year !== currentYear)) {
        lastNumber = 0;
      }
    }

    const nextNumber = lastNumber + 1;
    const finalCode = formatDocumentCode(config, nextNumber, date);

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
      lastIssuedCode: finalCode,
      isActive: true,
      updatedAt: Date.now(),
      updatedBy: actor
    };

    transaction.set(seqRef, metadata, { merge: true });

    return { code: finalCode, metadata };
  });
}

/**
 * Basic incremental number generation.
 * @deprecated Use generateNextDocumentCode for standardized reset-aware numbering.
 */
export async function generateNextNumber(
  db: Firestore, 
  sequenceKey: string, 
  prefix: string, 
  padding: number = 4
): Promise<string> {
  const regKey = Object.keys(SEQUENCE_REGISTRY).find(k => sequenceKey.startsWith(k));
  if (regKey) {
    const { code } = await generateNextDocumentCode(db, regKey);
    return code;
  }
  
  const seqRef = doc(db, 'number_sequences', sequenceKey);
  return await runTransaction(db, async (transaction) => {
    const seqSnap = await transaction.get(seqRef);
    let nextNum = 1;
    if (seqSnap.exists()) {
      nextNum = (seqSnap.data().lastNumber || 0) + 1;
      transaction.update(seqRef, { lastNumber: nextNum, updatedAt: Date.now() });
    } else {
      transaction.set(seqRef, { id: sequenceKey, prefix, lastNumber: nextNum, updatedAt: Date.now(), createdAt: Date.now() });
    }
    return `${prefix}${nextNum.toString().padStart(padding, '0')}`;
  });
}
