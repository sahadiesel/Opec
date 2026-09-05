import type { OfficePayrollLine, OfficePayrollRun, OfficeStaff, PaymentMethod } from '@/lib/types';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';
import { buildPayslipFromOfficeLine } from '@/lib/payroll/payslip-model';
import { timestampMsToBangkokYmd } from '@/lib/payroll/payroll-worker-wht-model';
import type {
  CompanyDocumentProfileForPayrollWht,
  PayrollWorkerWhtPrintVm,
  PayrollWorkerWhtValidationResult,
} from '@/lib/payroll/payroll-worker-wht-types';

function round2(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

function combineAddressTh(c: CompanyDocumentProfileForPayrollWht | null): string {
  if (!c) return '';
  return [c.addressLine1, c.addressLine2].filter((x) => (x || '').trim()).join(' ');
}

function officeRunPaymentTimestamp(run: OfficePayrollRun): number | undefined {
  if (run.financeApprovedAt != null && Number.isFinite(run.financeApprovedAt)) return run.financeApprovedAt;
  if (run.status === 'FINANCE_APPROVED' || run.status === 'PAID' || run.status === 'LOCKED') {
    return run.lockedAt ?? run.updatedAt;
  }
  return undefined;
}

/** วันที่จ่ายสำหรับใบหัก — อิงวันโอน/ตัด cashbook จริง */
export function resolveOfficePayrollWhtPaymentDateYmd(run: OfficePayrollRun): string | undefined {
  const entry = run.financePayoutEntryDate?.trim();
  if (entry && /^\d{4}-\d{2}-\d{2}$/.test(entry)) return entry;
  const pick = officeRunPaymentTimestamp(run);
  if (pick == null || !Number.isFinite(pick)) return undefined;
  return timestampMsToBangkokYmd(pick);
}

export function buildPayrollOfficeWhtDocumentNo(runId: string, staffCode: string, issueYear: number): string {
  const safeRun = (runId || 'RUN').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  const safeCode = (staffCode || 'STF').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  return `WHT-OPR-${issueYear}-${safeRun}-${safeCode}`;
}

function inferOfficePaymentMethod(staff: OfficeStaff): PaymentMethod {
  const acct = (staff.bankAccountNumber || '').replace(/\D/g, '');
  return acct.length >= 4 ? 'TRANSFER' : 'CASH';
}

/** ยอดภาษีหัก ณ ที่จ่ายจากบรรทัดงวดพนักงานออฟฟิศ — ใช้รายการลิสต์เอกสารหักฯ */
export function officePayrollLineTaxAmount(line: OfficePayrollLine): number {
  const v = Number(line.tax ?? 0);
  return round2(Number.isFinite(v) ? v : 0);
}

function pitAmountOffice(line: OfficePayrollLine): number {
  return officePayrollLineTaxAmount(line);
}

/** ยอดประกันสังคม (ฝั่งพนักงาน) ของบรรทัดงวดนี้ — ใช้เป็น fallback เมื่อไม่มี YTD ระบุมา */
export function officePayrollLineSocialSecurityAmount(line: OfficePayrollLine): number {
  const v = Number(line.socialSecurity ?? 0);
  return round2(Number.isFinite(v) ? v : 0);
}

/** ยอดกองทุนสงเคราะห์ลูกจ้างของบรรทัดงวดนี้ — ใช้เป็น fallback เมื่อไม่มี YTD ระบุมา */
export function officePayrollLineEmployeeAssistanceFundAmount(line: OfficePayrollLine): number {
  const v = Number(line.d8Snapshot?.deductions?.employee_assistance_fund ?? 0);
  return round2(Number.isFinite(v) ? v : 0);
}

export function buildPayrollOfficeWhtPrintVm(input: {
  run: OfficePayrollRun;
  line: OfficePayrollLine;
  staff: OfficeStaff;
  company: CompanyDocumentProfileForPayrollWht | null;
  periodLabel: string;
  issueDateYmd: string;
  paymentDateYmd: string | undefined;
  officialDocumentNo?: boolean;
  /** ข้อความประเภทงวดบนสลิปฝังในใบหัก (เช่น ผู้บริหาร) */
  payslipPayrollTypeLabelOverride?: string;
  /** เงินสะสมกองทุนประกันสังคมทั้งปี (สำหรับยื่น ภ.ง.ด. 90/91) — ถ้าไม่ระบุ ใช้ยอดของบรรทัดงวดนี้แทน */
  yearToDateSocialSecurityBaht?: number;
  /** เงินสะสมกองทุนสงเคราะห์ลูกจ้างทั้งปี — ถ้าไม่ระบุ ใช้ยอดของบรรทัดงวดนี้แทน */
  yearToDateEmployeeAssistanceFundBaht?: number;
}): PayrollWorkerWhtPrintVm {
  const { run, line, staff, company, periodLabel, issueDateYmd, paymentDateYmd } = input;

  const issueYear = Number(issueDateYmd.slice(0, 4)) || new Date().getFullYear();
  const documentNo = buildPayrollOfficeWhtDocumentNo(run.id, staff.staffCode, issueYear);

  const slip = buildPayslipFromOfficeLine(line, run, company ?? undefined, input.payslipPayrollTypeLabelOverride);
  const grossAmount = round2(slip.grossTotal);
  const earningsRows = slip.incomeLines
    .filter((x) => (Number(x.amount) || 0) !== 0)
    .map((x) => ({ label: x.label, amount: round2(Number(x.amount) || 0) }));
  const deductionsRows = slip.deductionLines
    .filter((x) => (Number(x.amount) || 0) !== 0)
    .map((x) => ({ label: x.label, amount: round2(Number(x.amount) || 0) }));

  const totalDeductions = round2(slip.deductionsTotal);
  const netPaidAmount = round2(slip.netPay);
  const wht = pitAmountOffice(line);

  const thaiId = (staff.nationalId || '').trim();
  const taxIdField = (staff.taxId || '').trim();
  const taxIdDisplay = thaiId || taxIdField || '—';
  const taxIdIsPassport = false;

  const disp = company?.whtCertificateDisplay;
  const payerAddrTh = combineAddressTh(company);
  const branchIsHeadOffice = company?.branchType !== 'branch';

  const pitZeroNote =
    wht <= 0.005 ? 'ไม่มีภาษีหัก ณ ที่จ่ายในงวดนี้ (แสดงยอดภาษี 0.00)' : undefined;

  const yearToDateSocialSecurityBaht =
    input.yearToDateSocialSecurityBaht != null && Number.isFinite(input.yearToDateSocialSecurityBaht)
      ? round2(input.yearToDateSocialSecurityBaht)
      : officePayrollLineSocialSecurityAmount(line);
  const yearToDateEmployeeAssistanceFundBaht =
    input.yearToDateEmployeeAssistanceFundBaht != null && Number.isFinite(input.yearToDateEmployeeAssistanceFundBaht)
      ? round2(input.yearToDateEmployeeAssistanceFundBaht)
      : officePayrollLineEmployeeAssistanceFundAmount(line);

  return {
    documentNo,
    issueDateYmd,
    paymentDateYmd: paymentDateYmd || issueDateYmd,
    payrollPeriodLabel: periodLabel,
    batchReference: run.id,
    subtitleTh: 'สำหรับเงินได้จากการจ้างงาน / เงินเดือนพนักงานออฟฟิศ',

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
      displayName: (staff.fullName || '').trim() || line.staffName,
      workerCode: staff.staffCode || staff.id,
      taxIdDisplay,
      taxIdIsPassport,
      nationality: undefined,
      positionLabel: line.positionTitle || staff.positionTitle || undefined,
      addressTh: (staff.address || '').trim() || undefined,
      bankName: (staff.bankName || '').trim() || undefined,
      bankAccountLast4:
        (staff.bankAccountNumber || '').replace(/\D/g, '').length >= 4
          ? (staff.bankAccountNumber || '').replace(/\D/g, '').slice(-4)
          : undefined,
    },

    incomeTypeCode: 'PAYROLL_WAGE',
    incomeTypeNameTh: 'เงินเดือน / ค่าจ้างพนักงาน',
    formTypeCode: 'PND1',

    earningsRows,
    deductionsRows,

    grossAmount,
    totalDeductions,
    netPaidAmount,

    taxableIncomeAmount: grossAmount,
    withholdingTaxAmount: wht,
    withholdingTaxRateDisplayTh: 'ตามการคำนวณ Payroll (พนักงานออฟฟิศ)',
    withholdingTaxWordsTh: amountToThaiBahtText(wht),
    pitZeroNote,

    certificateIncomeTotalBaht: grossAmount,
    yearToDateSocialSecurityBaht,
    yearToDateEmployeeAssistanceFundBaht,

    taxCondition: 'WITHHOLDING',
    paymentMethod: inferOfficePaymentMethod(staff),
    paymentReferenceNo: run.payrollRunNo,

    authorizedSignerName: disp?.authorizedSignerName,
    signerPosition: disp?.signerPosition,
    signatureImageUrl: disp?.signatureImageUrl,
    companyStampImageUrl: disp?.companyStampImageUrl || company?.documentHeaderStampUrl?.trim() || undefined,

    issuedByName: disp?.authorizedSignerName,

    documentStatusLabel: 'PREVIEW',
    xmlExportStatus: 'NOT_EXPORTED',
  };
}

