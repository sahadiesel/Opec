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
  /** ใบเสร็จรับเงิน (ลูกหนี้) — แยกจากใบกำกับภาษี */
  money_receipt: {
    label: 'Receipt (customer)',
    prefix: 'MR-',
    padding: 5,
    dept: 'accounting',
    resetPolicy: 'monthly',
    collectionName: 'receipts',
    fieldName: 'receiptNo',
  },
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
  rental_contract: {
    label: 'Rental Contract',
    prefix: 'RC-',
    padding: 5,
    dept: 'accounting',
    resetPolicy: 'yearly',
    collectionName: 'rental_contracts',
    fieldName: 'contractNo',
  },
  /** OPEC เป็นผู้ให้เช่าเครื่องมือ/อุปกรณ์ */
  equipment_rental_contract: {
    label: 'Equipment rental contract (OPEC lessor)',
    prefix: 'ERC-',
    padding: 5,
    dept: 'sales',
    resetPolicy: 'yearly',
    collectionName: 'equipment_rental_contracts',
    fieldName: 'contractNo',
  },
  cashbook_entry: { label: 'Cashbook Entry', prefix: 'CB-', padding: 6, dept: 'accounting', resetPolicy: 'monthly', collectionName: 'cashbook_entries', fieldName: 'entryNo' },
  /** รับ/จ่ายหน้างาน — ไม่ลงสมุด cashbook หลัก (ยอดกองเงินสดย่อยเท่านั้น) */
  petty_cash_entry: {
    label: 'Petty Cash entry (on-site)',
    prefix: 'PCE-',
    padding: 6,
    dept: 'operations',
    resetPolicy: 'monthly',
    collectionName: 'petty_cash_entries',
    fieldName: 'entryNo',
  },
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
  /** คำขออนุมัติสั่งซื้อ (PR) — ก่อนสร้างใบสั่งซื้อ */
  purchase_request: {
    label: 'Purchase request (PR)',
    prefix: 'PREQ-',
    padding: 5,
    dept: 'store',
    resetPolicy: 'monthly',
    collectionName: 'purchase_requests',
    fieldName: 'requestNo',
  },
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
  cash_advance: {
    label: 'Cash advance',
    prefix: 'CAD-',
    padding: 5,
    dept: 'hr',
    resetPolicy: 'monthly',
    collectionName: 'cash_advance_requests',
    fieldName: 'requestNo',
  },
  vendor: { label: 'Vendor', prefix: 'VEN-', padding: 4, dept: 'store', resetPolicy: 'none', collectionName: 'vendors', fieldName: 'vendorCode' },
  store_receive: { label: 'Store Receive', prefix: 'REC-', padding: 5, dept: 'store', resetPolicy: 'monthly', collectionName: 'store_receipts', fieldName: 'receiveNo' },
  store_issue: { label: 'Store Issue', prefix: 'ISS-', padding: 5, dept: 'store', resetPolicy: 'monthly', collectionName: 'store_issue_slips', fieldName: 'issueNo' },
  store_return: { label: 'Store Return', prefix: 'RET-', padding: 5, dept: 'store', resetPolicy: 'monthly', collectionName: 'store_return_slips', fieldName: 'returnNo' },
  store_writeoff: { label: 'Store Write-off', prefix: 'WOF-', padding: 5, dept: 'store', resetPolicy: 'monthly', collectionName: 'store_writeoffs', fieldName: 'writeoffNo' },
  /** ทะเบียน SKU คลัง — อุปกรณ์/วัสดุทั่วไป (เสื้อช้อป ฯลฯ — ไม่ใช้คำว่า TOOL ในรหัส) */
  store_item_equipment: {
    label: 'Store catalog SKU (equipment / general)',
    prefix: 'EQM-',
    padding: 4,
    dept: 'store',
    resetPolicy: 'none',
    collectionName: 'store_items',
    fieldName: 'itemCode',
  },
  /** ทะเบียน SKU คลัง — PPE */
  store_item_ppe: {
    label: 'Store catalog SKU (PPE)',
    prefix: 'PPE-',
    padding: 4,
    dept: 'store',
    resetPolicy: 'none',
    collectionName: 'store_items',
    fieldName: 'itemCode',
  },
  payroll_run: { label: 'Worker Payroll', prefix: 'PR-', padding: 4, dept: 'hr', resetPolicy: 'monthly', collectionName: 'payroll_runs', fieldName: 'payrollRunNo' },
  office_payroll_run: { label: 'Office Payroll', prefix: 'OPR-', padding: 4, dept: 'hr', resetPolicy: 'monthly', collectionName: 'office_payroll_runs', fieldName: 'payrollRunNo' },
  executive_payroll_run: { label: 'Executive Payroll', prefix: 'EPR-', padding: 4, dept: 'accounting', resetPolicy: 'monthly', collectionName: 'executive_payroll_runs', fieldName: 'payrollRunNo' },
  executive_payroll_staff: {
    label: 'Executive roster (payroll)',
    prefix: 'EPX-',
    padding: 4,
    dept: 'accounting',
    resetPolicy: 'none',
    collectionName: 'executive_payroll_staff',
    fieldName: 'staffCode',
  },
  /**
   * เลขที่เอกสาร Timesheet ฉบับรวมรายเดือน (หนึ่งฉบับ/เดือน) — ใช้ส่งอนุมัติ / ลูกค้า / อ้างในใบวางบิลและ payroll
   * แทนการอ้างอิง “เลข Wave (WV-)” เป็นหลักใน flow เดิม; sequence key = `monthly_timesheet` คงเดิม
   * คอลเลกชัน `monthly_timesheet_documents` ฟิลด์ `timesheetNo` — รายการนี้จะแสดงที่หน้า Admin > เลขที่เอกสาร
   */
  monthly_timesheet: {
    label: 'Timesheet (TS-) — เอกสารลงเวลา (รอบเดือน)',
    prefix: 'TS-',
    padding: 4,
    dept: 'hr',
    resetPolicy: 'monthly',
    collectionName: 'monthly_timesheet_documents',
    fieldName: 'timesheetNo',
  },
  /** เฟส 2 — หนึ่งเลขต่อลูกค้า × Onshore/Offshore × เดือน */
  customer_month_timesheet: {
    label: 'Timesheet ลูกค้า × On/Offshore (CTX-)',
    prefix: 'CTX-',
    padding: 4,
    dept: 'hr',
    resetPolicy: 'monthly',
    collectionName: 'customer_month_timesheet_documents',
    fieldName: 'timesheetNo',
  },
  /** หนังสือรับรองการหักภาษี ณ ที่จ่าย (ม.50 ทวิ) — ปรับ prefix ได้ที่ Admin เลขที่เอกสาร */
  wht_certificate_50: {
    label: 'หนังสือรับรองหัก ณ ที่จ่าย (ม.50 ทวิ)',
    prefix: 'WHT50-',
    padding: 5,
    dept: 'accounting',
    resetPolicy: 'monthly',
    collectionName: 'withholding_certificate_documents',
    fieldName: 'certificateNo',
  },
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
      let periodRolled = false;

      if (seqSnap.exists()) {
        existingData = seqSnap.data();
        lastNumber = existingData.lastNumber || 0;

        // Reset logic
        if (config.resetPolicy === 'yearly' && existingData.year !== currentYear) {
          lastNumber = 0;
          periodRolled = true;
        } else if (
          config.resetPolicy === 'monthly' &&
          (existingData.month !== currentMonth || existingData.year !== currentYear)
        ) {
          lastNumber = 0;
          periodRolled = true;
        }
      }

      const releasedRaw = Array.isArray(existingData.releasedRunningNumbers)
        ? (existingData.releasedRunningNumbers as unknown[])
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0)
        : [];
      const released = periodRolled ? [] : [...new Set(releasedRaw)].sort((a, b) => a - b);

      let nextNumber: number;
      let remainingReleased = released;
      let tipLastNumber = lastNumber;
      if (released.length > 0) {
        nextNumber = released[0]!;
        remainingReleased = released.slice(1);
      } else {
        nextNumber = lastNumber + 1;
        tipLastNumber = nextNumber;
      }

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
        lastNumber: tipLastNumber,
        lastIssuedCode: code,
        isActive: true,
        updatedAt: Date.now(),
        updatedBy: actor,
      };

      // Update sequence metadata
      transaction.set(
        seqRef,
        {
          ...metadata,
          releasedRunningNumbers: remainingReleased,
        },
        { merge: true },
      );

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
        sourceModule: 'system',
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

