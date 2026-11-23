import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchLine,
  Purchase,
  PurchaseVendorBill,
  RentalPayable,
  TaxInvoice,
} from '@/lib/types';
import { ymMatchesYearMonthScope } from '@/lib/date/year-month-scope-filter';
import { vendorBillListMoneyColumns } from '@/lib/ops/purchase-payment-milestones';
import { ssoCombinedRemitAmount } from '@/lib/payroll/payroll-sso-payment-model';
import { resolveSharedMonthlyEmployeeSso } from '@/lib/payroll/payroll-person-month-group';
import {
  officePayrollLineEmployeeAssistanceFundAmount,
  officePayrollLineSocialSecurityAmount,
  officePayrollLineTaxAmount,
} from '@/lib/payroll/payroll-office-wht-model';
import {
  workerPayrollLineEmployeeAssistanceFundAmount,
  workerPayrollLineSocialSecurityAmount,
  workerPayrollLineWithholdingAmount,
} from '@/lib/payroll/payroll-worker-wht-model';

export type DashboardMonitorTotals = {
  salesBeforeTax: number;
  salesVat: number;
  purchaseBeforeTax: number;
  purchaseVat: number;
  whtWithheldFromVendors: number;
  whtWithheldFromUs: number;
  officeSalary: number;
  workerSalary: number;
  socialSecurity: number;
  payrollWht: number;
  assistanceFund: number;
  vatDifference: number;
};

const EMPTY: DashboardMonitorTotals = {
  salesBeforeTax: 0,
  salesVat: 0,
  purchaseBeforeTax: 0,
  purchaseVat: 0,
  whtWithheldFromVendors: 0,
  whtWithheldFromUs: 0,
  officeSalary: 0,
  workerSalary: 0,
  socialSecurity: 0,
  payrollWht: 0,
  assistanceFund: 0,
  vatDifference: 0,
};

