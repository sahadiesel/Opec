/**
 * ระบบวันที่มาตรฐานไทยสำหรับ UI และเอกสารในประเทศไทย
 * - แสดงเป็น dd/mm/yyyy โดยปีเป็น พ.ศ. (ค.ศ. + 543 สำหรับวันที่เก็บแบบ Gregorian)
 * - ค่าที่เก็บใน Firestore/สตริง ISO ยังใช้รูปแบบเดิมได้ — ใช้ฟังก์ชันนี้เฉพาะตอนแสดงผล
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDate(input: Date | number | string): Date | null {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(typeof input === 'number' ? input : input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** แปลง timestamp / ISO / Date → dd/mm/yyyy (พ.ศ.) */
export function formatDateThaiBE(input: Date | number | string | null | undefined): string {
  const d = toDate(input as Date | number | string);
  if (!d) return '';
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const yearBE = d.getFullYear() + 543;
  return `${pad2(day)}/${pad2(month)}/${yearBE}`;
}

export function formatOptionalDateThaiBE(
  input: Date | number | string | null | undefined,
  empty: string = '—'
): string {
  const s = formatDateThaiBE(input);
  return s === '' ? empty : s;
}

/** ช่วงวันที่สำหรับตาราง เช่น 23/03/2569 - 23/03/2570 */
export function formatDateRangeThaiBE(
  start: Date | number | string | null | undefined,
  end: Date | number | string | null | undefined,
  empty: string = '—'
): string {
  const a = formatDateThaiBE(start);
  const b = formatDateThaiBE(end);
  if (!a && !b) return empty;
  if (!a) return b;
  if (!b) return a;
  return `${a} - ${b}`;
}

