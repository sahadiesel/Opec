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
  workerPayrollLineLumpSumWhtAmount,
  workerPayrollLinePitAmount,
  workerPayrollLineSocialSecurityAmount,
} from '@/lib/payroll/payroll-worker-wht-model';
import { isLumpSumPayrollLine } from '@/lib/payroll/lump-sum-worker';

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

/**
 * ยอดหัก ณ ที่จ่ายของบรรทัดลูกจ้างบนแดชบอร์ด —
 * ลูกจ้างบริษัท = ภงด.1 · ลูกจ้างเหมา = 50ทวิ (รวมกรณีบรรทัดเก่าที่ไม่มี engagement kind แต่มียอด lump_sum_wht)
 */
function dashboardWorkerWithholdingAmount(line: PayrollBatchLine): number {
  const lump = workerPayrollLineLumpSumWhtAmount(line);
  if (isLumpSumPayrollLine(line)) return lump;
  if (line.payrollEngagementKind !== 'COMPANY' && lump > 0.005) return lump;
  return workerPayrollLinePitAmount(line);
}

function emptyPayBucket() {
  return { salary: 0, socialSecurity: 0, wht: 0, fund: 0 };
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

  const officeStaffSlots = new Map<string, PaySlot>();
  const executiveSlots = new Map<string, PaySlot>();
  const emptyExtra = () => ({ gross: 0, socialSecurity: 0, wht: 0, fund: 0 });
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
    const isExecutive = kind === 'executive';
    const key = `${isExecutive ? 'executive' : 'office'}|${line.staffId}|${periodYm}`;
    const map = isExecutive ? executiveSlots : officeStaffSlots;
    map.set(key, newer(map.get(key), slot));
  }

  const companyWorkerSlots = new Map<string, PaySlot>();
  const lumpSumWorkerSlots = new Map<string, PaySlot>();
  const companyWorkerExtra = emptyExtra();
  const lumpSumWorkerExtra = emptyExtra();
  for (const { batch, line } of input.workerLines) {
    if (batch.status === 'DRAFT') continue;
    const periodYm = ymOf(line.periodEndDate) || ymOf(line.periodStartDate);
    if (!inScope(periodYm, yearCe, monthScope)) continue;
    const wht = dashboardWorkerWithholdingAmount(line);
    const lumpWht = workerPayrollLineLumpSumWhtAmount(line);
    const isLump =
      isLumpSumPayrollLine(line) ||
      (line.payrollEngagementKind !== 'COMPANY' && lumpWht > 0.005);
    const slot: PaySlot = {
      recency: Number(batch.updatedAt) || 0,
      gross: Number(line.grossAmount) || 0,
      employeeSso: isLump ? 0 : workerPayrollLineSocialSecurityAmount(line),
      wht,
      fund: isLump ? 0 : workerPayrollLineEmployeeAssistanceFundAmount(line),
      periodYm,
    };
    if (batch.batchType === 'SUPPLEMENTAL') {
      const extra = isLump ? lumpSumWorkerExtra : companyWorkerExtra;
      extra.gross = round2(extra.gross + slot.gross);
      if (!isLump) {
        extra.socialSecurity = round2(
          extra.socialSecurity + ssoCombinedRemitAmount(cappedEmployeeSso(slot.employeeSso, periodYm)),
        );
        extra.fund = round2(extra.fund + slot.fund);
      }
      extra.wht = round2(extra.wht + slot.wht);
      continue;
    }
    const key = `${line.workerId}|${periodYm}`;
    const map = isLump ? lumpSumWorkerSlots : companyWorkerSlots;
    map.set(key, newer(map.get(key), slot));
  }

  const officeStaff = emptyPayBucket();
  const executive = emptyPayBucket();
  const companyWorker = emptyPayBucket();
  const lumpSumWorker = emptyPayBucket();
  addPayrollSlots(officeStaffSlots, emptyExtra(), officeStaff);
  addPayrollSlots(executiveSlots, emptyExtra(), executive);
  addPayrollSlots(companyWorkerSlots, companyWorkerExtra, companyWorker);
  addPayrollSlots(lumpSumWorkerSlots, lumpSumWorkerExtra, lumpSumWorker);

  totals.officeSalary = round2(officeStaff.salary + executive.salary);
  totals.workerSalary = round2(companyWorker.salary + lumpSumWorker.salary);
  totals.socialSecurity = round2(
    officeStaff.socialSecurity + executive.socialSecurity + companyWorker.socialSecurity,
  );
  /** ออฟฟิศ + ลูกจ้างบริษัท + ลูกจ้างเหมา + นายจ้าง/ผู้บริหาร */
  totals.payrollWht = round2(
    officeStaff.wht + companyWorker.wht + lumpSumWorker.wht + executive.wht,
  );
  totals.assistanceFund = round2(
    officeStaff.fund + executive.fund + companyWorker.fund,
  );
  totals.vatDifference = round2(totals.salesVat - totals.purchaseVat);
  return totals;
}
