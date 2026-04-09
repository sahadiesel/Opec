import type { PayrollBatch, PayrollBatchLine, Worker } from '@/lib/types';

function csvEscape(value: string | number | undefined | null): string {
  const s = value === undefined || value === null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * รายงานรวมสำหรับตรวจโอน payroll ธนาคาร — ชื่อ เบอร์ ปชช. เลขบัญชี ยอด (ข้อมูลเบอร์/ปชช. จากทะเบียนคนงาน ณ เวลา export)
 */
export function buildWorkerPayrollBankVerificationCsv(
  batch: PayrollBatch,
  lines: PayrollBatchLine[],
  workersById: Map<string, Pick<Worker, 'contactPhone' | 'thaiNationalId'>>
): string {
  const sorted = [...lines].sort((a, b) =>
    (a.workerNameSnapshot || '').localeCompare(b.workerNameSnapshot || '', 'th')
  );
  const header = [
    'ลำดับ',
    'ชื่อ-สกุล (snapshot)',
    'เบอร์โทร (ทะเบียน)',
    'เลขประจำตัวประชาชน',
    'ธนาคาร (snapshot)',
    'เลขที่บัญชี (snapshot)',
    'ยอดจ่ายสุทธิ',
    'Batch ID',
    'งวด',
  ];
  const rows = sorted.map((line, idx) => {
    const w = workersById.get(line.workerId);
    const snap = line.workerPaymentProfileSnapshot || {};
    const bankName = (snap.bankName as string | undefined) ?? '';
    const acct = (snap.accountNumber as string | undefined) ?? '';
    return [
      csvEscape(idx + 1),
      csvEscape(line.workerNameSnapshot),
      csvEscape(w?.contactPhone ?? ''),
      csvEscape(w?.thaiNationalId ?? ''),
      csvEscape(bankName),
      csvEscape(acct),
      csvEscape(line.netAmount ?? 0),
      csvEscape(batch.id),
      csvEscape(batch.payrollPeriodId),
    ].join(',');
  });
  return ['\ufeff' + header.map(csvEscape).join(','), ...rows].join('\r\n');
}
