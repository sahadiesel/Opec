import type { PurchaseOrder, Wave } from '@/lib/types';

/** รายเดือนปฏิทิน (yyyy-MM) ที่ Wave ทับช่วง [startDate, endDate] */
export function yearMonthsCoveredByWave(w: Wave): string[] {
  const s = (w.startDate || '').slice(0, 10);
  const e = (w.endDate || w.startDate || '').slice(0, 10);
  if (!s) return [];
  const startYm = s.slice(0, 7);
  const endYm = e.slice(0, 7);
  const [y0, m0] = startYm.split('-').map(Number);
  const [y1, m1] = endYm.split('-').map(Number);
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

export function yearMonthsForPoWaves(waves: Wave[]): string[] {
  const u = new Set<string>();
  for (const w of waves) {
    for (const ym of yearMonthsCoveredByWave(w)) u.add(ym);
  }
  return [...u].sort((a, b) => a.localeCompare(b));
}

export function waveOverlapsYearMonth(w: Wave, yearMonth: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false;
  const s = (w.startDate || '').slice(0, 10);
  const e = (w.endDate || w.startDate || '').slice(0, 10);
  if (!s) return false;
  const [y, mo] = yearMonth.split('-').map(Number);
  const lastD = new Date(y, mo, 0).getDate();
  const monthStart = `${yearMonth}-01`;
  const monthEnd = `${yearMonth}-${String(lastD).padStart(2, '0')}`;
  return s <= monthEnd && e >= monthStart;
}

export function wavesForPoInYearMonth(waves: Wave[], yearMonth: string): Wave[] {
  return waves.filter((w) => waveOverlapsYearMonth(w, yearMonth));
}

/** รหัสแสดงบน UI — ยึด PO + งวดเดือน (งวด timesheet รายเดือน; 1 งวดรวมหลาย wave) */
export function formatPoMonthTimesheetDocLabel(po: Pick<PurchaseOrder, 'poCode'>, yearMonth: string): string {
  return `TS·${po.poCode}·${yearMonth}`;
}

export function formatThaiYearMonthLabel(yearMonth: string, locale: string = 'th-TH'): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return '—';
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1, 15);
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}
