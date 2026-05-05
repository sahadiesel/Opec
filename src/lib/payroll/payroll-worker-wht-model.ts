import type { PayrollBatch, PayrollBatchLine, PaymentMethod, Position, Worker } from '@/lib/types';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';
import { buildWorkerPayslipDeductionLines, buildWorkerPayslipIncomeLines } from '@/lib/payroll/payslip-model';
import type {
  CompanyDocumentProfileForPayrollWht,
  PayrollWorkerWhtPrintVm,
  PayrollWorkerWhtValidationResult,
  PayrollWhtElectronicPayload,
} from '@/lib/payroll/payroll-worker-wht-types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function timestampMsToBangkokYmd(ms: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return '';
  return `${y}-${m}-${d}`;
}

/** วันที่จ่ายสำหรับแสดงในใบหัก — อิงเวลาอนุมัติ/จัดเตรียมจ่ายของ batch */
export function resolvePayrollWorkerWhtPaymentDateYmd(batch: PayrollBatch): string | undefined {
  const pick =
    batch.financePreparedAt ??
    batch.hrApprovedAt ??
    batch.lockedAt ??
    batch.updatedAt ??
    batch.createdAt;
  if (pick == null || !Number.isFinite(pick)) return undefined;
  return timestampMsToBangkokYmd(pick);
}

export function buildPayrollWorkerWhtDocumentNo(batchId: string, workerCode: string, issueYear: number): string {
  const safeBatch = (batchId || 'BATCH').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  const safeCode = (workerCode || 'WRK').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  return `WHT-PAY-${issueYear}-${safeBatch}-${safeCode}`;
}

export function maskBankAccountLast4(raw?: string | null): string | undefined {
  const s = (raw || '').replace(/\D/g, '');
  if (s.length < 4) return undefined;
  return s.slice(-4);
}

function combineAddressTh(c: CompanyDocumentProfileForPayrollWht | null): string {
  if (!c) return '';
  return [c.addressLine1, c.addressLine2].filter((x) => (x || '').trim()).join(' ');
}

function workerDisplayName(w: Worker): string {
  const full = `${w.firstName || ''} ${w.lastName || ''}`.trim();
  if (full) return full;
  return (w.nickname || '').trim() || w.workerCode || w.id;
}

function inferPaymentMethod(line: PayrollBatchLine): PaymentMethod {
  const m = line.workerPaymentProfileSnapshot?.paymentMethod;
  if (m === 'TRANSFER' || m === 'CASH' || m === 'CHEQUE') return m;
  return 'CASH';
}

function sumDeductionsMap(d: Record<string, number> | undefined): number {
  if (!d) return 0;
  return round2(Object.values(d).reduce((a, b) => a + (Number(b) || 0), 0));
}

function pitAmount(line: PayrollBatchLine): number {
  const db = line.deductionsBreakdown || {};
  const snap = line.d8Snapshot?.deductions || {};
  const v = Number(db.pit_withholding ?? snap.pit_withholding ?? 0);
  return round2(Number.isFinite(v) ? v : 0);
}

/**
 * สร้าง view model สำหรับพิมพ์ — ไม่เขียน Firestore
 * taxableIncomeAmount: fallback only; payroll taxable base should be mapped explicitly later.
 */
