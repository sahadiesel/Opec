const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** แปลง HH:mm → นาทีจากเที่ยงคืน (null ถ้าผิดรูปแบบ) */
export function parseAttendanceHm(hm: string | null | undefined): number | null {
  if (!hm || typeof hm !== 'string') return null;
  const m = TIME_RE.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

/** ปรับ input เป็น HH:mm มาตรฐาน */
export function normalizeAttendanceHmInput(hm: string | null | undefined): string | null {
  const min = parseAttendanceHm(hm);
  if (min === null) return null;
  const h = Math.floor(min / 60);
  const mi = min % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function formatAttendanceHm(totalMin: number): string {
  const rem = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(rem / 60);
  const mi = rem % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** ชั่วโมง OT จากช่วงเวลา (end ต้องหลัง start ในวันเดียวกัน) */
export function otHoursFromHmRange(startHm: string, endHm: string): number | null {
  const startMin = parseAttendanceHm(startHm);
  const endMin = parseAttendanceHm(endHm);
  if (startMin === null || endMin === null || endMin <= startMin) return null;
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

export function formatAttendanceHmRange(startHm: string, endHm: string): string {
  const s = normalizeAttendanceHmInput(startHm) ?? startHm;
  const e = normalizeAttendanceHmInput(endHm) ?? endHm;
  return `${s} – ${e}`;
}
