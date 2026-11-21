import type { APStatus } from '@/lib/types';
import { bangkokYmdFromUtcMs } from '@/lib/attendance/bangkok-calendar';

const OPEN_EPS = 0.005;

export function apAsOfYmd(nowMs: number = Date.now()): string {
  return bangkokYmdFromUtcMs(nowMs);
}

/** สถานะเจ้าหนี้ที่แสดง/กรอง/สรุป Overdue — คำนวณจาก dueDate จริง */
export function resolveApEffectiveStatus(
  item: {
    status?: APStatus | string | null;
    dueDate?: string | null;
    outstandingAmount?: number | null;
    creditAmount?: number | null;
  },
  asOfYmd: string = apAsOfYmd(),
): APStatus {
  const outstanding = Number(item.outstandingAmount) || 0;
  if (outstanding <= OPEN_EPS) return 'PAID';

  const stored = String(item.status || 'OPEN').toUpperCase() as APStatus;
  const due = String(item.dueDate || '').trim().slice(0, 10);
  const pastDue = /^\d{4}-\d{2}-\d{2}$/.test(due) && due < asOfYmd;

  if (pastDue) return 'OVERDUE';

  if (stored === 'OVERDUE') {
    const credit = Number(item.creditAmount) || 0;
    return credit > OPEN_EPS ? 'PARTIALLY_PAID' : 'OPEN';
  }

  if (stored === 'PARTIALLY_PAID' || stored === 'OPEN' || stored === 'PAID') {
    return stored === 'PAID' ? (outstanding > OPEN_EPS ? 'OPEN' : 'PAID') : stored;
  }

  const credit = Number(item.creditAmount) || 0;
  return credit > OPEN_EPS ? 'PARTIALLY_PAID' : 'OPEN';
}
