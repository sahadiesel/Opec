import type { Assignment, PurchaseOrder, Wave } from '@/lib/types';

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

export function formatThaiYearMonthLabel(yearMonth: string, locale: string = 'th-TH'): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return '—';
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1, 15);
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}