/** Parse INV-YYYY-MM-NNNN style codes for monthly sequences (must match {@link formatDocumentCode}). */
export function parseMonthlySequenceCode(
  config: SequenceConfig,
  code: string,
): { year: number; month: number; runningNumber: number } | null {
  if (config.resetPolicy !== 'monthly') return null;
  if (!code.startsWith(config.prefix)) return null;
  const rest = code.slice(config.prefix.length);
  const m = rest.match(/^(\d{4})-(\d{2})-(\d+)$/);
  if (!m) return null;
  return {
    year: parseInt(m[1], 10),
    month: parseInt(m[2], 10),
    runningNumber: parseInt(m[3], 10),
  };
}

/**
 * คืนช่องเลขรายเดือนเมื่อลบเอกสาร — ถ้าเป็นเลขปลายสุดให้ลด lastNumber
 * ถ้าไม่ใช่ปลายสุด ให้เก็บใน releasedRunningNumbers เพื่อออกเลขเดิมได้อีก (เลขไม่หายจากระบบ)
 */
export async function releaseSequenceSlotIfLastIssued(
  db: Firestore,
  sequenceKey: string,
  issuedCode: string,
): Promise<boolean> {
  const config = SEQUENCE_REGISTRY[sequenceKey];
  if (!config || config.resetPolicy !== 'monthly') return false;

  const parsed = parseMonthlySequenceCode(config, issuedCode);
  if (!parsed) return false;

  const seqRef = doc(db, 'number_sequences', sequenceKey);

  return await runTransaction(db, async (transaction) => {
    const seqSnap = await transaction.get(seqRef);
    if (!seqSnap.exists()) return false;

    const data = seqSnap.data() as Partial<NumberSequence> & Record<string, unknown>;
    const lastNumber = typeof data.lastNumber === 'number' ? data.lastNumber : 0;
    const sy = data.year;
    const sm = data.month;

    if (sy !== parsed.year || sm !== parsed.month) {
      /** คนละเดือนกับเคาน์เตอร์ปัจจุบัน — เก็บเป็น released ของเดือนนั้นไม่ได้บน doc เดียว → no-op */
      return false;
    }

    if (lastNumber === parsed.runningNumber) {
      const nextNumber = Math.max(0, lastNumber - 1);
      const previewDate = new Date(parsed.year, parsed.month - 1, 15);
      const prevIssued =
        nextNumber > 0 ? formatDocumentCode(config, nextNumber, previewDate) : null;
      const releasedRaw = Array.isArray(data.releasedRunningNumbers)
        ? (data.releasedRunningNumbers as unknown[])
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0 && n !== parsed.runningNumber)
        : [];
      transaction.set(
        seqRef,
        {
          lastNumber: nextNumber,
          ...(prevIssued != null ? { lastIssuedCode: prevIssued } : { lastIssuedCode: null }),
          releasedRunningNumbers: [...new Set(releasedRaw)].sort((a, b) => a - b),
          updatedAt: Date.now(),
          updatedBy: 'sequence_release',
        },
        { merge: true },
      );
      return true;
    }

    /** ไม่ใช่ปลายสุด — คืนเข้า pool เพื่อออกเลขเดิมอีกได้หลัง admin ลบ */
    const releasedRaw = Array.isArray(data.releasedRunningNumbers)
      ? (data.releasedRunningNumbers as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    releasedRaw.push(parsed.runningNumber);
    transaction.set(
      seqRef,
      {
        releasedRunningNumbers: [...new Set(releasedRaw)].sort((a, b) => a - b),
        updatedAt: Date.now(),
        updatedBy: 'sequence_release',
      },
      { merge: true },
    );
    return true;
  });
}

