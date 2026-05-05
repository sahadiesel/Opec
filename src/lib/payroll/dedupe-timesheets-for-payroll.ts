import type { DailyTimesheet } from '@/lib/types';

/** ลายเดียวกันสำหรับตัดสินว่าเป็น “ซ้ำวัน” จากการสร้างเอกสารคู่ขนาน */
function timesheetPayrollFingerprint(ts: DailyTimesheet): string {
  return [
    String(ts.eventType || ''),
    String(ts.normalHours ?? ''),
    String(ts.ot15Hours ?? 0),
    String(ts.ot20Hours ?? 0),
    String(ts.ot30Hours ?? 0),
    String(ts.workMode || ''),
    String(ts.purchaseOrderId || '').trim(),
    String(ts.poLineId || '').trim(),
  ].join('|');
}

/**
 * ตัดแถวซ้ำก่อนคิด payroll / แสดงตารางรายวัน
 * — id ซ้ำใน sourceTimesheetIds หรือเอกสารซ้ำคนละ id แต่ worker + assignment + date เดียวกัน
 */
export function dedupeDailyTimesheetsForPayroll(tsList: readonly DailyTimesheet[]): DailyTimesheet[] {
  const seenId = new Set<string>();
  const seenLogical = new Set<string>();
  const sorted = [...tsList].sort(
    (a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)),
  );
  const out: DailyTimesheet[] = [];
  for (const ts of sorted) {
    const id = String(ts.id || '').trim();
    if (!id || seenId.has(id)) continue;
    seenId.add(id);
    const wid = String(ts.workerId || '').trim();
    const aid = String(ts.assignmentId || '').trim();
    const d = String(ts.date || '').trim();
    const logical = `${wid}\0${aid}\0${d}`;
    if (seenLogical.has(logical)) continue;
    seenLogical.add(logical);
    out.push(ts);
  }
  return out;
}

/**
 * รวมใบงานที่เป็นคนละเอกสารแต่ **วันเดียวกัน + ลายการทำงานเดียวกัน**
 * (เช่น assignmentId ต่างกันเพราะสร้างซ้ำ / merge mob ไม่ครบ) — เก็บหนึ่งแถว โดยเลือกใบที่มี assignmentId ชัดก่อน
 */
export function collapseDuplicateWorkerDayTimesheets(tsList: readonly DailyTimesheet[]): DailyTimesheet[] {
  const byDay = new Map<string, DailyTimesheet[]>();
  for (const ts of tsList) {
    const wid = String(ts.workerId || '').trim();
    const d = String(ts.date || '').trim();
    const k = `${wid}\0${d}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(ts);
  }
  const merged: DailyTimesheet[] = [];
  for (const group of byDay.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const fp = timesheetPayrollFingerprint(sorted[0]);
    const allSame = sorted.every((t) => timesheetPayrollFingerprint(t) === fp);
    if (allSame) {
      const withAsgn = sorted.filter((t) => String(t.assignmentId || '').trim());
      merged.push(withAsgn.length ? withAsgn[0] : sorted[0]);
    } else {
      merged.push(...sorted);
    }
  }
  return merged.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
}

/** ใช้ก่อนคิด payroll / แสดงตารางรายคน — id ซ้ำ + logical ซ้ำ + ซ้ำวันลายเดียวกัน */
export function normalizeTimesheetsForPayrollLine(tsList: readonly DailyTimesheet[]): DailyTimesheet[] {
  return collapseDuplicateWorkerDayTimesheets(dedupeDailyTimesheetsForPayroll(tsList));
}