export function buildPayrollWorkerWhtPrintVm(input: {
  batch: PayrollBatch;
  line: PayrollBatchLine;
  worker: Worker;
  position: Position | null;
  company: CompanyDocumentProfileForPayrollWht | null;
  periodLabel: string;
  issueDateYmd: string;
  paymentDateYmd: string | undefined;
  officialDocumentNo?: boolean;
}): PayrollWorkerWhtPrintVm {
  const { batch, line, worker, position, company, periodLabel, issueDateYmd, paymentDateYmd } = input;

  const issueYear = Number(issueDateYmd.slice(0, 4)) || new Date().getFullYear();
  const documentNo = buildPayrollWorkerWhtDocumentNo(batch.id, worker.workerCode, issueYear);

  const grossAmount = round2(
    line.d8Snapshot?.gross != null && Number.isFinite(line.d8Snapshot.gross)
      ? Number(line.d8Snapshot.gross)
      : Number(line.grossAmount) || 0,
  );

  const incomeLines = buildWorkerPayslipIncomeLines(line);
  const earningsRows = incomeLines
    .filter((x) => (Number(x.amount) || 0) !== 0)
    .map((x) => ({ label: x.label, amount: round2(Number(x.amount) || 0) }));

  const deductionLines = buildWorkerPayslipDeductionLines(line);
  const deductionsRows = deductionLines
    .filter((x) => (Number(x.amount) || 0) !== 0)
    .map((x) => ({ label: x.label, amount: round2(Number(x.amount) || 0) }));

  const totalDeductions = round2(sumDeductionsMap(line.deductionsBreakdown));
  const netPaidAmount = round2(Number(line.netAmount) || 0);
  const wht = pitAmount(line);

  const thaiId = (worker.thaiNationalId || '').trim();
  const passport = (worker.passportNo || '').trim();
  const taxIdIsPassport = !thaiId && !!passport;
  const taxIdDisplay = thaiId || passport || '—';

  const disp = company?.whtCertificateDisplay;

  const payerAddrTh = combineAddressTh(company);

  const branchIsHeadOffice = company?.branchType !== 'branch';

  const taxableIncomeAmount = grossAmount;

  const pitZeroNote =
    wht <= 0.005 ? 'ไม่มีภาษีหัก ณ ที่จ่ายในงวดนี้ (แสดงยอดภาษี 0.00)' : undefined;

  return {
    documentNo,
    issueDateYmd,
    paymentDateYmd: paymentDateYmd || issueDateYmd,
    payrollPeriodLabel: periodLabel,
    batchReference: batch.id,
    subtitleTh: 'สำหรับเงินได้จากการจ้างงาน / ค่าแรงลูกจ้าง',

    payer: {
      legalNameTh: (company?.companyNameTh || '').trim() || '—',
      legalNameEn: (company?.companyNameEn || '').trim() || undefined,
      taxId: (company?.taxId || '').trim() || '—',
      branchIsHeadOffice,
      branchNo: branchIsHeadOffice ? undefined : (company?.branchNo || '').trim() || undefined,
      addressTh: payerAddrTh || '—',
      addressEn: undefined,
      phone: (company?.phone || '').trim() || undefined,
      email: (company?.email || '').trim() || undefined,
      taxpayerType: 'LEGAL_ENTITY',
    },

    payee: {
      displayName: workerDisplayName(worker),
      workerCode: worker.workerCode || worker.id,
      taxIdDisplay,
      taxIdIsPassport,
      nationality: (worker.nationality || '').trim() || undefined,
      positionLabel: position?.positionName || position?.positionNameTh || undefined,
      addressTh: (worker.address || '').trim() || undefined,
      bankName: (worker.bankName || '').trim() || undefined,
      bankAccountLast4: maskBankAccountLast4(worker.bankAccountNumber),
    },

    incomeTypeCode: 'PAYROLL_WAGE',
    incomeTypeNameTh: 'ค่าแรง / ค่าจ้าง / รายได้จากการทำงาน',
    formTypeCode: 'PND1',

    earningsRows,
    deductionsRows,

    grossAmount,
    totalDeductions,
    netPaidAmount,

    taxableIncomeAmount,
    withholdingTaxAmount: wht,
    withholdingTaxRateDisplayTh: 'ตามการคำนวณ Payroll',
    withholdingTaxWordsTh: amountToThaiBahtText(wht),
    pitZeroNote,

    taxCondition: 'WITHHOLDING',
    paymentMethod: inferPaymentMethod(line),
    paymentReferenceNo: batch.id,

    authorizedSignerName: disp?.authorizedSignerName,
    signerPosition: disp?.signerPosition,
    signatureImageUrl: disp?.signatureImageUrl,
    companyStampImageUrl: disp?.companyStampImageUrl || company?.documentHeaderStampUrl?.trim() || undefined,

    issuedByName: disp?.authorizedSignerName,

    documentStatusLabel: 'PREVIEW',
    xmlExportStatus: 'NOT_EXPORTED',
  };
}