/** วันเวลา (นาที) สำหรับ log — dd/mm/yyyy พ.ศ. HH:mm */
export function formatDateTimeThaiBE(input: Date | number | string | null | undefined): string {
  const d = toDate(input as Date | number | string);
  if (!d) return '';
  return `${formatDateThaiBE(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** เวลาเท่านั้น — HH:mm (local) ให้สอดคล้องกับ formatDateTimeThaiBE */
export function formatTimeThaiBE(input: Date | number | string | null | undefined): string {
  const d = toDate(input as Date | number | string);
  if (!d) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** สำหรับผูก `<input type="date" />` (ค่าเป็น yyyy-mm-dd ตามมาตรฐาน HTML) */
export function timestampToHtmlDateValue(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

/**
 * แปลงสตริงวันที่แบบ yyyy-mm-dd (local) ที่เก็บใน Firestore/HTML date input
 * → dd/mm/yyyy (พ.ศ.) สำหรับแสดงใน UI
 */
export function formatYmdLocalThaiBE(ymd: string | null | undefined, empty: string = '—'): string {
  const ms = htmlDateValueToTimestampMs(ymd?.trim() || '');
  if (ms == null) return empty;
  return formatDateThaiBE(ms);
}

/** ช่วงวันที่เก็บเป็น yyyy-mm-dd (local) → dd/mm พ.ศ. - dd/mm พ.ศ. */
export function formatYmdRangeThaiBE(
  start: string | null | undefined,
  end: string | null | undefined,
  empty: string = '—',
): string {
  const a = htmlDateValueToTimestampMs(start?.trim() || '');
  const b = htmlDateValueToTimestampMs(end?.trim() || '');
  return formatDateRangeThaiBE(
    a != null ? a : undefined,
    b != null ? b : undefined,
    empty,
  );
}

function formatPartForStoredDisplay(input: Date | number | string | null | undefined): string {
  if (input == null || input === '') return '';
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return formatYmdLocalThaiBE(input, '');
  }
  return formatDateThaiBE(input as Date | number | string);
}

/**
 * แสดงวันที่ที่เก็บเป็น yyyy-mm-dd (local), timestamp (ms), Date, หรือ ISO string → dd/mm/yyyy พ.ศ.
 */
export function formatStoredDateThaiBE(
  input: Date | number | string | null | undefined,
  empty: string = '—',
): string {
  const p = formatPartForStoredDisplay(input);
  return p === '' ? empty : p;
}

/** ช่วงวันที่สำหรับข้อมูลที่อาจเป็น yyyy-mm-dd หรือ timestamp */
export function formatStoredDateRangeThaiBE(
  start: Date | number | string | null | undefined,
  end: Date | number | string | null | undefined,
  empty: string = '—',
): string {
  const a = formatPartForStoredDisplay(start);
  const b = formatPartForStoredDisplay(end);
  if (!a && !b) return empty;
  if (!a) return b;
  if (!b) return a;
  return `${a} - ${b}`;
}

/** แปลง yyyy-mm-dd (local) → timestamp เที่ยงวัน — ใช้กับ DatePickerThaiBE โดยเก็บสตริงเดิมใน Firestore */
export function htmlDateValueToTimestampMs(iso: string | null | undefined): number | undefined {
  if (iso == null || iso === '') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? undefined : dt.getTime();
}

/** dd/mm/yyyy (ค.ศ.) — สำหรับเอกสารพิมพ์ภาษาอังกฤษ */
export function formatStoredDateGregorian(
  input: Date | number | string | null | undefined,
  empty: string = '—',
): string {
  const d = toDate(input as Date | number | string);
  if (!d) return empty;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatStoredDateRangeGregorian(
  start: Date | number | string | null | undefined,
  end: Date | number | string | null | undefined,
  empty: string = '—',
): string {
  const a = formatStoredDateGregorian(start, '');
  const b = formatStoredDateGregorian(end, '');
  if (a === '' && b === '') return empty;
  if (a === '') return b;
  if (b === '') return a;
  return `${a} – ${b}`;
}

/** วันที่+เวลา ค.ศ. สำหรับสแตมป์พิมพ์เอกสาร EN */
export function formatDateTimeGregorian(input: Date | number | string | null | undefined): string {
  const d = toDate(input as Date | number | string);
  if (!d) return '';
  return `${formatStoredDateGregorian(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const PAYROLL_YM = /^(\d{4})-(\d{2})$/;

/**
 * งวดเงินเดือนเก็บเป็น YYYY-MM → ชื่อเดือนอังกฤษแบบย่อ (Jan…Dec)
 * สำหรับคอลัมน์ "ประจำเดือน" ใน office payroll
 */
export function formatPayrollYearMonthEnAbbrev(ym: string | null | undefined, empty: string = '—'): string {
  const s = (ym || '').trim();
  const m = PAYROLL_YM.exec(s);
  if (!m) return empty;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return empty;
  const d = new Date(y, mo - 1, 1, 12, 0, 0, 0);
  return d.toLocaleDateString('en-US', { month: 'short' });
}

/** งวดเงินเดือน YYYY-MM → ชื่อเดือนไทย + ปี พ.ศ. เช่น พฤษภาคม 2569 */
export function formatPayrollYearMonthThaiBE(ym: string | null | undefined, empty: string = '—'): string {
  const s = (ym || '').trim();
  const m = PAYROLL_YM.exec(s);
  if (!m) return empty;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return empty;
  const d = new Date(y, mo - 1, 1, 12, 0, 0, 0);
  const monthTh = d.toLocaleDateString('th-TH', { month: 'long' });
  return `${monthTh} ${y + 543}`;
}

/** ช่วงงวด office payroll บนสลิป/เอกสาร — dd/mm/yyyy พ.ศ. และชื่อเดือนงวด */
export function formatOfficePayrollRunPeriodLabelThaiBE(
  run: { payrollPeriodStart?: string; payrollPeriodEnd?: string; payrollMonth?: string },
  empty: string = '—',
): string {
  const range = formatYmdRangeThaiBE(run.payrollPeriodStart, run.payrollPeriodEnd, '');
  const monthLabel = formatPayrollYearMonthThaiBE(run.payrollMonth, '');
  if (range && monthLabel && monthLabel !== '—') return `${range} (${monthLabel})`;
  if (range) return range;
  if (monthLabel && monthLabel !== '—') return monthLabel;
  return empty;
}
