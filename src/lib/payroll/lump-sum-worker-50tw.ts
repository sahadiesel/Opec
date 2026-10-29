/**
 * หนังสือรับรองหัก ณ ที่จ่ายลูกจ้างแบบเหมา — ใช้แบบฟอร์ม ม.50 ทวิ ชุดเดียวกับจัดซื้อ
 */
import type {
  PayrollBatch,
  PayrollBatchLine,
  PaymentMethod,
  Worker,
  WithholdingCertificateCopyVariant,
  WithholdingCertificateDocument,
} from '@/lib/types';
import {
  buildWithholdingCertificateDocumentHtml,
  type WithholdingCertificateDocumentPrintBaseOptions,
} from '@/lib/documents/withholding-certificate-50-tw-print';
import { buildWhtElectronicDataFromDocument, buildWhtPayerSnapshotFromCompany } from '@/lib/wht/wht-certificate-build';
import type { CompanyProfileWhtInput } from '@/lib/wht/wht-certificate-build';
import { DEFAULT_LUMP_SUM_WHT_RATE_PERCENT } from '@/lib/payroll/lump-sum-worker';
import {
  resolvePayrollWorkerWhtPaymentDateYmd,
  workerPayrollLineLumpSumWhtAmount,
} from '@/lib/payroll/payroll-worker-wht-model';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function workerDisplayName(w: Worker): string {
  const th = `${w.firstNameTh || ''} ${w.lastNameTh || ''}`.trim();
  if (th) return th;
  const full = `${w.firstName || ''} ${w.lastName || ''}`.trim();
  if (full) return full;
  return (w.nickname || '').trim() || w.workerCode || w.id;
}

function inferPaymentMethod(line: PayrollBatchLine): PaymentMethod {
  const m = line.workerPaymentProfileSnapshot?.paymentMethod;
  if (m === 'BANK_TRANSFER' || m === 'PROMPTPAY') return 'TRANSFER';
  if (m === 'CASH') return 'CASH';
  if (m === 'OTHER') return 'OTHER';
  return 'CASH';
}

