/**
 * Snapshot แถวรายวันบน PayrollBatchLine — เปิดหน้ารายคนโชว์ทันทีโดยไม่โหลด daily_timesheets
 * ห้ามใส่ค่า undefined (Firestore WriteBatch.set ไม่รับ)
 */
import type { DailyTimesheet, PayrollBatchLineDailyRowSnapshot } from '@/lib/types';

export function buildPayrollLineDailyRowSnapshots(
  timesheets: readonly DailyTimesheet[],
  timesheetGrossById: Record<string, number> | undefined,
): PayrollBatchLineDailyRowSnapshot[] {
  const sorted = [...timesheets].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return sorted.map((ts) => {
    const id = String(ts.id || '').trim();
    const amount = Number(timesheetGrossById?.[id]);
    const row: PayrollBatchLineDailyRowSnapshot = {
      timesheetId: id,
      date: String(ts.date || '').slice(0, 10),
      eventType: ts.eventType,
      normalHours: Math.max(0, Number(ts.normalHours) || 0),
      amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0,
    };
    const workMode = String(ts.workMode || '').trim();
    if (workMode) row.workMode = workMode;
    const ot15 = Math.max(0, Number(ts.ot15Hours) || 0);
    const ot20 = Math.max(0, Number(ts.ot20Hours) || 0);
    const ot30 = Math.max(0, Number(ts.ot30Hours) || 0);
    const holiday = Math.max(0, Number(ts.holidayHours) || 0);
    if (ot15 > 0) row.ot15Hours = ot15;
    if (ot20 > 0) row.ot20Hours = ot20;
    if (ot30 > 0) row.ot30Hours = ot30;
    if (holiday > 0) row.holidayHours = holiday;
    const poId = (ts.purchaseOrderId || '').trim();
    if (poId) row.purchaseOrderId = poId;
    const remark = (ts.remark || '').trim();
    if (remark) row.remark = remark;
    return row;
  });
}
