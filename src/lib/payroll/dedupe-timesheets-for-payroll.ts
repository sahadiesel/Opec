import type { DailyTimesheet } from '@/lib/types';

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

/** คะแนนเลือกใบงานที่ “นับจ่าย” เมื่อมีหลายแถวคน+วัน (Mob clearance + PO Active auto ฯลฯ) */
function payrollTimesheetDayScore(ts: DailyTimesheet): number {
  let s = 0;
  const nh = Math.max(0, Number(ts.normalHours) || 0);
  if (nh > 0) s += 5000 + nh * 10;
  if (ts.eventType === 'work_day') s += 3000;
  else if (ts.eventType === 'standby_day') s += 1500;
  else if (ts.eventType === 'off_day_worked' || ts.eventType === 'public_holiday_worked') s += 2500;
  if (ts.status === 'LOCKED') s += 800;
  if (ts.readyForPayroll === true) s += 400;
  if (String(ts.assignmentId || '').trim()) s += 200;
  if (ts.poActiveAutoDaily === true) s += 700;
  const rmk = String(ts.remark ?? '');
  if (rmk.includes('Final clearance') && nh <= 0) s -= 3000;
  return s;
}

/** เลือกหนึ่งใบงานต่อคนต่อวัน — สอดคล้อง wave-month (ไม่ double-count) */
export function pickPreferredDailyTimesheetForPayrollDay(
  candidates: readonly DailyTimesheet[],
): DailyTimesheet {
  if (candidates.length <= 1) return candidates[0];
  return [...candidates].sort((a, b) => {
    const scoreDiff = payrollTimesheetDayScore(b) - payrollTimesheetDayScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    const updB = Number(b.updatedAt) || 0;
    const updA = Number(a.updatedAt) || 0;
    if (updB !== updA) return updB - updA;
    return String(b.id).localeCompare(String(a.id));
  })[0];
}

/**
 * รวมใบงานซ้ำ **คน + วัน** — เก็บหนึ่งแถว (remob / Mob clearance + PO Active auto แม้ PO หรือ assignment ต่างกัน)
 * สอดคล้อง `resolveTimesheetForWaveMonthCell` — ไม่ double-count ในคิด payroll
 */
export function collapseDuplicateWorkerDayTimesheets(tsList: readonly DailyTimesheet[]): DailyTimesheet[] {
  const byWorkerDate = new Map<string, DailyTimesheet[]>();
  for (const ts of tsList) {
    const wid = String(ts.workerId || '').trim();
    const d = String(ts.date || '').trim();
    if (!wid || !d) continue;
    const k = `${wid}\0${d}`;
    if (!byWorkerDate.has(k)) byWorkerDate.set(k, []);
    byWorkerDate.get(k)!.push(ts);
  }
  const merged = [...byWorkerDate.values()].map((group) =>
    group.length <= 1 ? group[0] : pickPreferredDailyTimesheetForPayrollDay(group),
  );
  return merged.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
}

/** ใช้ก่อนคิด payroll / แสดงตารางรายคน — id ซ้ำ + logical ซ้ำ + ซ้ำวันลายเดียวกัน */
export function normalizeTimesheetsForPayrollLine(tsList: readonly DailyTimesheet[]): DailyTimesheet[] {
  return collapseDuplicateWorkerDayTimesheets(dedupeDailyTimesheetsForPayroll(tsList));
}

/**
 * ก่อนวางบิลลูกค้า — ตัด id/logical ซ้ำ แต่**ไม่**ยุบคน+วันข้าม eventType
 * (กฎ payroll เลือก W ทับ SB ทำให้บรรทัด standby หายจากใบแจ้งหนี้)
 * แถวซ้ำคน+วัน+ตำแหน่ง+ประเภทวัน ตัดทีหลังใน `dedupeTimesheetsForBilling`
 */
export function normalizeTimesheetsForBillingLine(tsList: readonly DailyTimesheet[]): DailyTimesheet[] {
  return dedupeDailyTimesheetsForPayroll(tsList);
}
