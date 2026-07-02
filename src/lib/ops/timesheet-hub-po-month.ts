import type { Assignment, PoMonthTimesheetReview, PurchaseOrder, Wave } from '@/lib/types';
import {
  assignmentPassesPoMonthOverlapFallbackGate,
  isYmdWithinAssignmentMobTimesheetWindow,
} from '@/lib/constants/timesheet-ui';
import { poMonthTimesheetReviewDocId } from '@/lib/timesheet/po-month-timesheet-bridge';

/** รายเดือน yyyy-MM ที่ช่วงวันที่ [start,end] ครอบคลุม */
export function yearMonthsTouchingDateRange(startYmd: string | undefined, endYmd: string | undefined): string[] {
  const s = (startYmd || '').slice(0, 10);
  const e = (endYmd || startYmd || '').slice(0, 10);
  if (!s) return [];
  const startYm = s.slice(0, 7);
  const endYm = e.slice(0, 7);
  const [y0, m0] = startYm.split('-').map(Number);
  const out: string[] = [];
  let y = y0;
  let m = m0;
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key === endYm) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** รายเดือนปฏิทิน (yyyy-MM) ที่ Wave ทับช่วง [startDate, endDate] */
export function yearMonthsCoveredByWave(w: Wave): string[] {
  return yearMonthsTouchingDateRange(w.startDate, w.endDate);
}

/** งวดปฏิทินที่ mobilization (assignment) ครอบคลุม — ใช้จัด hub ลงเวลาแบบไม่อิง Wave */
export function yearMonthsForPoAssignments(
  assignments: readonly Pick<Assignment, 'poId' | 'startDate' | 'endDate'>[],
  poId: string,
): string[] {
  const u = new Set<string>();
  for (const a of assignments) {
    if (a.poId !== poId) continue;
    for (const ym of yearMonthsTouchingDateRange(a.startDate, a.endDate)) u.add(ym);
  }
  return [...u].sort((a, b) => a.localeCompare(b));
}

/** งวด yyyy-MM ที่ครอบคลุมจาก mobilization ของหลาย PO ในชุด PO Active เดียวกัน (+ alwaysIncludeYm เช่น เดือนปัจจุบัน) */
export function yearMonthsForBundleAssignments(
  assignments: readonly Pick<Assignment, 'poId' | 'startDate' | 'endDate'>[],
  poIds: readonly string[],
  alwaysIncludeYm?: string,
): string[] {
  const idSet = new Set(poIds.filter(Boolean));
  if (!idSet.size) return alwaysIncludeYm && /^\d{4}-\d{2}$/.test(alwaysIncludeYm) ? [alwaysIncludeYm] : [];
  const u = new Set<string>();
  for (const a of assignments) {
    if (!idSet.has(a.poId)) continue;
    for (const ym of yearMonthsTouchingDateRange(a.startDate, a.endDate)) u.add(ym);
  }
  if (alwaysIncludeYm && /^\d{4}-\d{2}$/.test(alwaysIncludeYm)) u.add(alwaysIncludeYm);
  return [...u].sort((a, b) => a.localeCompare(b));
}

export function assignmentOverlapsYearMonth(
  a: Pick<Assignment, 'startDate' | 'endDate'>,
  yearMonth: string,
): boolean {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false;
  const s = (a.startDate || '').slice(0, 10);
  const e = (a.endDate || a.startDate || '').slice(0, 10);
  if (!s) return false;
  const [y, mo] = yearMonth.split('-').map(Number);
  const lastD = new Date(y, mo, 0).getDate();
  const monthStart = `${yearMonth}-01`;
  const monthEnd = `${yearMonth}-${String(lastD).padStart(2, '0')}`;
  return s <= monthEnd && e >= monthStart;
}

/**
 * กระดาน PO รายวัน (โหมดกรองเดือน): รวมกรณี mobilization เริ่มงานในเดือนนั้น แต่ช่วงมอบหมาย start–end ไม่ทับเดือน
 * (เช่น endDate สั้นกว่าวันเริ่มงานจริง — ข้อมูลยัง sync ไม่ทัน)
 */
export function assignmentOverlapsYearMonthForPoDailyBoard(
  a: Pick<
    Assignment,
    | 'startDate'
    | 'endDate'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'mobLocationEndDate'
    | 'assignedDate'
    | 'unassignedAt'
    | 'readinessStatus'
    | 'deploymentStatus'
    | 'mobReadyToTravelAt'
  >,
  yearMonth: string,
): boolean {
  if (assignmentOverlapsYearMonth(a, yearMonth)) return true;
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false;
  if (!assignmentPassesPoMonthOverlapFallbackGate(a)) return false;
  const [y, mo] = yearMonth.split('-').map(Number);
  const lastD = new Date(y, mo, 0).getDate();
  const monthStart = `${yearMonth}-01`;
  const monthEnd = `${yearMonth}-${String(lastD).padStart(2, '0')}`;
  const mobStart = (a.mobWorkingStartDate || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(mobStart) && mobStart >= monthStart && mobStart <= monthEnd) {
    if (isYmdWithinAssignmentMobTimesheetWindow(a, mobStart)) return true;
  }
  const sb = (a.mobStandbyDate || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sb) && sb >= monthStart && sb <= monthEnd) {
    if (isYmdWithinAssignmentMobTimesheetWindow(a, sb)) return true;
  }
  if (isYmdWithinAssignmentMobTimesheetWindow(a, monthStart)) return true;
  if (isYmdWithinAssignmentMobTimesheetWindow(a, monthEnd)) return true;
  return false;
}