export function buildLumpSumWorker50TwCertificate(input: {
  batch: PayrollBatch;
  line: PayrollBatchLine;
  worker: Worker;
  company: CompanyProfileWhtInput | null | undefined;
  periodLabel: string;
  issueDateYmd: string;
  paymentDateYmd?: string;
}): WithholdingCertificateDocument {
  const { batch, line, worker, company, periodLabel, issueDateYmd } = input;
  const gross = round2(Number(line.grossAmount) || 0);
  const wht = workerPayrollLineLumpSumWhtAmount(line);
  const rate =
    gross > 0.005 ? round2((wht / gross) * 100) : DEFAULT_LUMP_SUM_WHT_RATE_PERCENT;
  const net = round2(Number(line.netAmount) || Math.max(0, gross - wht));
  const paymentDateYmd =
    input.paymentDateYmd || resolvePayrollWorkerWhtPaymentDateYmd(batch, line) || issueDateYmd;

  const thaiId = (worker.thaiNationalId || '').trim();
  const passport = (worker.passportNo || '').trim();
  const foreign = !thaiId && !!passport;
  const disp = company?.whtCertificateDisplay;
  const payer = buildWhtPayerSnapshotFromCompany(company);
  const payee: WithholdingCertificateDocument['payee'] = {
    displayName: workerDisplayName(worker),
    taxId: thaiId || undefined,
    branchType: 'HEAD_OFFICE',
    addressTh: (worker.address || '').trim() || '—',
    vendorCategory: foreign ? 'FOREIGN' : 'INDIVIDUAL',
    countryCode: foreign ? undefined : 'TH',
  };

  const now = Date.now();
  const paid = batch.status === 'PAID' || batch.status === 'LOCKED';
  const core: Omit<WithholdingCertificateDocument, 'whtElectronicData'> & {
    whtElectronicData: WithholdingCertificateDocument['whtElectronicData'];
  } = {
    id: `lump-50tw-${batch.id}-${line.id}`,
    documentStatus: paid ? 'ISSUED' : 'DRAFT',
    xmlExportStatus: 'NOT_EXPORTED',
    certificateNo: paid ? `WHT-LS-${batch.id}-${line.workerId}`.slice(0, 40) : undefined,
    taxCondition: 'WITHHOLDING',
    incomeTypeCode: 'SERVICE_CONTRACT',
    incomeTypeDisplayTh: 'ค่าจ้างทำของ / ค่าบริการ (ลูกจ้างแบบเหมา)',
    withholdingIncomeCode: 'SERVICE_CONTRACT',
    formTypeCode: 'PND3',
    withholdingFormType: 'PND3',
    payer,
    payee,
    amountBeforeVat: gross,
    vatAmount: 0,
    grossAmount: gross,
    withholdingTaxBase: gross,
    withholdingTaxRatePercent: rate,
    withholdingTaxAmount: wht,
    netPaidAmount: net,
    paymentDate: paymentDateYmd,
    paymentIssueDate: issueDateYmd,
    paymentMethod: inferPaymentMethod(line),
    bankName: (worker.bankName || '').trim() || undefined,
    bankAccountLast4: (worker.bankAccountNumber || '').replace(/\s/g, '').slice(-4) || undefined,
    paymentReferenceNo: batch.id,
    referenceVendorBillNo: batch.id,
    referencePurchaseNo: periodLabel,
    referencePaymentNo: batch.id,
    jobDescription: `ค่าแรงลูกจ้างแบบเหมา · งวด ${periodLabel} · ${line.workerNameSnapshot || workerDisplayName(worker)}`,
    sourceVendorBillId: line.id,
    sourcePurchaseId: batch.id,
    sourceCashbookEntryId: line.financePayoutCashbookEntryId,
    authorizedSignerName: disp?.authorizedSignerName,
    signerPosition: disp?.signerPosition,
    signatureImageUrl: disp?.showSignatureImage !== false ? disp?.signatureImageUrl : undefined,
    companyStampImageUrl: disp?.showCompanyStamp ? disp?.companyStampImageUrl : undefined,
    createdAt: now,
    createdByUid: '',
    updatedAt: now,
    issuedAt: paid ? line.financePaidAt || batch.lockedAt : undefined,
    whtElectronicData: {},
  };
  core.whtElectronicData = {
    ...buildWhtElectronicDataFromDocument({ ...core, certificateNo: core.certificateNo }),
    xmlExportStatus: 'NOT_EXPORTED',
    currencyCode: 'THB',
    exchangeRate: 1,
  };
  return core;
}

export function lumpSumWorker50TwPrintBase(input: {
  printedByName: string;
  printedAtMs?: number;
  showSignatureImage?: boolean;
  showCompanyStamp?: boolean;
  showSystemGeneratedNote?: boolean;
}): WithholdingCertificateDocumentPrintBaseOptions {
  return {
    official: false,
    printedByName: input.printedByName,
    printedAtMs: input.printedAtMs ?? Date.now(),
    showSignatureImage: input.showSignatureImage !== false,
    showCompanyStamp: input.showCompanyStamp === true,
    showSystemGeneratedNote: input.showSystemGeneratedNote !== false,
  };
}

export function buildLumpSumWorker50TwPrintHtml(
  cert: WithholdingCertificateDocument,
  variants: WithholdingCertificateCopyVariant[],
  base: WithholdingCertificateDocumentPrintBaseOptions,
): string {
  const list =
    variants.length > 0
      ? variants
      : (['COPY_PAYEE_TAX_RETURN'] as WithholdingCertificateCopyVariant[]);
  if (list.length === 1) {
    return buildWithholdingCertificateDocumentHtml(cert, { ...base, copyVariant: list[0] });
  }
  const pages = list.map((copyVariant) =>
    buildWithholdingCertificateDocumentHtml(cert, { ...base, copyVariant }),
  );
  const firstHead = pages[0].match(/<head[^>]*>([\s\S]*)<\/head>/i)?.[1] ?? '';
  const bodies = pages.map((html) => html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? '');
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"/>${firstHead}</head><body>${bodies.join('')}</body></html>`;
}
