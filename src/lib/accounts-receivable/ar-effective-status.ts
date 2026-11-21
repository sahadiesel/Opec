import type { ARStatus } from '@/lib/types';
import { bangkokYmdFromUtcMs } from '@/lib/attendance/bangkok-calendar';

const OPEN_EPS = 0.005;

/** วันนี้ (Asia/Bangkok) เป็น YYYY-MM-DD */
export function arAsOfYmd(nowMs: number = Date.now()): string {
  return bangkokYmdFromUtcMs(nowMs);
}

/**
 * สถานะลูกหนี้ที่แสดง/กรอง/สรุป Overdue — คำนวณจาก dueDate จริง
 * (เอกสารถูกสร้างเป็น OPEN และไม่มี cron  flip เป็น OVERDUE)
 */
export function resolveArEffectiveStatus(
  item: {
    status?: ARStatus | string | null;
    dueDate?: string | null;
    outstandingAmount?: number | null;
    creditAmount?: number | null;
  },
  asOfYmd: string = arAsOfYmd(),
): ARStatus {
  const outstanding = Number(item.outstandingAmount) || 0;
  if (outstanding <= OPEN_EPS) return 'PAID';

  const stored = String(item.status || 'OPEN').toUpperCase() as ARStatus;
  const due = String(item.dueDate || '').trim().slice(0, 10);
  const pastDue = /^\d{4}-\d{2}-\d{2}$/.test(due) && due < asOfYmd;

  if (pastDue) return 'OVERDUE';

  if (stored === 'OVERDUE') {
    // ยังไม่ครบกำหนด — คืน OPEN / PARTIAL ตามยอดรับ
    const credit = Number(item.creditAmount) || 0;
    return credit > OPEN_EPS ? 'PARTIALLY_PAID' : 'OPEN';
  }

  if (stored === 'PARTIALLY_PAID' || stored === 'OPEN' || stored === 'PAID') {
    return stored === 'PAID' ? (outstanding > OPEN_EPS ? 'OPEN' : 'PAID') : stored;
  }

  const credit = Number(item.creditAmount) || 0;
  return credit > OPEN_EPS ? 'PARTIALLY_PAID' : 'OPEN';
}

export function isArOverdueEffective(
  item: Parameters<typeof resolveArEffectiveStatus>[0],
  asOfYmd?: string,
): boolean {
  return resolveArEffectiveStatus(item, asOfYmd) === 'OVERDUE';
}