export function yearMonthsForPoWaves(waves: Wave[]): string[] {
  const u = new Set<string>();
  for (const w of waves) {
    for (const ym of yearMonthsCoveredByWave(w)) u.add(ym);
  }
  return [...u].sort((a, b) => a.localeCompare(b));
}

export function waveOverlapsYearMonth(w: Wave, yearMonth: string): boolean {
  return assignmentOverlapsYearMonth(
    { startDate: w.startDate, endDate: w.endDate },
    yearMonth,
  );
}

export function wavesForPoInYearMonth(waves: Wave[], yearMonth: string): Wave[] {
  return waves.filter((w) => waveOverlapsYearMonth(w, yearMonth));
}

/** รหัสอ้างอิงงวด timesheet รายเดือน (แสดงคู่กับรหัสคำสั่งจ้าง + yyyy-MM) */
export function formatPoMonthTimesheetDocLabel(po: Pick<PurchaseOrder, 'poCode'>, yearMonth: string): string {
  return `TS·${po.poCode}·${yearMonth}`;
}

/** ป้ายงวดเมื่อรวมหลาย PO ในชุด PO Active */
export function formatBundleMonthTimesheetDocLabel(poCodes: readonly string[], yearMonth: string): string {
  const codes = [...poCodes].filter(Boolean);
  const head = codes.slice(0, 2).join(', ');
  const extra = codes.length > 2 ? ` +${codes.length - 2}` : '';
  return `TS·ชุด·${head}${extra}·${yearMonth}`;
}

export function formatThaiYearMonthLabel(yearMonth: string, locale: string = 'th-TH'): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return '—';
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1, 15);
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/** สถานะงวด PO+เดือนที่แสดงในศูนย์ลงเวลา (ไม่รวมการจ่ายเงิน — ดู Payroll) */
export type TimesheetHubPoMonthPhase = 'recording' | 'pending_manager' | 'approved';

export function aggregateTimesheetHubPoMonthPhase(
  poIds: readonly string[],
  yearMonth: string,
  reviewByDocId: Map<string, PoMonthTimesheetReview>,
): TimesheetHubPoMonthPhase {
  if (!poIds.length || !/^\d{4}-\d{2}$/.test(yearMonth)) return 'recording';
  const pending = poIds.some(
    (pid) => reviewByDocId.get(poMonthTimesheetReviewDocId(pid, yearMonth))?.status === 'pending_manager_review',
  );
  if (pending) return 'pending_manager';
  const allApproved = poIds.every(
    (pid) => reviewByDocId.get(poMonthTimesheetReviewDocId(pid, yearMonth))?.status === 'approved',
  );
  if (allApproved) return 'approved';
  return 'recording';
}

/** มีเอกสาร PO+เดือนแล้ว (ล็อก/ส่งตรวจ/อนุมัติ/ถูกปฏิเสธ) — ไม่ควรโชว์ปุ่มแนว “ปิดงวด” เป็นครั้งแรกอีก */
export function anyPoMonthTimesheetDocStarted(
  poIds: readonly string[],
  yearMonth: string,
  reviewByDocId: Map<string, PoMonthTimesheetReview>,
): boolean {
  const started: PoMonthTimesheetReview['status'][] = [
  'entry_locked',
  'partially_closed',
  'pending_manager_review',
  'partially_approved',
    'approved',
    'rejected',
  ];
  return poIds.some((pid) => {
    const s = reviewByDocId.get(poMonthTimesheetReviewDocId(pid, yearMonth))?.status;
    return !!s && started.includes(s);
  });
}

export function timesheetHubPoMonthPhaseUi(phase: TimesheetHubPoMonthPhase): {
  title: string;
  subtitle?: string;
  badgeClassName: string;
  badgeVariant: 'default' | 'outline' | 'secondary';
} {
  switch (phase) {
    case 'approved':
      return {
        title: 'อนุมัติแล้ว',
        badgeClassName: 'bg-emerald-700 hover:bg-emerald-700 text-white border-transparent shadow-none',
        badgeVariant: 'default',
      };
    case 'pending_manager':
      return {
        title: 'รอผู้จัดการอนุมัติ',
        badgeClassName: 'bg-amber-600 hover:bg-amber-600 text-white border-transparent shadow-none',
        badgeVariant: 'default',
      };
    default:
      return {
        title: 'ระหว่างลงเวลา',
        subtitle: 'Active',
        badgeClassName: '',
        badgeVariant: 'outline',
      };
  }
}
