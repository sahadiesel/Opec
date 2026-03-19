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
  main_contract: { label: 'Main Contract', prefix: 'MC-', padding: 4, dept: 'sales', resetPolicy: 'yearly' },
  customer: { label: 'Customer', prefix: 'CUST-', padding: 4, dept: 'sales', resetPolicy: 'none' },
  customer_po: { label: 'Customer PO', prefix: 'PO-', padding: 4, dept: 'sales', resetPolicy: 'yearly' },
  quotation: { label: 'Quotation', prefix: 'QT-', padding: 4, dept: 'sales', resetPolicy: 'yearly' },
  billing_note: { label: 'Billing Note', prefix: 'BN-', padding: 4, dept: 'accounting', resetPolicy: 'monthly' },
  tax_invoice: { label: 'Tax Invoice', prefix: 'INV-', padding: 4, dept: 'accounting', resetPolicy: 'monthly' },
  receipt: { label: 'Receipt', prefix: 'RCT-', padding: 4, dept: 'accounting', resetPolicy: 'monthly' },
  ap_bill: { label: 'AP Bill', prefix: 'APB-', padding: 4, dept: 'accounting', resetPolicy: 'monthly' },
  ar: { label: 'Accounts Receivable', prefix: 'AR-', padding: 5, dept: 'accounting', resetPolicy: 'yearly' },
  ap: { label: 'Accounts Payable', prefix: 'AP-', padding: 5, dept: 'accounting', resetPolicy: 'yearly' },
  cashbook_entry: { label: 'Cashbook Entry', prefix: 'CB-', padding: 6, dept: 'accounting', resetPolicy: 'monthly' },
  bank_account: { label: 'Bank Account', prefix: 'BANK-', padding: 3, dept: 'accounting', resetPolicy: 'none' },
  office_staff: { label: 'Office Staff', prefix: 'OFF-', padding: 4, dept: 'hr', resetPolicy: 'none' },
  worker: { label: 'Worker', prefix: 'WKR-', padding: 5, dept: 'hr', resetPolicy: 'none' },
  position: { label: 'Position', prefix: 'POS-', padding: 3, dept: 'hr', resetPolicy: 'none' },
  wave: { label: 'Wave', prefix: 'WV-', padding: 4, dept: 'operations', resetPolicy: 'yearly' },
  assignment: { label: 'Assignment', prefix: 'ASG-', padding: 6, dept: 'operations', resetPolicy: 'yearly' },
  purchase: { label: 'Purchase', prefix: 'PUR-', padding: 5, dept: 'store', resetPolicy: 'monthly' },
  vendor: { label: 'Vendor', prefix: 'VEN-', padding: 4, dept: 'store', resetPolicy: 'none' },
};

/**
 * Atomicly generates the next sequential number for a given document type.
 * Handles reset policies (Yearly/Monthly) automatically.
 * 
 * @param db Firestore instance
 * @param sequenceKey Unique key from SEQUENCE_REGISTRY
 * @param actor Name or ID of the user performing the generation
 * @returns Final formatted document code (e.g. 'BN-2024-05-0042')
 */
export async function generateNextSequenceCode(
  db: Firestore, 
  sequenceKey: string,
  actor: string = 'system'
): Promise<string> {
  const config = SEQUENCE_REGISTRY[sequenceKey];
  if (!config) throw new Error(`Sequence configuration not found for key: ${sequenceKey}`);

  const seqRef = doc(db, 'number_sequences', sequenceKey);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  return await runTransaction(db, async (transaction) => {
    const seqSnap = await transaction.get(seqRef);
    let lastNumber = 0;

    if (seqSnap.exists()) {
      const data = seqSnap.data() as NumberSequence;
      lastNumber = data.lastNumber || 0;

      // Reset logic
      if (config.resetPolicy === 'yearly' && data.year !== currentYear) {
        lastNumber = 0;
      } else if (config.resetPolicy === 'monthly' && (data.month !== currentMonth || data.year !== currentYear)) {
        lastNumber = 0;
      }
    }

    const nextNumber = lastNumber + 1;
    
    // Formatting logic
    let dynamicPart = '';
    if (config.resetPolicy === 'yearly') {
      dynamicPart = `${currentYear}-`;
    } else if (config.resetPolicy === 'monthly') {
      dynamicPart = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-`;
    }

    const paddedNum = nextNumber.toString().padStart(config.padding, '0');
    const finalCode = `${config.prefix}${dynamicPart}${paddedNum}`;

    // Prepare updated record
    const updatePayload: Partial<NumberSequence> = {
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

    transaction.set(seqRef, updatePayload, { merge: true });

    return finalCode;
  });
}

/**
 * Basic incremental number generation.
 * @deprecated Use generateNextSequenceCode for standardized reset-aware numbering.
 */
export async function generateNextNumber(
  db: Firestore, 
  sequenceKey: string, 
  prefix: string, 
  padding: number = 4
): Promise<string> {
  const seqRef = doc(db, 'number_sequences', sequenceKey);
  
  return await runTransaction(db, async (transaction) => {
    const seqSnap = await transaction.get(seqRef);
    let nextNum = 1;
    
    if (seqSnap.exists()) {
      const data = seqSnap.data();
      nextNum = (data.lastNumber || 0) + 1;
      transaction.update(seqRef, {
        lastNumber: nextNum,
        updatedAt: Date.now()
      });
    } else {
      transaction.set(seqRef, {
        id: sequenceKey,
        prefix,
        lastNumber: nextNum,
        updatedAt: Date.now(),
        createdAt: Date.now()
      });
    }
    
    const paddedNum = nextNum.toString().padStart(padding, '0');
    return `${prefix}${paddedNum}`;
  });
}
