import type { OfficeStaff } from '@/lib/types';
import type { OfficeLeaveEntitlementsDoc } from '@/lib/attendance/types';
import type {
  OfficeLeaveRequestDoc,
  OfficeLeaveType,
  OfficeLeaveYearSummary,
} from './types';

/** Firestore collection name for office leave requests */
export const OFFICE_LEAVE_REQUESTS_COLLECTION = 'leave_requests';

/** ลาพักร้อนเปิดสิทธิ์เมื่อทำงานครบ 365 วัน นับจาก `office_staff.startDate` */
export const OFFICE_VACATION_ELIGIBILITY_DAYS = 365;

export const OFFICE_LEAVE_TYPE_LABELS: Record<OfficeLeaveType, string> = {
  SICK: 'ลาป่วย',
  PERSONAL: 'ลากิจ',
  VACATION: 'ลาพักร้อน',
};

export const OFFICE_LEAVE_STATUS_LABELS: Record<
  OfficeLeaveRequestDoc['status'],
  string
> = {
  DRAFT: 'ฉบับร่าง',
  SUBMITTED: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

const ALL_LEAVE_TYPES: OfficeLeaveType[] = ['SICK', 'PERSONAL', 'VACATION'];

/** วันที่เริ่มงาน (epoch ms ใน Bangkok) — ใช้นับอายุงาน */
function parseStartDateMsBkk(dateStr?: string | null): number | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const ymd = dateStr.slice(0, 10);
  const ms = Date.parse(`${ymd}T00:00:00+07:00`);
  return Number.isFinite(ms) ? ms : null;
}

/** จำนวนวันที่ทำงานต่อเนื่องจาก startDate ถึง now (Bangkok) — ปัดลง */
export function tenureDays(staff: Pick<OfficeStaff, 'startDate'>, now: number = Date.now()): number {
  const startMs = parseStartDateMsBkk(staff.startDate);
  if (startMs === null) return 0;
  const diff = now - startMs;
  if (diff <= 0) return 0;
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

/** สิทธิ์ลาพักร้อนเปิดเมื่อ tenure ≥ 365 วัน */
export function isEligibleForVacation(
  staff: Pick<OfficeStaff, 'startDate'>,
  now: number = Date.now(),
): boolean {
  return tenureDays(staff, now) >= OFFICE_VACATION_ELIGIBILITY_DAYS;
}

/** วันที่จะมีสิทธิ์ลาพักร้อน (ISO `YYYY-MM-DD`) — ใช้แสดงใน My Profile */
export function vacationEligibleFromDate(
  staff: Pick<OfficeStaff, 'startDate'>,
): string | null {
  const startMs = parseStartDateMsBkk(staff.startDate);
  if (startMs === null) return null;
  const ms = startMs + OFFICE_VACATION_ELIGIBILITY_DAYS * 24 * 60 * 60 * 1000;
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/** จำนวนวันสิทธิ์ตั้งต้นจาก HR settings — ลาพักร้อน = 0 ถ้ายังไม่ครบ 365 วัน */
export function entitlementForStaff(
  staff: Pick<OfficeStaff, 'startDate'>,
  cfg: Pick<
    OfficeLeaveEntitlementsDoc,
    'sickDaysPerYear' | 'personalDaysPerYear' | 'annualVacationDaysPerYear'
  > | null,
  now: number = Date.now(),
): Record<OfficeLeaveType, number> {
  const sick = Math.max(0, Number(cfg?.sickDaysPerYear) || 0);
  const personal = Math.max(0, Number(cfg?.personalDaysPerYear) || 0);
  const vacationCfg = Math.max(0, Number(cfg?.annualVacationDaysPerYear) || 0);
  const vacation = isEligibleForVacation(staff, now) ? vacationCfg : 0;
  return { SICK: sick, PERSONAL: personal, VACATION: vacation };
}

/** จำนวนวันที่ลา (รวม start–end inclusive); ครึ่งวัน = 0.5 */
export function computeRequestedDays(
  startDate: string,
  endDate: string,
  isHalfDay: boolean,
): number {
  if (isHalfDay) return 0.5;
  const a = Date.parse(`${startDate.slice(0, 10)}T00:00:00+07:00`);
  const b = Date.parse(`${endDate.slice(0, 10)}T00:00:00+07:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

/** สรุปคำขอของพนักงานในปีหนึ่ง — แยกอนุมัติแล้ว vs ยังรอ */
export function summarizeYear(
  staff: OfficeStaff,
  year: number,
  requests: OfficeLeaveRequestDoc[],
  cfg: Pick<
    OfficeLeaveEntitlementsDoc,
    'sickDaysPerYear' | 'personalDaysPerYear' | 'annualVacationDaysPerYear'
  > | null,
  now: number = Date.now(),
): OfficeLeaveYearSummary {
  const approved: Record<OfficeLeaveType, number> = { SICK: 0, PERSONAL: 0, VACATION: 0 };
  const pending: Record<OfficeLeaveType, number> = { SICK: 0, PERSONAL: 0, VACATION: 0 };
  for (const r of requests) {
    if (r.staffId !== staff.id) continue;
    if (r.year !== year) continue;
    const days = Number(r.days) || 0;
    if (r.status === 'APPROVED') approved[r.leaveType] += days;
    else if (r.status === 'SUBMITTED') pending[r.leaveType] += days;
  }
  return {
    staff,
    year,
    approvedDays: approved,
    pendingDays: pending,
    entitlement: entitlementForStaff(staff, cfg, now),
  };
}

export function leaveTypesForStaff(
  staff: Pick<OfficeStaff, 'startDate'>,
  now: number = Date.now(),
): OfficeLeaveType[] {
  if (isEligibleForVacation(staff, now)) return ALL_LEAVE_TYPES;
  return ALL_LEAVE_TYPES.filter((t) => t !== 'VACATION');
}
