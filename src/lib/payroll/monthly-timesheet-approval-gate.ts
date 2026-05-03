import { collection, getDocs, limit, query, where, type Firestore } from 'firebase/firestore';
import type { PayrollPeriod } from '@/lib/types';

/** ดึง yyyy-MM จากวันเริ่มรอบบัญชี */
export function calendarYearMonthFromPeriodStart(startDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  return startDate.slice(0, 7);
}

/** รอบที่สร้างจากขั้นปิดสรุปรายเดือน — บังคับตรวจว่ามีเอกสารอนุมัติแล้ว */
export function shouldGatePayrollOnMonthlyApproval(period: PayrollPeriod): boolean {
  return period.cycleType === 'MONTHLY';
}

/**
 * มีอย่างน้อยหนึ่งเอกสารสรุปลงเวลารายเดือนในเดือนนั้นที่ถือว่าปิดงวดทางเอกสารแล้ว — พร้อมทำ Payroll รายเดือน
 * - รับทั้ง ล็อกงวด (entry_locked), ส่งตรวจ (pending_manager_review), และอนุมัติแล้ว (approved)
 * - หลัก: po_month_timesheet_reviews (PO + เดือน)
 * - รองรับ legacy: wave_month_timesheet_reviews
 */
export async function hasApprovedMonthlyTimesheetForYearMonth(
  db: Firestore,
  yearMonth: string,
): Promise<boolean> {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false;

  const q1 = query(
    collection(db, 'po_month_timesheet_reviews'),
    where('yearMonth', '==', yearMonth),
    limit(120),
  );
  const q2 = query(
    collection(db, 'wave_month_timesheet_reviews'),
    where('yearMonth', '==', yearMonth),
    limit(120),
  );
  const [poSnap, waveSnap] = await Promise.all([getDocs(q1), getDocs(q2)]);

  const monthlyGateOk = (status: unknown) =>
    status === 'approved' || status === 'entry_locked' || status === 'pending_manager_review';

  if (poSnap.docs.some((d) => monthlyGateOk(d.data()?.status))) return true;
  if (waveSnap.docs.some((d) => monthlyGateOk(d.data()?.status))) return true;
  return false;
}
