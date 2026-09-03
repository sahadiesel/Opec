/**
 * Snapshot แถวรายวันบน PayrollBatchLine — เปิดหน้ารายคนโชว์ทันทีโดยไม่โหลด daily_timesheets
 * ห้ามใส่ค่า undefined (Firestore WriteBatch.set ไม่รับ)
 */
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type { DailyTimesheet, PayrollBatchLineDailyRowSnapshot, Position } from '@/lib/types';
import { resolvePositionDisplayName } from '@/lib/payroll/work-day-payslip-split';
import {
  resolvePayrollRestDay,
  type PayrollRestDaySchedule,
} from '@/lib/payroll/package-labor-cost';

export type DailySnapshotPositionLookup = ReadonlyMap<
  string,
  Pick<Position, 'positionName' | 'positionNameTh' | 'positionNameEn'>
>;

export function buildPayrollLineDailyRowSnapshots(
  timesheets: readonly DailyTimesheet[],
  timesheetGrossById: Record<string, number> | undefined,
  opts?: {
    posById?: DailySnapshotPositionLookup;
    /** HR rest schedule — ติด restDayKind ให้สลิปแยกวันหยุดนักขัตฤกษ์ได้ */
    payrollRestSchedule?: PayrollRestDaySchedule;
  },
): PayrollBatchLineDailyRowSnapshot[] {
  const sorted = [...timesheets].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return sorted.map((ts) => {
    const id = String(ts.id || '').trim();
    const amount = Number(timesheetGrossById?.[id]);
    const date = String(ts.date || '').slice(0, 10);
    const row: PayrollBatchLineDailyRowSnapshot = {
      timesheetId: id,
      date,
      eventType: ts.eventType,
      normalHours: Math.max(0, Number(ts.normalHours) || 0),
      amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0,
    };
    const workMode = String(ts.workMode || '').trim();
    if (workMode) row.workMode = workMode;
    const positionId = String(ts.positionId || '').trim();
    if (positionId) {
      row.positionId = positionId;
      const posName = resolvePositionDisplayName(opts?.posById?.get(positionId));
      if (posName) row.positionNameSnapshot = posName;
    }
    const ot15 = Math.max(0, Number(ts.ot15Hours) || 0);
    const ot20 = Math.max(0, Number(ts.ot20Hours) || 0);
    const ot30 = Math.max(0, Number(ts.ot30Hours) || 0);
    const holiday = Math.max(0, Number(ts.holidayHours) || 0);
    if (ot15 > 0) row.ot15Hours = ot15;
    if (ot20 > 0) row.ot20Hours = ot20;
    if (ot30 > 0) row.ot30Hours = ot30;
    if (holiday > 0) row.holidayHours = holiday;
    if (opts?.payrollRestSchedule && ts.eventType === 'work_day') {
      const rest = resolvePayrollRestDay(date, opts.payrollRestSchedule);
      if (rest.kind === 'public_holiday' || rest.kind === 'weekly_rest') {
        row.restDayKind = rest.kind;
      }
    }
    const poId = (ts.purchaseOrderId || '').trim();
    if (poId) row.purchaseOrderId = poId;
    const remark = (ts.remark || '').trim();
    if (remark) row.remark = remark;
    return row;
  });
}

/** รวมยอดใน snapshot รายวัน */
export function sumDailyRowSnapshotAmounts(
  snaps: readonly PayrollBatchLineDailyRowSnapshot[] | null | undefined,
): number {
  if (!snaps?.length) return 0;
  let s = 0;
  for (const r of snaps) {
    const n = Number(r?.amount);
    if (Number.isFinite(n) && n > 0) s += n;
  }
  return Math.round(s * 100) / 100;
}

/**
 * snapshot ใช้โชว์ได้เมื่อมียอดรายวันจริง
 * (กันงวดเก่าที่ถูก backfill เป็นแถวยอด 0 ทั้งตาราง ทั้งที่ gross รวม > 0)
 */
export function isUsableDailyRowSnapshots(
  snaps: readonly PayrollBatchLineDailyRowSnapshot[] | null | undefined,
  lineGrossAmount?: number | null,
): boolean {
  if (!snaps?.length) return false;
  const daySum = sumDailyRowSnapshotAmounts(snaps);
  if (daySum > 0.005) return true;
  const g = Number(lineGrossAmount);
  return !(Number.isFinite(g) && g > 0.005);
}

export function hasPositiveTimesheetGrossById(
  timesheetGrossById: Record<string, number> | null | undefined,
): boolean {
  if (!timesheetGrossById) return false;
  return Object.values(timesheetGrossById).some((n) => Number(n) > 0.005);
}

/** ข้อความเมื่อ reconstruct จากใบงานปัจจุบันไม่เท่ากับยอดที่จ่าย/ล็อกแล้ว */
export const SNAPSHOT_BACKFILL_MISMATCH_NOTE =
  'อาจมีการเปลี่ยนแปลงอย่างใดอย่างหนึ่งที่ทำให้การ generate ใหม่ไม่เท่ากับตัวเลขเดิม';

export function payrollBahtAmountsMatch(a: number, b: number): boolean {
  const x = Math.round(Number(a) * 100) / 100;
  const y = Math.round(Number(b) * 100) / 100;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) <= 0.02;
}

/** งวดเก่าที่ยังไม่มียอดรายวัน — ลอง reconstruct ครั้งแรกที่เปิด (ถ้าตรงยอดที่จ่ายแล้วจึงเก็บ) */
export function lineNeedsFirstOpenSnapshotBackfill(line: {
  dailyRowSnapshots?: readonly PayrollBatchLineDailyRowSnapshot[] | null;
  grossAmount?: number | null;
  timesheetGrossById?: Record<string, number> | null;
  snapshotBackfillStatus?: string | null;
} | null | undefined): boolean {
  if (!line) return false;
  if (line.snapshotBackfillStatus === 'mismatch') return false;
  if (isUsableDailyRowSnapshots(line.dailyRowSnapshots, line.grossAmount)) return false;
  if (hasPositiveTimesheetGrossById(line.timesheetGrossById)) return false;
  const g = Number(line.grossAmount);
  return Number.isFinite(g) && g > 0.005;
}

/** โหลดใบงานตาม id อย่างเดียว — ใช้ซ่อม dailyRowSnapshots ของงวดเก่าโดยไม่สแกนทั้งเดือน */
export async function loadDailyTimesheetsByIds(
  db: Firestore,
  timesheetIds: readonly string[],
): Promise<DailyTimesheet[]> {
  const unique = [
    ...new Set(timesheetIds.map((id) => String(id || '').trim()).filter(Boolean)),
  ];
  if (unique.length === 0) return [];
  const rows = await Promise.all(
    unique.map(async (tid) => {
      const snap = await getDoc(doc(db, 'daily_timesheets', tid));
      if (!snap.exists()) return null;
      return { id: snap.id, ...(snap.data() as object) } as DailyTimesheet;
    }),
  );
  return rows
    .filter((ts): ts is DailyTimesheet => !!ts)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}
