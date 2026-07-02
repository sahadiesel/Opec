import { normalizeWorkerIdSet } from '@/lib/commercial/partial-po-month-billing';

import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  addDoc,
} from 'firebase/firestore';
import type {
  Assignment,
  DailyTimesheet,
  POLine,
  OtRulesSnapshot,
  Position,
  PurchaseOrder,
  RateConditionEventType,
  MainContract,
  JobMode,
  MobCycleBillingReview,
  TimesheetRetroAdjustment,
  PositionRate,
} from '@/lib/types';
import { isYmdWithinAssignmentMobTimesheetWindow } from '@/lib/constants/timesheet-ui';
import { normalizeTimesheetsForPayrollLine } from '@/lib/payroll/dedupe-timesheets-for-payroll';
import {
  resolveBillingMatrixEventDayRate,
  resolveBillingMatrixOtHourlyRate,
  resolveBillingSellWorkingDayRate,
} from '@/lib/commercial/position-rate-sell';
import {
  buildPoWorkModeMapFromPurchaseOrders,
  resolveEffectivePayrollJobMode,
} from '@/lib/payroll/timesheet-labor-base-cost';
import type { StatedPackageHours } from '@/lib/commercial/package-hourly-rate';
import { resolveSellRestDay, type SellRestDayResolution } from '@/lib/commercial/sell-rest-day';