/** e.g. AR-YYYY-NNNNN — must match {@link formatDocumentCode} for yearly sequences */
export function parseYearlySequenceCode(
  config: SequenceConfig,
  code: string,
): { year: number; runningNumber: number } | null {
  if (config.resetPolicy !== 'yearly') return null;
  if (!code.startsWith(config.prefix)) return null;
  const rest = code.slice(config.prefix.length);
  const m = rest.match(/^(\d{4})-(\d+)$/);
  if (!m) return null;
  return {
    year: parseInt(m[1], 10),
    runningNumber: parseInt(m[2], 10),
  };
}

/** Same idea as {@link releaseSequenceSlotIfLastIssued} for yearly sequences (e.g. `ar`). */
export async function releaseYearlySequenceSlotIfLastIssued(
  db: Firestore,
  sequenceKey: string,
  issuedCode: string,
): Promise<boolean> {
  const config = SEQUENCE_REGISTRY[sequenceKey];
  if (!config || config.resetPolicy !== 'yearly') return false;

  const parsed = parseYearlySequenceCode(config, issuedCode);
  if (!parsed) return false;

  const seqRef = doc(db, 'number_sequences', sequenceKey);

  return await runTransaction(db, async (transaction) => {
    const seqSnap = await transaction.get(seqRef);
    if (!seqSnap.exists()) return false;

    const data = seqSnap.data() as Partial<NumberSequence> & Record<string, unknown>;
    const lastNumber = typeof data.lastNumber === 'number' ? data.lastNumber : 0;
    const sy = data.year;

    if (sy !== parsed.year) return false;
    if (lastNumber !== parsed.runningNumber) return false;

    const nextNumber = Math.max(0, lastNumber - 1);
    const previewDate = new Date(parsed.year, 5, 15);
    const prevIssued =
      nextNumber > 0 ? formatDocumentCode(config, nextNumber, previewDate) : null;

    transaction.set(
      seqRef,
      {
        lastNumber: nextNumber,
        ...(prevIssued != null ? { lastIssuedCode: prevIssued } : { lastIssuedCode: null }),
        updatedAt: Date.now(),
        updatedBy: 'sequence_release',
      },
      { merge: true },
    );
    return true;
  });
}