export function validatePayrollWorkerWhtPrint(input: {
  company: CompanyDocumentProfileForPayrollWht | null;
  worker: Worker | null;
  batch: PayrollBatch | null;
  line: PayrollBatchLine | null;
  paymentDateYmd: string | undefined;
}): PayrollWorkerWhtValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { company, worker, batch, line, paymentDateYmd } = input;

  if (!company || !(company.companyNameTh || '').trim()) {
    errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ยังไม่มีข้อมูลบริษัทใน Document Header Profile');
  }
  if (!company || !(company.taxId || '').trim()) {
    errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ยังไม่มีเลขประจำตัวผู้เสียภาษีของบริษัทใน Document Header Profile');
  }
  const addr = combineAddressTh(company);
  if (!addr.trim()) {
    errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ยังไม่มีที่อยู่บริษัทใน Document Header Profile');
  }

  if (!worker) {
    errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่พบข้อมูลลูกจ้างจากทะเบียน');
  } else {
    if (!workerDisplayName(worker)) {
      errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ลูกจ้างยังไม่มีชื่อสำหรับแสดงในเอกสาร');
    }
    const th = (worker.thaiNationalId || '').trim();
    const pp = (worker.passportNo || '').trim();
    if (!th && !pp) {
      errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ลูกจ้างยังไม่มีเลขบัตรประชาชนหรือ Passport');
    }
    if (!th && pp) {
      warnings.push('ใช้เลข Passport แทนเลขประจำตัวผู้เสียภาษีไทย — กรณีแรงงานต่างชาติ');
    }
  }

  if (!batch || !(batch.id || '').trim()) {
    errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่พบงวด Payroll batch');
  }

  if (!line) {
    errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่พบข้อมูลสลิปเงินเดือนของลูกจ้าง');
  } else {
    if (!line.d8Snapshot) {
      errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่พบข้อมูลสลิปเงินเดือนของลูกจ้าง');
    }
    const gross = round2(Number(line.d8Snapshot?.gross) || 0);
    if (gross <= 0) {
      errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่มียอดรายได้รวมในงวดนี้');
    }
    const incomeTry = buildWorkerPayslipIncomeLines(line);
    const incomeSum = round2(incomeTry.reduce((s, x) => s + (Number(x.amount) || 0), 0));
    if (incomeTry.length === 0 || incomeSum <= 0) {
      warnings.push('ไม่มีรายการรายได้ในเอกสาร (ตรวจสอบ snapshot / การปัดเศษ) — ยังพิมพ์ได้จากยอดรวม');
    }

    const net = round2(Number(line.netAmount) || 0);
    const ded = round2(sumDeductionsMap(line.deductionsBreakdown));
    if (Math.abs(round2(gross - ded) - net) > 0.05) {
      errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ยอดสุทธิไม่ตรงกับยอดรายได้หักรายการหัก');
    }

    const wht = pitAmount(line);
    if (wht <= 0.005) {
      warnings.push('ไม่มีภาษีหัก ณ ที่จ่ายในงวดนี้ — แสดงยอดภาษีเป็น 0.00');
    }
  }

  if (!paymentDateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDateYmd)) {
    errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่สามารถระบุวันที่จ่ายเงินจากข้อมูล batch');
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function buildPayrollWhtElectronicDataFromVm(vm: PayrollWorkerWhtPrintVm): PayrollWhtElectronicPayload {
  /**
   * This is an internal XML-ready payload for payroll WHT.
   * Official RD schema mapping must be added before real submission.
   */
  const payerAddr = [vm.payer.addressTh, vm.payer.addressEn].filter(Boolean).join(' ');
  const payeeAddr = vm.payee.addressTh || '';
  return {
    documentTypeCode: 'PAYROLL_WHT_CERTIFICATE',
    documentNo: vm.documentNo,
    issueDate: vm.issueDateYmd,
    paymentDate: vm.paymentDateYmd,
    payerTaxId: vm.payer.taxId,
    payerBranchNo: vm.payer.branchIsHeadOffice ? '00000' : vm.payer.branchNo || '',
    payerName: vm.payer.legalNameTh,
    payerAddress: payerAddr,
    payeeTaxIdOrIdCard: vm.payee.taxIdIsPassport ? '' : vm.payee.taxIdDisplay,
    payeePassportNo: vm.payee.taxIdIsPassport ? vm.payee.taxIdDisplay : undefined,
    payeeName: vm.payee.displayName,
    payeeAddress: payeeAddr,
    incomeTypeCode: vm.incomeTypeCode,
    incomeTypeName: vm.incomeTypeNameTh,
    formTypeCode: 'PND1',
    withholdingTaxBase: vm.taxableIncomeAmount,
    withholdingTaxAmount: vm.withholdingTaxAmount,
    taxConditionCode: vm.taxCondition,
    payrollBatchNo: vm.batchReference,
    payrollPeriod: vm.payrollPeriodLabel,
    currencyCode: 'THB',
    exchangeRate: 1,
    xmlExportStatus: vm.xmlExportStatus,
  };
}