export function validatePayrollOfficeWhtPrint(input: {
  company: CompanyDocumentProfileForPayrollWht | null;
  staff: OfficeStaff | null;
  run: OfficePayrollRun | null;
  line: OfficePayrollLine | null;
  paymentDateYmd: string | undefined;
  /** ข้อความ error เมื่อไม่พบทะเบียน — ค่าเริ่มต้น office_staff */
  staffRegistry?: 'office_staff' | 'executive_payroll_staff';
}): PayrollWorkerWhtValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reg = input.staffRegistry ?? 'office_staff';

  const { company, staff, run, line, paymentDateYmd } = input;

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

  if (!staff) {
    errors.push(
      reg === 'executive_payroll_staff'
        ? 'ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่พบข้อมูลจากทะเบียน executive_payroll_staff (หรือผูก linkedOfficeStaffId กับ office_staff เพื่อดึงเลขบัตร/ที่อยู่)'
        : 'ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่พบข้อมูลพนักงานจากทะเบียน office_staff',
    );
  } else {
    if (!(staff.fullName || '').trim()) {
      errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: พนักงานยังไม่มีชื่อสำหรับแสดงในเอกสาร');
    }
    const nidDigits = (staff.nationalId || '').replace(/\D/g, '');
    const tidDigits = (staff.taxId || '').replace(/\D/g, '');
    if (reg === 'executive_payroll_staff' && nidDigits.length !== 13) {
      errors.push(
        'ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ผู้บริหารต้องมีเลขบัตรประชาชน 13 หลัก (กรอกในทะเบียนผู้บริหาร หรือผูก linkedOfficeStaffId เพื่อดึงจากทะเบียน office_staff)',
      );
    } else if (reg !== 'executive_payroll_staff' && nidDigits.length !== 13 && tidDigits.length !== 13) {
      errors.push(
        'ไม่สามารถออกใบหัก ณ ที่จ่ายได้: พนักงานต้องมีเลขบัตรประชาชน 13 หลักหรือเลขผู้เสียภาษี 13 หลักในระบบ',
      );
    }
    if (!(staff.address || '').trim() || (staff.address || '').trim().length < 5) {
      errors.push(
        reg === 'executive_payroll_staff'
          ? 'ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ยังไม่มีที่อยู่ครบในระบบ (กรอกในทะเบียนผู้บริหาร หรือผูก linkedOfficeStaffId เพื่อดึงจาก office_staff)'
          : 'ไม่สามารถออกใบหัก ณ ที่จ่ายได้: พนักงานยังไม่มีที่อยู่ครบในระบบ',
      );
    }
  }

  if (!run || !(run.id || '').trim()) {
    errors.push(
      reg === 'executive_payroll_staff'
        ? 'ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่พบงวดเงินเดือนผู้บริหาร'
        : 'ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่พบงวดเงินเดือนออฟฟิศ',
    );
  }

  if (!line) {
    errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่พบข้อมูลบรรทัดจ่ายของพนักงาน');
  } else {
    const gross = round2(Number(line.grossPay) || 0);
    if (gross <= 0) {
      errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่มียอดรายได้รวมในงวดนี้');
    }
    const net = round2(Number(line.netPay) || 0);
    const ded = round2(Number(line.deductions) || 0);
    if (Math.abs(round2(gross - ded) - net) > 0.05) {
      errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ยอดสุทธิไม่ตรงกับยอดรายได้หักรายการหัก');
    }

    const wht = pitAmountOffice(line);
    if (wht <= 0.005) {
      warnings.push('ไม่มีภาษีหัก ณ ที่จ่ายในงวดนี้ — แสดงยอดภาษีเป็น 0.00');
    }
    const pitMode = line.hrLineAdjustments?.pitMode ?? 'SYSTEM';
    if (
      reg === 'executive_payroll_staff' &&
      (pitMode === 'MANUAL_PERCENT' || pitMode === 'MANUAL_AMOUNT') &&
      !(line.hrLineAdjustments?.pitManualIncomeLabel || '').trim()
    ) {
      errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ระบุชื่อรายการหัก ณ ที่จ่ายแบบกำหนดเองก่อนพิมพ์เอกสาร');
    }
    if (
      reg === 'executive_payroll_staff' &&
      pitMode === 'MANUAL_PERCENT' &&
      ![5, 10, 15, 20, 25, 30, 35].includes(Number(line.hrLineAdjustments?.pitManualPercent))
    ) {
      errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: อัตราหักต้องเป็น 5, 10, 15, 20, 25, 30 หรือ 35%');
    }
  }

  if (!paymentDateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDateYmd)) {
    errors.push('ไม่สามารถออกใบหัก ณ ที่จ่ายได้: ไม่สามารถระบุวันที่จ่ายเงินจากข้อมูลงวด');
  }

  return { ok: errors.length === 0, errors, warnings };
}
