/**
 * Calendar helpers in Asia/Bangkok for attendance summaries.
 */

const BKK_TZ = 'Asia/Bangkok';

/** YYYY-MM-DD in Bangkok for instant `ms` */
export function bangkokYmdFromUtcMs(ms: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BKK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return '';
  return `${y}-${m}-${d}`;
}

/** Epoch ms at given Bangkok local wall time (interpret `ymd` + `hh:mm` in +07). */
export function utcMsFromBangkokYmdAndHm(ymd: string, hm: string): number | null {
  const hmTrim = (hm || '').trim();
  const mHm = /^(\d{1,2}):(\d{2})$/.exec(hmTrim);
  if (!mHm) return null;
  let hh = Number(mHm[1]);
  const mm = Number(mHm[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const ymdTrim = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymdTrim)) return null;
  const isoLocal = `${ymdTrim}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
  const d = new Date(`${isoLocal}+07:00`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

export function formatBangkokHmFromUtcMs(ms: number): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BKK_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(new Date(ms));
}

/** Enumerate YYYY-MM-DD strings for each calendar day in the same month as `monthAnchor` (local JS date). */
export function enumerateYmDsForMonth(monthAnchor: Date): string[] {
  const y = monthAnchor.getFullYear();
  const m0 = monthAnchor.getMonth();
  const lastDay = new Date(y, m0 + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const out: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    out.push(`${y}-${pad(m0 + 1)}-${pad(d)}`);
  }
  return out;
}

/**
 * Monday=1 … Sunday=7 — calendar weekday for Bangkok date `ymd` (YYYY-MM-DD).
 * Uses noon Bangkok (= 05:00 UTC, Thailand has no DST).
 */
export function bangkokIsoWeekdayFromYmd(ymd: string): number {
  const [y, mo, d] = ymd.split('-').map(Number);
  if (!y || !mo || !d) return NaN;
  const j = new Date(Date.UTC(y, mo - 1, d, 5, 0, 0)).getUTCDay();
  return j === 0 ? 7 : j;
}

export function isBangkokWeekendYmd(ymd: string): boolean {
  const iso = bangkokIsoWeekdayFromYmd(ymd);
  return iso === 6 || iso === 7;
}

/**
 * วันหยุดประจำสัปดาห์แบบยืดหยุ่น — อิงค่าจาก HR Settings (`weeklyRestPattern`)
 *  - 'sat_sun'      → เสาร์ + อาทิตย์ เป็นวันหยุด
 *  - 'sunday_only'  → เฉพาะอาทิตย์เป็นวันหยุด (เสาร์เป็นวันทำงาน)
 *  - 'none'         → ไม่มีวันหยุดประจำสัปดาห์ (วันทำงาน 7 วัน)
 */
export type WeeklyRestPatternForCalendar = 'none' | 'sat_sun' | 'sunday_only';

export function isBangkokWeeklyRestDayYmd(
  ymd: string,
  pattern: WeeklyRestPatternForCalendar,
): boolean {
  const iso = bangkokIsoWeekdayFromYmd(ymd);
  if (pattern === 'sat_sun') return iso === 6 || iso === 7;
  if (pattern === 'sunday_only') return iso === 7;
  return false;
}

/** ป้ายชื่อวันหยุดประจำสัปดาห์สำหรับ UI (เช่น "เสาร์–อาทิตย์", "อาทิตย์", "ไม่มี") */
export function weeklyRestPatternLabelTh(pattern: WeeklyRestPatternForCalendar): string {
  if (pattern === 'sat_sun') return 'เสาร์–อาทิตย์';
  if (pattern === 'sunday_only') return 'อาทิตย์';
  return 'ไม่มี (ทำงานทุกวัน)';
}
