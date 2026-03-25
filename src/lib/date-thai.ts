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
