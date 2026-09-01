/** เหตุผลที่ HR ตั้งสวิตช์ «ไม่พร้อมทำงาน» (readinessManualHold / Not Ready to Work) */
export type WorkerNotReadyReasonCode = 'RESIGNED' | 'SUSPENDED' | 'SICK' | 'OTHER';

export const WORKER_NOT_READY_REASON_OPTIONS: ReadonlyArray<{
  code: WorkerNotReadyReasonCode;
  labelTh: string;
}> = [
  { code: 'RESIGNED', labelTh: 'ลาออก' },
  { code: 'SUSPENDED', labelTh: 'พักงาน' },
  { code: 'SICK', labelTh: 'เจ็บป่วย' },
  { code: 'OTHER', labelTh: 'อื่นๆ' },
];

export function workerNotReadyReasonLabelTh(code: WorkerNotReadyReasonCode | string | undefined): string {
  const found = WORKER_NOT_READY_REASON_OPTIONS.find((o) => o.code === code);
  return found?.labelTh ?? '';
}

/** ข้อความแสดงใต้สถานะ / กรอบเหตุผล */
export function formatWorkerNotReadyReasonDisplay(
  code: WorkerNotReadyReasonCode | string | undefined | null,
  note?: string | null,
): string {
  if (!code) return '';
  const base = workerNotReadyReasonLabelTh(code);
  if (!base) return '';
  if (code === 'OTHER') {
    const n = (note || '').trim();
    return n ? `อื่นๆ · ${n}` : 'อื่นๆ';
  }
  return base;
}

export function isWorkerNotReadyReasonCode(v: unknown): v is WorkerNotReadyReasonCode {
  return v === 'RESIGNED' || v === 'SUSPENDED' || v === 'SICK' || v === 'OTHER';
}
