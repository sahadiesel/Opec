import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { PayrollBatch, PayrollBatchLine, Worker, WorkerPaymentProfile } from '@/lib/types';

function csvEscape(value: string | number | undefined | null): string {
  const s = value === undefined || value === null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/** บังคับ Excel อ่านเป็นข้อความ (กันเลข 13 หลักกลายเป็น scientific notation) */
function csvExcelText(value: string | undefined | null): string {
  const s = (value ?? '').trim();
  if (!s) return '""';
  return `"\t${s.replace(/"/g, '""')}"`;
}

function pickNonEmpty(...values: Array<string | null | undefined>): string {
  for (const v of values) {
    const s = (v ?? '').trim();
    if (s) return s;
  }
  return '';
}

function registryFieldToString(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.trunc(raw));
  }
  return String(raw).trim();
}

export type WorkerPayrollBankCsvSource = {
  contactPhone?: string;
  thaiNationalId?: string;
  passportNo?: string;
  bankName?: string;
  bankAccountNumber?: string;
  paymentProfile?: Pick<
    WorkerPaymentProfile,
    'paymentMethod' | 'bankName' | 'accountNumber' | 'promptPayId' | 'accountName'
  > | null;
};

function resolveWorkerPayrollBankCsvFields(
  line: PayrollBatchLine,
  worker?: WorkerPayrollBankCsvSource,
): { phone: string; nationalId: string; bankName: string; accountNumber: string } {
  const snap = line.workerPaymentProfileSnapshot || {};
  const pp = worker?.paymentProfile;

  const phone = pickNonEmpty(worker?.contactPhone);
  const nationalId = pickNonEmpty(
    worker?.thaiNationalId,
    worker?.passportNo,
  );

  const bankName = pickNonEmpty(
    snap.bankName as string | undefined,
    pp?.bankName ?? undefined,
    worker?.bankName,
  );

  const accountNumber = pickNonEmpty(
    snap.accountNumber as string | undefined,
    pp?.accountNumber ?? undefined,
    worker?.bankAccountNumber,
    pp?.promptPayId ?? undefined,
    snap.promptPayId as string | undefined,
  );

  return { phone, nationalId, bankName, accountNumber };
}

export async function loadWorkerPayrollBankCsvSources(
  firestore: Firestore,
  workerIds: string[],
): Promise<Map<string, WorkerPayrollBankCsvSource>> {
  const uniqueIds = [...new Set(workerIds.filter(Boolean))];
  const out = new Map<string, WorkerPayrollBankCsvSource>();

  await Promise.all(
    uniqueIds.map(async (workerId) => {
      try {
        const [workerSnap, ppSnap] = await Promise.all([
          getDoc(doc(firestore, 'workers', workerId)),
          getDocs(
            query(
              collection(firestore, 'worker_payment_profiles'),
              where('workerId', '==', workerId),
              where('status', '==', 'ACTIVE'),
              limit(1),
            ),
          ),
        ]);

        const w = workerSnap.exists() ? (workerSnap.data() as Worker) : null;
        const pp = ppSnap.empty ? null : (ppSnap.docs[0].data() as WorkerPaymentProfile);

        out.set(workerId, {
          contactPhone: registryFieldToString(w?.contactPhone),
          thaiNationalId: registryFieldToString(w?.thaiNationalId),
          passportNo: registryFieldToString(w?.passportNo),
          bankName: pickNonEmpty(w?.bankName),
          bankAccountNumber: registryFieldToString(w?.bankAccountNumber),
          paymentProfile: pp
            ? {
                paymentMethod: pp.paymentMethod,
                bankName: pp.bankName ?? undefined,
                accountNumber: pp.accountNumber ?? undefined,
                promptPayId: pp.promptPayId ?? undefined,
                accountName: pp.accountName ?? undefined,
              }
            : null,
        });
      } catch {
        /* skip row */
      }
    }),
  );

  return out;
}

/**
 * รายงานรวมสำหรับตรวจโอน payroll ธนาคาร — ชื่อ เบอร์ ปชช. เลขบัญชี ยอด
 * (เบอร์/ปชช. จากทะเบียนคนงาน · ธนาคาร/บัญชี จาก snapshot งวด → payment profile → ทะเบียนคนงาน)
 */
export function buildWorkerPayrollBankVerificationCsv(
  batch: PayrollBatch,
  lines: PayrollBatchLine[],
  workersById: Map<string, WorkerPayrollBankCsvSource>,
): string {
  const sorted = [...lines].sort((a, b) =>
    (a.workerNameSnapshot || '').localeCompare(b.workerNameSnapshot || '', 'th'),
  );
  const header = [
    'ลำดับ',
    'ชื่อ-สกุล (snapshot)',
    'เบอร์โทร (ทะเบียน)',
    'เลขประจำตัวประชาชน',
    'ธนาคาร',
    'เลขที่บัญชี',
    'ยอดจ่ายสุทธิ',
    'Batch ID',
    'งวด',
  ];
  const rows = sorted.map((line, idx) => {
    const w = workersById.get(line.workerId);
    const { phone, nationalId, bankName, accountNumber } = resolveWorkerPayrollBankCsvFields(line, w);
    return [
      csvEscape(idx + 1),
      csvEscape(line.workerNameSnapshot),
      csvExcelText(phone),
      csvExcelText(nationalId),
      csvEscape(bankName),
      csvExcelText(accountNumber),
      csvEscape(line.netAmount ?? 0),
      csvEscape(batch.id),
      csvEscape(batch.payrollPeriodId),
    ].join(',');
  });
  return ['\ufeff' + header.map(csvEscape).join(','), ...rows].join('\r\n');
}