function round2(n: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function ymOf(value: string | null | undefined): string {
  const key = String(value || '').trim().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(key) ? key : '';
}

function inScope(ym: string, yearCe: number, monthScope: string): boolean {
  return ymMatchesYearMonthScope(ym, yearCe, monthScope);
}

function vendorBillCounts(bill: PurchaseVendorBill): boolean {
  if (bill.cancellationSettlement) return false;
  return bill.status !== 'DRAFT' && bill.status !== 'CANCELLED';
}

function vendorBillYm(bill: PurchaseVendorBill): string {
  return ymOf(bill.rentalPeriodMonth) || ymOf(bill.billingReceivedDate);
}

const OFFICE_RUN_SKIP = new Set(['DRAFT', 'CANCELLED', 'PROCESSING']);

type PaySlot = {
  recency: number;
  gross: number;
  /** ปกส. ฝั่งลูกจ้างของสลิปล่าสุด — คูณรวมนายจ้างตอนสรุป */
  employeeSso: number;
  wht: number;
  fund: number;
  periodYm: string;
};

function newer(prev: PaySlot | undefined, next: PaySlot): PaySlot {
  if (!prev || next.recency >= prev.recency) return next;
  return prev;
}

function cappedEmployeeSso(amount: number, periodYm: string): number {
  return resolveSharedMonthlyEmployeeSso(
    [
      {
        rowKey: 'latest',
        personId: 'person',
        periodYm,
        paymentYmd: periodYm ? `${periodYm}-01` : '',
        recencyMs: 0,
        lineAmount: amount,
      },
    ],
    periodYm,
  );
}

function addPayrollSlots(
  slots: Map<string, PaySlot>,
  extras: { gross: number; socialSecurity: number; wht: number; fund: number },
  target: { salary: number; socialSecurity: number; wht: number; fund: number },
): void {
  for (const slot of slots.values()) {
    const employeeSso = cappedEmployeeSso(slot.employeeSso, slot.periodYm);
    target.salary = round2(target.salary + slot.gross);
    target.socialSecurity = round2(target.socialSecurity + ssoCombinedRemitAmount(employeeSso));
    target.wht = round2(target.wht + slot.wht);
    target.fund = round2(target.fund + slot.fund);
  }
  target.salary = round2(target.salary + extras.gross);
  target.socialSecurity = round2(target.socialSecurity + extras.socialSecurity);
  target.wht = round2(target.wht + extras.wht);
  target.fund = round2(target.fund + extras.fund);
}

export function computeDashboardMonitorTotals(input: {
  yearCe: number;
  monthScope: string;
  issuedTaxInvoices: readonly TaxInvoice[];
  vendorBills: readonly PurchaseVendorBill[];
  purchasesById: Readonly<Record<string, Purchase | undefined>>;
  rentalPayables: readonly RentalPayable[];
  officeLines: readonly { run: OfficePayrollRun; line: OfficePayrollLine; kind?: 'office' | 'executive' }[];
  workerLines: readonly { batch: PayrollBatch; line: PayrollBatchLine }[];
}): DashboardMonitorTotals {
  const { yearCe, monthScope } = input;
  const totals = { ...EMPTY };

  for (const invoice of input.issuedTaxInvoices) {
    if (invoice.status !== 'ISSUED') continue;
    if (!inScope(ymOf(invoice.issueDate), yearCe, monthScope)) continue;
    totals.salesBeforeTax = round2(totals.salesBeforeTax + (Number(invoice.taxableAmount) || 0));
    totals.salesVat = round2(totals.salesVat + (Number(invoice.vatAmount) || 0));
    totals.whtWithheldFromUs = round2(totals.whtWithheldFromUs + (Number(invoice.withholdingTaxAmount) || 0));
  }

  const rentCoveredByBill = new Set<string>();
  for (const bill of input.vendorBills) {
    if (!vendorBillCounts(bill)) continue;
    if (!inScope(vendorBillYm(bill), yearCe, monthScope)) continue;
    const money = vendorBillListMoneyColumns(bill, input.purchasesById[bill.purchaseId]);
    if (!money) continue;
    totals.purchaseBeforeTax = round2(totals.purchaseBeforeTax + money.beforeTax);
    totals.purchaseVat = round2(totals.purchaseVat + money.vat);
    totals.whtWithheldFromVendors = round2(totals.whtWithheldFromVendors + money.wht);
    const rentMonth = ymOf(bill.rentalPeriodMonth);
    if (bill.rentalContractId && rentMonth) {
      rentCoveredByBill.add(`${bill.rentalContractId}|${rentMonth}`);
    }
  }

  for (const payable of input.rentalPayables) {
    if (payable.status === 'VOID') continue;
    const period = ymOf(payable.periodMonth);
    if (!inScope(period, yearCe, monthScope)) continue;
    if (rentCoveredByBill.has(`${payable.contractId}|${period}`)) continue;
    const vat = Number(payable.vatAmount) || 0;
    const base =
      payable.baseRentAmount != null
        ? Number(payable.baseRentAmount) || 0
        : Math.max(0, (Number(payable.grossAmount) || 0) - vat);
    totals.purchaseBeforeTax = round2(totals.purchaseBeforeTax + base);
    totals.purchaseVat = round2(totals.purchaseVat + vat);
    totals.whtWithheldFromVendors = round2(
      totals.whtWithheldFromVendors + (Number(payable.withholdingTaxAmount) || 0),
    );
  }

  const officeSlots = new Map<string, PaySlot>();
  const officeExtra = { gross: 0, socialSecurity: 0, wht: 0, fund: 0 };
  for (const { run, line, kind } of input.officeLines) {
    if (OFFICE_RUN_SKIP.has(run.status)) continue;
    const periodYm = ymOf(run.payrollMonth) || ymOf(line.payrollMonth);
    if (!inScope(periodYm, yearCe, monthScope)) continue;
    const slot: PaySlot = {
      recency: Number(run.updatedAt) || 0,
      gross: Number(line.grossPay) || 0,
      employeeSso: officePayrollLineSocialSecurityAmount(line),
      wht: officePayrollLineTaxAmount(line),
      fund: officePayrollLineEmployeeAssistanceFundAmount(line),
      periodYm,
    };
    const key = `${kind === 'executive' ? 'executive' : 'office'}|${line.staffId}|${periodYm}`;
    officeSlots.set(key, newer(officeSlots.get(key), slot));
  }

  const workerSlots = new Map<string, PaySlot>();
  const workerExtra = { gross: 0, socialSecurity: 0, wht: 0, fund: 0 };
  for (const { batch, line } of input.workerLines) {
    if (batch.status === 'DRAFT') continue;
    const periodYm = ymOf(line.periodEndDate) || ymOf(line.periodStartDate);
    if (!inScope(periodYm, yearCe, monthScope)) continue;
    const slot: PaySlot = {
      recency: Number(batch.updatedAt) || 0,
      gross: Number(line.grossAmount) || 0,
      employeeSso: workerPayrollLineSocialSecurityAmount(line),
      wht: workerPayrollLineWithholdingAmount(line),
      fund: workerPayrollLineEmployeeAssistanceFundAmount(line),
      periodYm,
    };
    if (batch.batchType === 'SUPPLEMENTAL') {
      workerExtra.gross = round2(workerExtra.gross + slot.gross);
      workerExtra.socialSecurity = round2(
        workerExtra.socialSecurity + ssoCombinedRemitAmount(cappedEmployeeSso(slot.employeeSso, periodYm)),
      );
      workerExtra.wht = round2(workerExtra.wht + slot.wht);
      workerExtra.fund = round2(workerExtra.fund + slot.fund);
      continue;
    }
    const key = `${line.workerId}|${periodYm}`;
    workerSlots.set(key, newer(workerSlots.get(key), slot));
  }

  const office = { salary: 0, socialSecurity: 0, wht: 0, fund: 0 };
  const worker = { salary: 0, socialSecurity: 0, wht: 0, fund: 0 };
  addPayrollSlots(officeSlots, officeExtra, office);
  addPayrollSlots(workerSlots, workerExtra, worker);

  totals.officeSalary = office.salary;
  totals.workerSalary = worker.salary;
  totals.socialSecurity = round2(office.socialSecurity + worker.socialSecurity);
  totals.payrollWht = round2(office.wht + worker.wht);
  totals.assistanceFund = round2(office.fund + worker.fund);
  totals.vatDifference = round2(totals.salesVat - totals.purchaseVat);
  return totals;
}