export interface GeneratedBillingLine {
  description: string;
  referenceType: 'TIMESHEET';
  /** รวมตามตำแหน่ง — ไม่ผูกคนเดียว */
  workerId?: string;
  workerName?: string;
  positionId: string;
  eventType: string;
  timesheetIds: string[];
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface BillingLineGenerationResult {
  lines: GeneratedBillingLine[];
  totalAmount: number;
  timesheetCount: number;
  warnings: string[];
}

/** ตัวเลือกเพิ่มเติมสำหรับ `generateBillingLines` */
export interface GenerateBillingLinesOptions {
  /**
   * งวด PO+เดือน: จำกัดเฉพาะ wave ที่บันทึกใน `po_month_timesheet_reviews.relatedWaveIds`
   * — ว่างหรือไม่ส่ง = ดึงทุก wave ใต้ PO (พฤติกรรมเดิม)
   */
  poMonthWaveIds?: readonly string[] | null;
  /** Trip billing: จำกัดเฉพาะ mobCycleId ในชุดวางบิล */
  mobCycleIds?: readonly string[] | null;
  /** Trip billing + สัญญา tripBillMobDemobFee: จุด mob/demob ที่เลือกตอนสร้าง invoice */
  tripMobDemobLocationKey?: string;
  /** PO+เดือน partial: จำกัดเฉพาะคนงานในงวดนี้ */
  workerIds?: readonly string[] | null;
  /** PO+เดือน: ไม่รวมคนที่ออก invoice partial แล้ว (สร้างใบเต็มที่เหลือ) */
  excludeWorkerIds?: readonly string[] | null;
}

interface LineAcc {
  positionId: string;
  eventType: string;
  timesheetIds: string[];
  /** จำนวนคนที่มีส่วนร่วมในบรรทัดนี้ (สำหรับคำอธิบาย) */
  workerIds: Set<string>;
  totalAmount: number;
  totalQuantity: number;
}

type PushAccRow = {
  workerId?: string;
  positionId: string;
  eventType: string;
  timesheetIds: string[];
  amount: number;
  quantity: number;
};

function calcOtAmount(
  hours: number,
  sellRate: number,
  normalWorkHours: number,
  multiplier: number,
): number {
  if (hours <= 0 || normalWorkHours <= 0) return 0;
  const hourlyRate = sellRate / normalWorkHours;
  return hours * hourlyRate * multiplier;
}

/** Default OT multipliers when sales rate conditions do not define per-tier rules. */
const DEFAULT_OT_MULT = { ot15: 1.5, ot20: 2.0, ot30: 3.0 } as const;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function isUnpaidLeaveEvent(eventType: string | undefined | null): boolean {
  return String(eventType ?? '').trim() === 'unpaid_leave';
}

/**
 * วางบิลลูกค้า: หนึ่งคน + หนึ่งวันปฏิทิน + หนึ่งตำแหน่ง + หนึ่ง eventType = หนึ่งหน่วยนับ
 * (กันซ้ำเมื่อมีหลายเอกสาร daily_timesheets จาก mobilization/แก้ไขซ้ำ — ไม่คิดเงินสองครั้งในวันเดียวกัน)
 */
function dedupeTimesheetsForBilling(tsList: readonly DailyTimesheet[]): DailyTimesheet[] {
  const sorted = [...tsList].sort((a, b) => {
    const ua = a.updatedAt ?? a.createdAt ?? 0;
    const ub = b.updatedAt ?? b.createdAt ?? 0;
    if (ua !== ub) return ub - ua;
    return String(b.id).localeCompare(String(a.id));
  });
  const seen = new Set<string>();
  const out: DailyTimesheet[] = [];
  for (const ts of sorted) {
    const wid = String(ts.workerId || '').trim();
    const d = String(ts.date || '').trim();
    const pos = String(ts.positionId || '').trim();
    const ev = String(ts.eventType || '').trim();
    if (!wid || !d || !pos || !ev) continue;
    const k = `${wid}\0${d}\0${pos}\0${ev}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ts);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
}

function timesheetHasBillableOtHours(ts: DailyTimesheet): boolean {
  return (
    Math.max(0, Number(ts.ot15Hours) || 0) +
      Math.max(0, Number(ts.ot20Hours) || 0) +
      Math.max(0, Number(ts.ot30Hours) || 0) >
    0
  );
}

function isTripBillingTimesheetBillable(ts: DailyTimesheet): boolean {
  if (ts.readyForBilling === true) return true;
  if (ts.status === 'LOCKED') return true;
  return false;
}

/**
 * รวมชม. retro เข้า timesheet ชั่วคราวเพื่อคำนวณ **ใบแจ้งหนี้ลูกค้า (อัตราขาย)** เท่านั้น
 * — ไม่แก้ daily_timesheets ไม่กระทบ payroll (จ่ายลูกจ้างผ่าน priorPeriodAllowanceItems ในงวด applyPayrollYearMonth)
 */
function mergeRetroDeltasIntoTimesheets(
  timesheets: DailyTimesheet[],
  retros: readonly TimesheetRetroAdjustment[],
): DailyTimesheet[] {
  const byTsId = new Map<string, TimesheetRetroAdjustment[]>();
  for (const r of retros) {
    if (r.status === 'void') continue;
    const sid = String(r.sourceTimesheetId || '').trim();
    if (!sid) continue;
    const list = byTsId.get(sid) ?? [];
    list.push(r);
    byTsId.set(sid, list);
  }

  return timesheets.map((ts) => {
    const adj = byTsId.get(ts.id);
    if (!adj?.length) return ts;
    let o15 = Math.max(0, Number(ts.ot15Hours) || 0);
    let o20 = Math.max(0, Number(ts.ot20Hours) || 0);
    let o30 = Math.max(0, Number(ts.ot30Hours) || 0);
    for (const r of adj) {
      o15 += Math.max(0, Number(r.addedOt15Hours) || 0);
      o20 += Math.max(0, Number(r.addedOt20Hours) || 0);
      o30 += Math.max(0, Number(r.addedOt30Hours) || 0);
    }
    return { ...ts, ot15Hours: o15, ot20Hours: o20, ot30Hours: o30 };
  });
}

/** ใบงานต้นทางของ retro ที่อยู่ในรอบแต่ไม่ถูกดึงมา (เช่น LOCKED ก่อนแก้ readyForBilling) */
async function enrichTimesheetsForRetroSources(
  db: Firestore,
  timesheets: DailyTimesheet[],
  retros: readonly TimesheetRetroAdjustment[],
  periodStart: string,
  periodEnd: string,
): Promise<DailyTimesheet[]> {
  const byId = new Map(timesheets.map((t) => [t.id, t]));
  for (const r of retros) {
    if (r.status === 'void') continue;
    const sid = String(r.sourceTimesheetId || '').trim();
    if (!sid || byId.has(sid)) continue;
    const snap = await getDoc(doc(db, 'daily_timesheets', sid));
    if (!snap.exists()) continue;
    const ts = { id: snap.id, ...(snap.data() as object) } as DailyTimesheet;
    const d = String(ts.date || '').slice(0, 10);
    if (d < periodStart || d > periodEnd) continue;
    if (ts.eventType !== 'work_day') continue;
    byId.set(ts.id, ts);
  }
  return [...byId.values()];
}

/**
 * Trip billing — ตัด work_day ที่ไม่ใช่การทำงานจริงบนไซต์:
 * - วันเดียวกับ M1 (มี mobilization_day แล้ว)
 * - ตั้งแต่วัน D1 เป็นต้นไป
 * - แถว PO Active auto ที่ไม่มี OT (เติมช่องว่าง — ไม่ตรงตารางรายเดือน)
 */
export function filterTimesheetsForTripMobCycleBilling(
  timesheets: readonly DailyTimesheet[],
): { timesheets: DailyTimesheet[]; warnings: string[] } {
  const warnings: string[] = [];
  const mobDaysByWorker = new Map<string, Set<string>>();
  const d1DaysByWorker = new Map<string, Set<string>>();

  for (const ts of timesheets) {
    const wid = String(ts.workerId || '').trim();
    const d = String(ts.date || '').slice(0, 10);
    if (!wid || !d) continue;
    if (ts.eventType === 'mobilization_day') {
      const set = mobDaysByWorker.get(wid) ?? new Set<string>();
      set.add(d);
      mobDaysByWorker.set(wid, set);
    }
    if (ts.eventType === 'demobilization_day') {
      const set = d1DaysByWorker.get(wid) ?? new Set<string>();
      set.add(d);
      d1DaysByWorker.set(wid, set);
    }
  }

  let droppedMobOverlap = 0;
  let droppedAfterD1 = 0;
  let droppedAutoGap = 0;

  const out = timesheets.filter((ts) => {
    if (ts.eventType !== 'work_day') return true;
    const wid = String(ts.workerId || '').trim();
    const d = String(ts.date || '').slice(0, 10);
    if (!wid || !d) return true;

    if (mobDaysByWorker.get(wid)?.has(d)) {
      droppedMobOverlap++;
      return false;
    }

    const firstD1 = [...(d1DaysByWorker.get(wid) ?? [])].sort()[0];
    if (firstD1 && d >= firstD1) {
      droppedAfterD1++;
      return false;
    }

    if (ts.poActiveAutoDaily === true && !timesheetHasBillableOtHours(ts)) {
      droppedAutoGap++;
      return false;
    }

    return true;
  });

  if (droppedMobOverlap > 0) {
    warnings.push(
      `Trip billing: ตัด work_day ${droppedMobOverlap} วันที่ซ้ำกับ M1 — วางบิลเฉพาะ mobilization_day`,
    );
  }
  if (droppedAfterD1 > 0) {
    warnings.push(`Trip billing: ตัด work_day ${droppedAfterD1} วันที่อยู่ในช่วง D1 ขึ้นไป`);
  }
  if (droppedAutoGap > 0) {
    warnings.push(
      `Trip billing: ตัด work_day อัตโนมัติ ${droppedAutoGap} วัน (ไม่มี OT / ไม่ได้ลงในตาราง) — ไม่วางบิล`,
    );
  }

  return { timesheets: out, warnings };
}

/**
 * คำเตือนที่สร้างก่อนแก้ไข / ข้อมูล eventType มีช่องว่าง — ลาไม่จ่ายไม่คิดบิลอยู่แล้ว ไม่ต้องแสดง
 */
export function shouldOmitCommercialInvoiceGenerationWarning(warning: string): boolean {
  const t = String(warning);
  if (!t.includes('unpaid_leave')) return false;
  return (
    t.includes('ยังไม่รองรับในโหมด PO + สัญญา') ||
    t.includes('ไม่มี PO line สำหรับตำแหน่ง')
  );
}

function applySellRestMultiplier(
  amount: number,
  rest: SellRestDayResolution,
  bucket: 'normal' | 'ot',
): number {
  if (!rest.active) return amount;
  if (rest.kind === 'public_holiday') {
    return amount * Math.max(0, rest.publicHolidayWrap ?? 1);
  }
  const m =
    bucket === 'normal'
      ? Math.max(0, rest.weeklyNormalMult ?? 1)
      : Math.max(0, rest.weeklyOtMult ?? 1);
  return amount * m;
}

/**
 * work_day — ราคารายวันจากสัญญา/PO (แพ็ก 8 ชม. onshore / 12 ชม. offshore) × 1 คน-วันต่อแถว
 * OT แยกเฉพาะชม.ที่เกินแพ็ก (normalHours − statedHours) + ot15/20/30 — ไม่แตกชม.ปกติเป็นรายชม.
 */
function resolveStatedPackageHoursForBilling(
  poLine: POLine,
  workMode: JobMode,
): StatedPackageHours {
  const snap = poLine.normalWorkHoursSnapshot;
  if (snap === 12) return 12;
  if (snap === 8) return 8;
  return workMode === 'OFFSHORE' ? 12 : 8;
}

function sellOtMultiplierForBilling(
  poLine: POLine,
  mainContract: MainContract | undefined,
): number {
  return (
    Number(poLine.sellOtRulesSnapshot?.afterShift) ||
    Number(mainContract?.rateMultiplierPolicy?.sell?.otAfterShift) ||
    1.5
  );
}

function overflowOtEventType(sellOtMult: number): string {
  if (sellOtMult >= 2.5) return 'ot_3.0';
  if (sellOtMult >= 1.75) return 'ot_2.0';
  return 'ot_1.5';
}

function workDayFromDayRateBilling(
  ts: DailyTimesheet,
  poLine: POLine,
  mainContract: MainContract | undefined,
  map: Map<string, LineAcc>,
  workMode: JobMode,
  contractRate?: PositionRate,
) {
  const rateCtx = { poLine, workMode, contractRate };
  const sellRate = resolveBillingSellWorkingDayRate(rateCtx);
  if (sellRate <= 0) return;

  const statedHours = resolveStatedPackageHoursForBilling(poLine, workMode);
  const sellOtMult = sellOtMultiplierForBilling(poLine, mainContract);
  const matrixOtHourly = resolveBillingMatrixOtHourlyRate(rateCtx);

  const nh = Math.max(0, ts.normalHours || 0);
  const o15 = Math.max(0, ts.ot15Hours || 0);
  const o20 = Math.max(0, ts.ot20Hours || 0);
  const o30 = Math.max(0, ts.ot30Hours || 0);
  const overflowNormal = Math.max(0, nh - statedHours);

  if (nh <= 0 && o15 + o20 + o30 <= 0 && overflowNormal <= 0) return;

  const sellRest = resolveSellRestDay(ts.date, mainContract);
  const wid = ts.workerId;
  const pos = ts.positionId;
  const tid = [ts.id];
  const hourlyFromDayRate = sellRate / statedHours;
  const otHourlyBase = matrixOtHourly ?? hourlyFromDayRate;

  if (nh > 0) {
    let dayAmt = sellRate;
    if (sellRest.active && sellRest.kind === 'public_holiday') {
      dayAmt *= Math.max(0, sellRest.publicHolidayWrap ?? 1);
    } else if (sellRest.active && sellRest.kind === 'weekly_rest') {
      dayAmt *= Math.max(0, sellRest.weeklyNormalMult ?? 1);
    }
    pushAcc(map, accKey(pos, 'work_day', dayAmt), {
      workerId: wid,
      positionId: pos,
      eventType: 'work_day',
      timesheetIds: tid,
      amount: dayAmt,
      quantity: 1,
    });
  }

  const pushOtLine = (
    eventType: string,
    hours: number,
    rawAmount: number,
  ) => {
    if (hours <= 0 || rawAmount <= 0) return;
    const amt = applySellRestMultiplier(rawAmount, sellRest, 'ot');
    if (amt <= 0) return;
    const up = amt / hours;
    pushAcc(map, accKey(pos, eventType, up), {
      workerId: wid,
      positionId: pos,
      eventType,
      timesheetIds: tid,
      amount: amt,
      quantity: hours,
    });
  };

  if (matrixOtHourly != null) {
    if (overflowNormal > 0) {
      const overflowMult = sellOtMult / 1.5;
      pushOtLine(
        overflowOtEventType(sellOtMult),
        overflowNormal,
        overflowNormal * matrixOtHourly * overflowMult,
      );
    }
    if (o15 > 0) {
      pushOtLine('ot_1.5', o15, o15 * matrixOtHourly);
    }
    if (o20 > 0) {
      pushOtLine('ot_2.0', o20, o20 * matrixOtHourly * (2 / 1.5));
    }
    if (o30 > 0) {
      pushOtLine('ot_3.0', o30, o30 * matrixOtHourly * 2);
    }
    return;
  }

  if (overflowNormal > 0) {
    pushOtLine(
      overflowOtEventType(sellOtMult),
      overflowNormal,
      overflowNormal * otHourlyBase * sellOtMult,
    );
  }
  if (o15 > 0) {
    pushOtLine('ot_1.5', o15, o15 * otHourlyBase * 1.5);
  }
  if (o20 > 0) {
    pushOtLine('ot_2.0', o20, o20 * otHourlyBase * 2);
  }
  if (o30 > 0) {
    pushOtLine('ot_3.0', o30, o30 * otHourlyBase * 3);
  }
}

function accKey(
  positionId: string,
  eventType: string,
  unitPrice: number,
): string {
  const up = roundMoney(unitPrice);
  return `${positionId}__${eventType}__${up}`;
}

function pushAcc(map: Map<string, LineAcc>, key: string, row: PushAccRow) {
  let a = map.get(key);
  if (!a) {
    a = {
      positionId: row.positionId,
      eventType: row.eventType,
      timesheetIds: [],
      workerIds: new Set<string>(),
      totalAmount: 0,
      totalQuantity: 0,
    };
    map.set(key, a);
  }
  a.totalAmount += row.amount;
  a.totalQuantity += row.quantity;
  if (row.workerId) a.workerIds.add(row.workerId);
  if (!a.timesheetIds.includes(row.timesheetIds[0])) {
    a.timesheetIds.push(row.timesheetIds[0]);
  }
}

/**
 * ประเภทวัน flat รายวัน (ไม่ใช่ work_day): ฐานราคา/วัน จาก PO line × ตัวคูณขายตามสัญญาหลัก
 */
function poFallbackSellDayMultiplier(
  mainContract: MainContract | undefined,
  eventType: string,
  poOtRules: OtRulesSnapshot,
): number {
  const sell = mainContract?.rateMultiplierPolicy?.sell;
  const n = (v: number | undefined | null): number | null =>
    v != null && !Number.isNaN(Number(v)) ? Number(v) : null;

  switch (eventType) {
    case 'standby_day':
      return n(sell?.standby) ?? 1;
    case 'travel_day':
      return n(sell?.travel) ?? 1;
    case 'mobilization_day':
      return n(sell?.mobilization) ?? 1;
    case 'demobilization_day':
      return n(sell?.demobilization) ?? 1;
    case 'public_holiday_worked':
      return n(sell?.publicHoliday) ?? 1;
    case 'off_day_worked': {
      const fromContract = n(sell?.holiday);
      if (fromContract != null) return fromContract;
      return poOtRules.holiday ?? 1;
    }
    default:
      return 1;
  }
}

const PO_FALLBACK_FLAT_DAILY_EVENTS: RateConditionEventType[] = [
  'off_day_worked',
  'standby_day',
  'travel_day',
  'mobilization_day',
  'demobilization_day',
  'public_holiday_worked',
];

/** work_day ไม่ใช่ — คำนวณจาก PO line × ตัวคูณสัญญาเท่านั้น (ไม่ผ่าน sales term / rate_conditions) */
function billingNonWorkDayFromPoAndContract(
  ts: DailyTimesheet,
  poLine: POLine,
  mainContract: MainContract | undefined,
  map: Map<string, LineAcc>,
  warnings: string[],
  workMode: JobMode,
  contractRate?: PositionRate,
) {
  if (isUnpaidLeaveEvent(ts.eventType)) return;

  const rateCtx = { poLine, workMode, contractRate };
  const matrixDayRate = resolveBillingMatrixEventDayRate(
    rateCtx,
    ts.eventType as RateConditionEventType,
  );
  const sellRate =
    matrixDayRate ??
    resolveBillingSellWorkingDayRate(rateCtx);
  const otRules: OtRulesSnapshot = poLine.sellOtRulesSnapshot || {};
  const wid = ts.workerId;
  const pos = ts.positionId;
  const tid = [ts.id];

  if (PO_FALLBACK_FLAT_DAILY_EVENTS.includes(ts.eventType as RateConditionEventType)) {
    const mult =
      matrixDayRate != null
        ? 1
        : poFallbackSellDayMultiplier(mainContract, ts.eventType, otRules);
    const amt = sellRate * mult;
    pushAcc(map, accKey(pos, ts.eventType, amt), {
      workerId: wid,
      positionId: pos,
      eventType: ts.eventType,
      timesheetIds: tid,
      amount: amt,
      quantity: 1,
    });
    return;
  }

  warnings.push(
    `ข้าม (${ts.date}, ${ts.eventType}) — ยังไม่รองรับในโหมด PO + สัญญา`,
  );
}

async function loadPositionLabels(
  db: Firestore,
  positionIds: string[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(positionIds.filter(Boolean))];
  const map = new Map<string, string>();
  await Promise.all(
    uniq.map(async (pid) => {
      const snap = await getDoc(doc(db, 'positions', pid));
      if (snap.exists()) {
        const p = snap.data() as Position;
        const label = String(
          p.positionName || p.positionNameTh || p.positionNameEn || pid,
        ).trim();
        map.set(pid, label || pid);
      } else {
        map.set(pid, pid);
      }
    }),
  );
  return map;
}

function billingQuantityPhrase(acc: LineAcc): string {
  const nw = acc.workerIds.size;
  const q = acc.totalQuantity;
  const tsN = acc.timesheetIds.length;
  const workerBit = nw > 0 ? ` · พนักงาน ${nw} คน` : '';

  if (
    acc.eventType === 'ot_1.5' ||
    acc.eventType === 'ot_2.0' ||
    acc.eventType === 'ot_3.0' ||
    acc.eventType === 'sell_overflow_normal'
  ) {
    return `รวม ${q} ชม.${workerBit}`;
  }

  if (acc.eventType === 'work_day') {
    return `รวม ${q} คน-วัน${workerBit}`;
  }

  return `รวม ${q} คน-วัน${workerBit}`;
}

/** คำอธิบายบรรทัด — รวม person-day / จำนวนคนในวงเล็บ (Qty / Unit price / Amount แยกคอลัมน์) */
function descriptionForLine(acc: LineAcc, positionTitle: string): string {
  const title = positionTitle || acc.positionId;
  const qtyPhrase = billingQuantityPhrase(acc);
  switch (acc.eventType) {
    case 'work_day':
      return `${title} — ค่าแรงวันทำงาน (${qtyPhrase})`;
    case 'ot_1.5':
      return `${title} — OT x1.5 (${qtyPhrase})`;
    case 'ot_2.0':
      return `${title} — OT x2 (${qtyPhrase})`;
    case 'ot_3.0':
      return `${title} — OT x3 (${qtyPhrase})`;
    case 'off_day_worked':
      return `${title} — ทำงานวันหยุด (${qtyPhrase})`;
    case 'standby_day':
      return `${title} — สแตนด์บาย (${qtyPhrase})`;
    case 'travel_day':
      return `${title} — วันเดินทาง (${qtyPhrase})`;
    case 'public_holiday_worked':
      return `${title} — ทำงานวันหยุดนักขัตฤกษ์ (${qtyPhrase})`;
    case 'mobilization_day':
      return `${title} — โมบิไลเซชัน (${qtyPhrase})`;
    case 'demobilization_day':
      return `${title} — ดีโมบิไลเซชัน (${qtyPhrase})`;
    case 'sell_overflow_normal':
      return `${title} — ชม.ปกติเกินกรอบ 8 ชม. (ขาย) (${qtyPhrase})`;
    default:
      return `${title} — ${acc.eventType} (${qtyPhrase})`;
  }
}

/**
 * สร้างบรรทัดวางบิลจาก timesheet ที่อนุมัติแล้ว
 *
 * - **ฐานราคา:** `sellRateSnapshotOnshore` / `sellRateSnapshotOffshore` (fallback `sellRateSnapshot`) ตาม `workMode` ของ timesheet — กฎ OT จาก **PO line**
 * - **ตัวคูณวันทำงาน/วันหยุด/OT:** `MainContract.rateMultiplierPolicy.sell` + ปฏิทินวันหยุดฝั่งขายของสัญญา
 * - **ไม่ใช้** `sales_contract_terms` และ **ไม่ query** `rate_conditions` — ไม่ฟ้องเรื่อง “ไม่พบเงื่อนไขขาย” จาก sales term
 */
export async function generateBillingLines(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
  waveId?: string,
  options?: GenerateBillingLinesOptions,
): Promise<BillingLineGenerationResult> {
  const warnings: string[] = [];

  const poRef = doc(db, 'purchase_orders', poId);
  const poSnap = await getDoc(poRef);
  if (!poSnap.exists()) {
    warnings.push('ไม่พบ PO');
    return { lines: [], totalAmount: 0, timesheetCount: 0, warnings };
  }
  const po = { ...poSnap.data(), id: poSnap.id } as PurchaseOrder;

  const mobCycleFilter = (options?.mobCycleIds ?? [])
    .map((x) => String(x).trim())
    .filter(Boolean);

  let mainContract: MainContract | undefined;
  if (po.contractId) {
    const mcSnap = await getDoc(doc(db, 'main_contracts', po.contractId));
    if (mcSnap.exists()) {
      mainContract = { ...(mcSnap.data() as MainContract), id: mcSnap.id };
    }
  }

  const tsConstraints = mobCycleFilter.length > 0
    ? [where('readyForBilling', '==', true)]
    : [
        where('purchaseOrderId', '==', poId),
        where('readyForBilling', '==', true),
        where('date', '>=', periodStart),
        where('date', '<=', periodEnd),
      ];
  if (waveId) {
    tsConstraints.push(where('waveId', '==', waveId));
  } else if (mobCycleFilter.length === 0) {
    const scope = (options?.poMonthWaveIds ?? [])
      .map((x) => String(x).trim())
      .filter(Boolean);
    if (scope.length === 1) {
      tsConstraints.push(where('waveId', '==', scope[0]));
      warnings.push(
        'จำกัด timesheet เฉพาะ 1 wave ตามเอกสาร PO+เดือน (relatedWaveIds) — ไม่รวม wave อื่นใต้ PO ที่ไม่ได้ผูกในงวดนี้',
      );
    } else if (scope.length > 1) {
      const capped = scope.slice(0, 30);
      if (scope.length > 30) {
        warnings.push(
          `relatedWaveIds มี ${scope.length} wave — Firestore จำกัดคำสั่ง "in" ที่ 30 จึงดึง timesheet เฉพาะ ${capped.length} wave แรกตามลำดับในเอกสารรีวิว`,
        );
      }
      tsConstraints.push(where('waveId', 'in', capped));
      warnings.push(
        `จำกัด timesheet เฉพาะ ${capped.length} wave ตามเอกสาร PO+เดือน (relatedWaveIds) — ไม่รวม wave อื่นใต้ PO ที่ไม่ได้ผูกในงวดนี้`,
      );
    }
  }

  /** Retro ที่รวมใน Trip invoice — ใช้สร้างคำเตือนแยกจาก payroll */
  let tripCommercialRetroAdjustments: TimesheetRetroAdjustment[] = [];

  const fetchTimesheets = async (): Promise<DailyTimesheet[]> => {
    if (mobCycleFilter.length > 0) {
      const byId = new Map<string, DailyTimesheet>();
      const addTs = (raw: DailyTimesheet) => {
        const ts = raw;
        if (!isTripBillingTimesheetBillable(ts)) return;
        if (ts.date >= periodStart && ts.date <= periodEnd) byId.set(ts.id, ts);
      };

      const { loadTimesheetsForMobCycleBilling } = await import(
        '@/lib/services/mob-cycle-billing-sync'
      );
      const { loadTimesheetRetroAdjustmentsForMonth } = await import(
        '@/lib/services/timesheet-retro-adjustment-service'
      );

      const allRetro: TimesheetRetroAdjustment[] = [];

      for (const mobCycleId of mobCycleFilter) {
        const reviewSnap = await getDoc(doc(db, 'mob_cycle_billing_reviews', mobCycleId));
        if (!reviewSnap.exists()) continue;
        const review = {
          id: reviewSnap.id,
          ...(reviewSnap.data() as object),
        } as MobCycleBillingReview;

        const segmentTs = await loadTimesheetsForMobCycleBilling(db, review);
        for (const ts of segmentTs) addTs(ts);

        const start = String(review.tripStartDate || periodStart).slice(0, 10);
        const end = String(review.tripEndDate || periodEnd).slice(0, 10);
        const aid = String(review.assignmentId || '').trim();
        if (aid && start && end) {
          const months = new Set<string>();
          months.add(start.slice(0, 7));
          months.add(end.slice(0, 7));
          for (const ym of months) {
            const rows = await loadTimesheetRetroAdjustmentsForMonth(db, ym);
            for (const r of rows) {
              if (r.assignmentId !== aid) continue;
              const d = String(r.workDateYmd || '').slice(0, 10);
              if (d < start || d > end) continue;
              allRetro.push(r);
            }
          }
        }
      }

      let list = [...byId.values()];
      list = await enrichTimesheetsForRetroSources(db, list, allRetro, periodStart, periodEnd);
      tripCommercialRetroAdjustments = allRetro;
      return mergeRetroDeltasIntoTimesheets(list, allRetro);
    }
    const snap = await getDocs(query(collection(db, 'daily_timesheets'), ...tsConstraints));
    return snap.docs.map((d) => ({ ...d.data(), id: d.id } as DailyTimesheet));
  };

  const [poLinesSnap, timesheetsRaw, mobSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, 'purchase_orders', poId, 'po_lines'),
        where('status', '==', 'active'),
      ),
    ),
    fetchTimesheets(),
    getDocs(query(collection(db, 'mobilizations'), where('poId', '==', poId))),
  ]);

  const poLines = poLinesSnap.docs.map(
    (d) => ({ ...d.data(), id: d.id } as POLine),
  );
  const poLinesByPosition = new Map<string, POLine>();
  for (const pl of poLines) {
    poLinesByPosition.set(pl.positionId, pl);
  }

  if (mobCycleFilter.length > 0) {
    warnings.push(
      `วางบิลตามรอบเดินทาง — ${mobCycleFilter.length} mob cycle · ช่วง ${periodStart} ถึง ${periodEnd}`,
    );
    if (tripCommercialRetroAdjustments.length > 0) {
      const { buildTripCommercialRetroBillingWarnings } = await import(
        '@/lib/services/timesheet-retro-adjustment-service'
      );
      warnings.push(...buildTripCommercialRetroBillingWarnings(tripCommercialRetroAdjustments));
    }
  }

  const mobById = new Map<string, Assignment>();
  for (const d of mobSnap.docs) {
    mobById.set(d.id, { ...(d.data() as Assignment), id: d.id });
  }

  const normalized = normalizeTimesheetsForPayrollLine(timesheetsRaw);
  const inMobWindow = normalized.filter((ts) => {
    const aid = String(ts.assignmentId || '').trim();
    if (!aid) return true;
    const a = mobById.get(aid);
    if (!a) return true;
    return isYmdWithinAssignmentMobTimesheetWindow(a, ts.date);
  });
  const beforeBillingDedupe = inMobWindow.length;
  let timesheets = dedupeTimesheetsForBilling(inMobWindow);
  const billingDeduped = beforeBillingDedupe - timesheets.length;

  if (mobCycleFilter.length > 0) {
    const tripFiltered = filterTimesheetsForTripMobCycleBilling(timesheets);
    timesheets = tripFiltered.timesheets;
    warnings.push(...tripFiltered.warnings);
  }

  const allowWorkers = normalizeWorkerIdSet(options?.workerIds ?? []);
  const excludeWorkers = new Set(normalizeWorkerIdSet(options?.excludeWorkerIds ?? []));
  if (allowWorkers.length > 0) {
    const allowSet = new Set(allowWorkers);
    const before = timesheets.length;
    timesheets = timesheets.filter((ts) => allowSet.has(String(ts.workerId || '').trim()));
    const dropped = before - timesheets.length;
    if (dropped > 0) {
      warnings.push(`จำกัดวางบิลเฉพาะ ${allowWorkers.length} คน — ตัด ${dropped} แถว timesheet นอกชุด`);
    }
  } else if (excludeWorkers.size > 0) {
    const before = timesheets.length;
    timesheets = timesheets.filter((ts) => !excludeWorkers.has(String(ts.workerId || '').trim()));
    const dropped = before - timesheets.length;
    if (dropped > 0) {
      warnings.push(`ไม่รวม ${excludeWorkers.size} คนที่ออก invoice partial แล้ว — ตัด ${dropped} แถว timesheet`);
    }
  }

  const payrollMobDropped = timesheetsRaw.length - inMobWindow.length;
  if (payrollMobDropped > 0) {
    warnings.push(
      `ตัด ${payrollMobDropped} แถว timesheet ก่อนรวมยอดวางบิล (ซ้ำตามกฎ payroll หรือวันที่อยู่นอกหน้าต่าง mobilization ของมอบหมาย)`,
    );
  }
  if (billingDeduped > 0) {
    warnings.push(
      `รวมเป็นหนึ่งใบงานต่อคน/วัน/ตำแหน่ง/ประเภทวันสำหรับวางบิล — ตัด ${billingDeduped} แถวที่ซ้ำกัน`,
    );
  }

  if (timesheets.length === 0) {
    if (timesheetsRaw.length > 0) {
      warnings.push(
        'หลังตัดซ้ำและกรองตามหน้าต่าง mobilization ไม่เหลือ timesheet สำหรับวางบิล — ตรวจวันที่กับมอบหมาย (mobilizations)',
      );
    } else {
      warnings.push(
        'ไม่พบ timesheet ที่พร้อมวางบิล (readyForBilling) ในช่วงเวลาที่เลือก',
      );
    }
    return {
      lines: [],
      totalAmount: 0,
      timesheetCount: 0,
      warnings: [...new Set(warnings)].filter((w) => !shouldOmitCommercialInvoiceGenerationWarning(w)),
    };
  }

  if (!mainContract) {
    warnings.push(
      'PO ไม่มีสัญญาหลัก (contractId) — การคำนวณวางบิลควรผูกสัญญา; ระบบจะ fallback ไปราคา snapshot จาก PO line เมื่อจำเป็น',
    );
  }

  const contractRatesByPosition = new Map<string, PositionRate>();
  if (po.contractId) {
    const ratesSnap = await getDocs(
      collection(db, 'main_contracts', po.contractId, 'position_rates'),
    );
    for (const d of ratesSnap.docs) {
      const rate = { id: d.id, ...(d.data() as object) } as PositionRate;
      if (rate.active === false) continue;
      contractRatesByPosition.set(rate.positionId, rate);
    }
  }

  const poWorkModeMap = buildPoWorkModeMapFromPurchaseOrders([po]);

  const positionLabels = await loadPositionLabels(db, [
    ...poLines.map((pl) => pl.positionId),
    ...timesheets.map((t) => t.positionId),
  ]);

  const accMap = new Map<string, LineAcc>();

  for (const ts of timesheets) {
    const poLine = poLinesByPosition.get(ts.positionId);
    const workMode = resolveEffectivePayrollJobMode(ts, poWorkModeMap);
    const contractRate = contractRatesByPosition.get(ts.positionId);

    if (!poLine) {
      if (!isUnpaidLeaveEvent(ts.eventType)) {
        warnings.push(`ข้าม ${ts.date} (${ts.eventType}) — ไม่มี PO line สำหรับตำแหน่ง`);
      }
      continue;
    }

    if (ts.eventType === 'work_day') {
      if (resolveBillingSellWorkingDayRate({ poLine, workMode, contractRate }) <= 0) {
        warnings.push(`ข้าม work_day ${ts.date} — ราคาขายใน PO line เป็น 0`);
        continue;
      }
      workDayFromDayRateBilling(ts, poLine, mainContract, accMap, workMode, contractRate);
      continue;
    }

    billingNonWorkDayFromPoAndContract(
      ts,
      poLine,
      mainContract,
      accMap,
      warnings,
      workMode,
      contractRate,
    );
  }

  const lines: GeneratedBillingLine[] = [];

  for (const acc of accMap.values()) {
    const qty = acc.totalQuantity;
    const amount = roundMoney(acc.totalAmount);
    const unitPrice = qty > 0 ? roundMoney(amount / qty) : 0;
    const posTitle = positionLabels.get(acc.positionId) || acc.positionId;
    lines.push({
      description: descriptionForLine(acc, posTitle),
      referenceType: 'TIMESHEET',
      positionId: acc.positionId,
      eventType: acc.eventType,
      timesheetIds: acc.timesheetIds,
      quantity: roundMoney(qty),
      unitPrice,
      amount,
    });
  }

  lines.sort((a, b) =>
    `${a.positionId} ${a.eventType}`.localeCompare(
      `${b.positionId} ${b.eventType}`,
      'th',
    ),
  );

  const totalAmount = roundMoney(lines.reduce((s, l) => s + l.amount, 0));

  return {
    lines,
    totalAmount,
    timesheetCount: timesheets.length,
    warnings: [...new Set(warnings)].filter((w) => !shouldOmitCommercialInvoiceGenerationWarning(w)),
  };
}

/** สร้างบรรทัดวางบิลจาก mob cycles ในชุด trip batch (หลายคนต่อ invoice) */
export async function generateBillingLinesForMobCycles(
  db: Firestore,
  poId: string,
  mobCycleIds: readonly string[],
  periodStart: string,
  periodEnd: string,
  options?: Pick<GenerateBillingLinesOptions, 'tripMobDemobLocationKey'>,
): Promise<BillingLineGenerationResult> {
  const ids = mobCycleIds.map((x) => String(x).trim()).filter(Boolean);
  if (ids.length === 0) {
    return {
      lines: [],
      totalAmount: 0,
      timesheetCount: 0,
      warnings: ['ไม่มี mob cycle ในชุดวางบิล'],
    };
  }
  const base = await generateBillingLines(db, poId, periodStart, periodEnd, undefined, {
    mobCycleIds: ids,
  });

  const poSnap = await getDoc(doc(db, 'purchase_orders', poId));
  if (!poSnap.exists()) return base;
  const po = poSnap.data() as PurchaseOrder;
  const contractId = String(po.contractId || '').trim();
  if (!contractId) {
    base.warnings.push('ไม่สามารถเพิ่มค่า MOB — PO ไม่มีสัญญาหลัก');
    return base;
  }

  const mcSnap = await getDoc(doc(db, 'main_contracts', contractId));
  if (!mcSnap.exists()) {
    base.warnings.push('ไม่สามารถเพิ่มค่า MOB — ไม่พบสัญญาหลัก');
    return base;
  }
  const contract = { id: mcSnap.id, ...(mcSnap.data() as object) } as MainContract;
  if (!contract.tripBillMobDemobFee) {
    return base;
  }

  let mobKey = (options?.tripMobDemobLocationKey || '').trim();
  if (!mobKey) {
    const { resolveTripMobDemobLocationChoice } = await import('@/lib/services/trip-mob-demob-billing');
    const choice = await resolveTripMobDemobLocationChoice(db, contractId, ids);
    if (choice.kind === 'auto') {
      mobKey = choice.mobLocationKey;
    } else if (choice.kind === 'error') {
      base.warnings.push(choice.message);
      return base;
    } else if (choice.kind === 'prompt') {
      base.warnings.push(
        'สัญญากำหนดให้คิดค่า MOB — เลือกจุด Mob/Demob ตอนสร้าง invoice จากหน้า Trip Billing (หรือบันทึก tripMobDemobLocationKey บนใบนี้)',
      );
      return base;
    }
  }

  if (!mobKey) {
    return base;
  }

  const { loadContractPositionRatesByPositionId, loadTripMobDemobMembers, generateTripMobDemobBillingLines } =
    await import('@/lib/services/trip-mob-demob-billing');
  const members = await loadTripMobDemobMembers(db, ids);
  const ratesByPosition = await loadContractPositionRatesByPositionId(db, contractId);
  const mobGen = await generateTripMobDemobBillingLines(
    db,
    contract,
    members,
    ratesByPosition,
    mobKey,
  );

  if (mobGen.lines.length === 0 && base.lines.length === 0) {
    return {
      lines: [],
      totalAmount: 0,
      timesheetCount: base.timesheetCount,
      warnings: [...new Set([...base.warnings, ...mobGen.warnings])],
    };
  }

  const lines = [...base.lines, ...mobGen.lines];
  const totalAmount = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  return {
    lines,
    totalAmount,
    timesheetCount: base.timesheetCount,
    warnings: [...new Set([...base.warnings, ...mobGen.warnings])].filter(
      (w) => !shouldOmitCommercialInvoiceGenerationWarning(w),
    ),
  };
}

/**
 * Persists generated billing lines into Firestore subcollection.
 */
export async function saveBillingLines(
  db: Firestore,
  billingNoteId: string,
  lines: GeneratedBillingLine[],
): Promise<void> {
  const linesRef = collection(db, 'billing_notes', billingNoteId, 'lines');
  for (const line of lines) {
    await addDoc(linesRef, {
      billingNoteId,
      description: line.description,
      referenceType: line.referenceType,
      ...(line.workerId ? { workerId: line.workerId } : {}),
      ...(line.workerName ? { workerName: line.workerName } : {}),
      positionId: line.positionId,
      eventType: line.eventType,
      timesheetIds: line.timesheetIds,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}
