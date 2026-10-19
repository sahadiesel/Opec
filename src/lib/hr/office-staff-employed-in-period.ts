import { normalizeStaffDateYmd } from '@/lib/payroll/office-staff-date-ymd';

const BE_YEAR_OFFSET = 543;

function monthBounds(ceYear: number, month: number): { start: string; end: string } {
  const m = String(month).padStart(2, '0');
  const last = new Date(ceYear, month, 0).getDate();
  return {
    start: `${ceYear}-${m}-01`,
    end: `${ceYear}-${m}-${String(last).padStart(2, '0')}`,
  };
}

function employmentOverlapsRange(
  startYmd: string | null,
  endYmd: string | null,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  if (startYmd && startYmd > rangeEnd) return false;
  if (endYmd && endYmd < rangeStart) return false;
  return true;
}

function rangeOverlapsLeaveFilter(
  startYmd: string | null,
  endYmd: string | null,
  yearBe: 'ALL' | number,
  month: 'ALL' | number,
): boolean {
  if (yearBe === 'ALL' && month === 'ALL') return true;

  if (typeof yearBe === 'number' && typeof month === 'number') {
    const bounds = monthBounds(yearBe - BE_YEAR_OFFSET, month);
    return employmentOverlapsRange(startYmd, endYmd, bounds.start, bounds.end);
  }

  if (typeof yearBe === 'number') {
    const y = yearBe - BE_YEAR_OFFSET;
    return employmentOverlapsRange(startYmd, endYmd, `${y}-01-01`, `${y}-12-31`);
  }

  const m = month as number;
  const yStart = startYmd
    ? Number(startYmd.slice(0, 4))
    : endYmd
      ? Number(endYmd.slice(0, 4))
      : new Date().getFullYear();
  const yEnd = endYmd ? Number(endYmd.slice(0, 4)) : yStart + 1;
  for (let y = yStart; y <= yEnd; y++) {
    const bounds = monthBounds(y, m);
    if (employmentOverlapsRange(startYmd, endYmd, bounds.start, bounds.end)) return true;
  }
  return false;
}

/**
 * หน้าจัดการการลา — แสดงชื่อเมื่อช่วงที่เลือกยังทับวันจ้าง
 * มีหลายรอบการจ้างให้ดูทุกครั้ง เดือนที่ลาออกยังแสดงได้ เดือนถัดจากวันสิ้นสุดไม่แสดง
 */
export function officeStaffEmployedInLeaveFilterPeriod(
  staff: {
    startDate?: unknown;
    employmentEndDate?: unknown;
    employmentTenures?: Array<{ startDate?: unknown; endDate?: unknown }> | null;
  },
  yearBe: 'ALL' | number,
  month: 'ALL' | number,
): boolean {
  if (yearBe === 'ALL' && month === 'ALL') return true;
  const ranges = (staff.employmentTenures ?? [])
    .map((t) => ({
      start: normalizeStaffDateYmd(t.startDate),
      end: normalizeStaffDateYmd(t.endDate),
    }))
    .filter((t) => t.start);
  if (ranges.length > 0) {
    return ranges.some((t) => rangeOverlapsLeaveFilter(t.start, t.end, yearBe, month));
  }
  return rangeOverlapsLeaveFilter(
    normalizeStaffDateYmd(staff.startDate),
    normalizeStaffDateYmd(staff.employmentEndDate),
    yearBe,
    month,
  );
}
