import type { DailyTimesheet, JobMode } from '@/lib/types';

/** id = customerId__yyyy-MM__ONSHORE|OFFSHORE */
export function customerMonthTimesheetDocId(
  customerId: string,
  yearMonth: string,
  workMode: JobMode,
): string {
  const cid = (customerId || '').trim();
  const ym = (yearMonth || '').trim();
  if (!cid || !/^\d{4}-\d{2}$/.test(ym)) return '';
  if (workMode !== 'ONSHORE' && workMode !== 'OFFSHORE') return '';
  return `${cid}__${ym}__${workMode}`;
}

export function parseCustomerMonthTimesheetDocId(
  id: string,
): { customerId: string; yearMonth: string; workMode: JobMode } | null {
  const parts = id.split('__');
  if (parts.length !== 3) return null;
  const [customerId, yearMonth, wm] = parts;
  if (!customerId || !/^\d{4}-\d{2}$/.test(yearMonth)) return null;
  if (wm !== 'ONSHORE' && wm !== 'OFFSHORE') return null;
  return { customerId, yearMonth, workMode: wm };
}

/**
 * สรุปคู่ (ลูกค้า, โหมด) จากรายวันในเดือน — ไม่ซ้ำ
 */
export function deriveCustomerWorkModeKeysFromDailies(
  rows: readonly Pick<DailyTimesheet, 'customerId' | 'workMode' | 'purchaseOrderId'>[],
): { customerId: string; workMode: JobMode }[] {
  const seen = new Set<string>();
  const out: { customerId: string; workMode: JobMode }[] = [];
  for (const r of rows) {
    const cid = (r.customerId || '').trim();
    const wm = r.workMode;
    if (!cid || (wm !== 'ONSHORE' && wm !== 'OFFSHORE')) continue;
    const k = `${cid}|${wm}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ customerId: cid, workMode: wm });
  }
  out.sort((a, b) => {
    const c = a.customerId.localeCompare(b.customerId);
    if (c !== 0) return c;
    return a.workMode.localeCompare(b.workMode);
  });
  return out;
}

/** นับจำนวนแถวรายวันต่อคู่ลูกค้า+โหมด */
export function countDailiesByCustomerWorkMode(
  rows: readonly Pick<DailyTimesheet, 'customerId' | 'workMode'>[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const cid = (r.customerId || '').trim();
    const wm = r.workMode;
    if (!cid || (wm !== 'ONSHORE' && wm !== 'OFFSHORE')) continue;
    const k = `${cid}|${wm}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
