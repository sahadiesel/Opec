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
  type QueryConstraint,
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
import {
  buildBillableTimesheetForAddedDay,
  loadWorkDayAddsForBillingPeriod,
  loadWorkDayReversalsForBillingPeriod,
  matchWorkDayReversal,
} from '@/lib/commercial/billing-reversal-days';
import { normalizeTimesheetsForBillingLine } from '@/lib/payroll/dedupe-timesheets-for-payroll';
import { isDailyTimesheetPayableForWorkerPayroll } from '@/lib/payroll/filter-timesheets-for-worker-payroll';
import { isYmdInRemobGapBetweenCycles } from '@/lib/constants/timesheet-ui';
import { shouldDeleteStalePoActiveAutoDailyRow } from '@/lib/timesheet/po-active-auto-daily-build';
import {
  resolveBillingMatrixEventDayRate,
  resolveBillingMatrixOtTierHourlyRate,
  resolveBillingSellOtHourlyRate,
  resolveBillingSellWorkingDayRate,
} from '@/lib/commercial/position-rate-sell';
import {
  buildPoWorkModeMapFromPurchaseOrders,
  resolveEffectivePayrollJobMode,
} from '@/lib/payroll/timesheet-labor-base-cost';
import type { StatedPackageHours } from '@/lib/commercial/package-hourly-rate';
import { resolveSellRestDay, type SellRestDayResolution } from '@/lib/commercial/sell-rest-day';
import {
  defaultPackageHoursForWorkMode,
  mobDayChargeKindToEventType,
  resolveTimesheetBillingCharge,
} from '@/lib/ops/mob-day-charge';
import { lastConsecutiveClusterStart } from '@/lib/commercial/trip-invoice-period';

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
  /** ช่วงวันจริงที่วางบิล (Trip = M1 ถึง D1 หลังตัดวันรอ remob) */
  billedPeriodStart?: string;
  billedPeriodEnd?: string;
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
  /** จำกัดเฉพาะวันที่อยู่ในช่วงที่ส่งออกบิลรอบนี้ (หลายช่วงได้) */
  dateRanges?: ReadonlyArray<{ startYmd: string; endYmd: string }> | null;
  /**
   * วันที่มีหักเงินคืน (work_day_reversal)
   * true = นำวันที่ลงเวลานั้นมาวางบิล · false หรือไม่ส่ง = ตัดวันนั้นออก
   */
  billingReversalIncludeByWorkerId?: Readonly<Record<string, boolean>> | null;
  /**
   * วันที่จ่ายลูกจ้างเพิ่มหลังจ่ายค่าแรงแล้ว (work_day_add)
   * true = วางบิลลูกค้าเพิ่ม · false หรือไม่ส่ง = ไม่นำวันนั้นมาวางบิล
   */
  billingAddedDayIncludeByWorkerId?: Readonly<Record<string, boolean>> | null;
  /**
   * Trip หลาย PO ในใบเดียว — โหลด po_lines / โหมดงาน จาก PO เหล่านี้ด้วย
   * (นอกเหนือจาก poId หลัก และ PO ที่ใบงาน / mob cycle ผูกไว้)
   */
  extraPoIds?: readonly string[] | null;
}

type BillingPoLineMaps = {
  byPoAndId: Map<string, POLine>;
  byId: Map<string, POLine>;
  byPoPosition: Map<string, POLine>;
  byPosition: Map<string, POLine>;
};

function uniqueNonEmptyIds(...groups: Array<string | readonly string[] | null | undefined>): string[] {
  const out = new Set<string>();
  for (const g of groups) {
    if (!g) continue;
    if (typeof g === 'string') {
      const id = g.trim();
      if (id) out.add(id);
    } else {
      for (const x of g) {
        const id = String(x || '').trim();
        if (id) out.add(id);
      }
    }
  }
  return [...out];
}

function preferActivePoLine(existing: POLine | undefined, next: POLine): POLine {
  if (!existing) return next;
  if (existing.status !== 'active' && next.status === 'active') return next;
  return existing;
}

async function loadPoLinesForBilling(db: Firestore, poIds: readonly string[]): Promise<{
  poLines: POLine[];
  maps: BillingPoLineMaps;
}> {
  const maps: BillingPoLineMaps = {
    byPoAndId: new Map(),
    byId: new Map(),
    byPoPosition: new Map(),
    byPosition: new Map(),
  };
  const poLines: POLine[] = [];
  await Promise.all(
    poIds.map(async (parentPoId) => {
      const snap = await getDocs(collection(db, 'purchase_orders', parentPoId, 'po_lines'));
      for (const d of snap.docs) {
        const raw = d.data() as POLine;
        const line: POLine = {
          ...raw,
          id: d.id,
          poId: String(raw.poId || parentPoId).trim() || parentPoId,
        };
        poLines.push(line);
        maps.byPoAndId.set(`${line.poId}::${line.id}`, line);
        maps.byId.set(line.id, preferActivePoLine(maps.byId.get(line.id), line));
        const pos = String(line.positionId || '').trim();
        if (pos) {
          const poPosKey = `${line.poId}::${pos}`;
          maps.byPoPosition.set(poPosKey, preferActivePoLine(maps.byPoPosition.get(poPosKey), line));
          maps.byPosition.set(pos, preferActivePoLine(maps.byPosition.get(pos), line));
        }
      }
    }),
  );
  return { poLines, maps };
}

/**
 * วางบิลตามบรรทัด PO ที่บันทึกบนใบงานวันนั้น
 * ไม่จับคู่ด้วยตำแหน่งทะเบียนที่แก้ทีหลัง — ถ้าใบงานไม่มี poLineId ค่อยถอยไปตำแหน่งบนใบงาน
 * ใบ Trip หลาย PO: หาบรรทัดใน PO ของใบงานนั้น ไม่จำกัดแค่ PO หลักของ invoice
 */
function resolvePoLineForBillingDay(
  ts: Pick<DailyTimesheet, 'date' | 'positionId' | 'poLineId' | 'purchaseOrderId'>,
  maps: BillingPoLineMaps,
  warnings: string[],
  mismatchWarned: Set<string>,
): POLine | undefined {
  const lineId = String(ts.poLineId || '').trim();
  const tsPos = String(ts.positionId || '').trim();
  const tsPo = String(ts.purchaseOrderId || '').trim();
  if (lineId) {
    const scoped = tsPo ? maps.byPoAndId.get(`${tsPo}::${lineId}`) : undefined;
    const byId = scoped || maps.byId.get(lineId);
    if (byId) {
      if (tsPos && byId.positionId && tsPos !== byId.positionId) {
        const key = `${byId.poId}|${lineId}|${tsPos}`;
        if (!mismatchWarned.has(key)) {
          mismatchWarned.add(key);
          warnings.push(
            `วัน ${ts.date} ตำแหน่งบนใบงานไม่ตรงบรรทัด PO — วางบิลตามบรรทัด PO ของวันนั้น ไม่ใช้ตำแหน่งที่แก้ในทะเบียนทีหลัง`,
          );
        }
      }
      return byId;
    }
  }
  if (tsPo && tsPos) {
    const byPoPos = maps.byPoPosition.get(`${tsPo}::${tsPos}`);
    if (byPoPos) return byPoPos;
  }
  return tsPos ? maps.byPosition.get(tsPos) : undefined;
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
 * วางบิลตามประเภทวันบน timesheet / แก้ไขย้อนหลัง
 * — เซลล์ Mob (MO) = เก็บเงิน M1 · เซลล์ D1 = เก็บเงิน D1
 * — ไม่ใช้ mobBillingChargeKind ที่ค้างเป็น STANDBY ทับวัน M1
 * — payroll ยังใช้ resolveTimesheetPayrollCharge คนละทาง
 */
function resolveCommercialInvoiceDayCharge(ts: DailyTimesheet) {
  const charge = resolveTimesheetBillingCharge(ts);
  const et = String(ts.eventType || '').trim();
  if (et === 'mobilization_day') {
    if (charge.kind === 'M1') return charge;
    return { kind: 'M1' as const, hours: defaultPackageHoursForWorkMode(ts.workMode) };
  }
  if (et === 'demobilization_day') {
    if (charge.kind === 'D1' || charge.kind === 'STANDBY') return charge;
    return { kind: 'D1' as const, hours: defaultPackageHoursForWorkMode(ts.workMode) };
  }
  return charge;
}

/** ใบงานที่ payroll ล็อก/ปิดแล้ว แต่ยังไม่ได้ติด readyForBilling — ต้องนับถ้าวางบิลตาม timesheet */
const RECORDED_TIMESHEET_STATUSES = new Set(['LOCKED', 'CLIENT_APPROVED', 'VERIFIED_PAPER']);

function isRecordedTimesheetMissingBillingFlag(ts: Pick<DailyTimesheet, 'status' | 'readyForBilling'>): boolean {
  if (ts.readyForBilling === true) return false;
  return RECORDED_TIMESHEET_STATUSES.has(String(ts.status || ''));
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

function isTripBillingTimesheetBillable(ts: DailyTimesheet): boolean {
  if (ts.readyForBilling === true) return true;
  if (ts.status === 'LOCKED') return true;
  return false;
}

function isTripCycleActivityTimesheet(ts: DailyTimesheet): boolean {
  const et = String(ts.eventType || '').trim();
  return (
    et === 'mobilization_day' ||
    et === 'demobilization_day' ||
    et === 'work_day' ||
    et === 'standby_day'
  );
}

/**
 * รอบ Trip นับจาก M1 ถึง D1 — ตัด standby/auto ก่อนวัน M1 (รอ remob) ออกจากงวด
 */
export function trimTimesheetsToTripMobDemobWindow(
  timesheets: readonly DailyTimesheet[],
): { timesheets: DailyTimesheet[]; warnings: string[] } {
  const warnings: string[] = [];
  const m1DatesByWorker = new Map<string, string[]>();
  for (const ts of timesheets) {
    const wid = String(ts.workerId || '').trim();
    const d = String(ts.date || '').slice(0, 10);
    if (!wid || !d) continue;
    if (ts.eventType !== 'mobilization_day') continue;
    const list = m1DatesByWorker.get(wid) ?? [];
    list.push(d);
    m1DatesByWorker.set(wid, list);
  }
  const m1ByWorker = new Map<string, string>();
  for (const [wid, days] of m1DatesByWorker) {
    const start = lastConsecutiveClusterStart(days);
    if (start) m1ByWorker.set(wid, start);
  }
  if (m1ByWorker.size === 0) {
    return { timesheets: [...timesheets], warnings };
  }
  let droppedBeforeM1 = 0;
  const out = timesheets.filter((ts) => {
    const wid = String(ts.workerId || '').trim();
    const d = String(ts.date || '').slice(0, 10);
    const m1 = m1ByWorker.get(wid);
    if (m1 && d < m1) {
      droppedBeforeM1 += 1;
      return false;
    }
    return true;
  });
  if (droppedBeforeM1 > 0) {
    warnings.push(
      `Trip billing: ตัด ${droppedBeforeM1} วันก่อน M1 (เช่น standby รอ remob) — ไม่นับในรอบเดินทางนี้`,
    );
  }
  return { timesheets: out, warnings };
}

function billedPeriodFromTimesheets(
  timesheets: readonly DailyTimesheet[],
): { start?: string; end?: string } {
  const days = timesheets
    .map((ts) => String(ts.date || '').slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (days.length === 0) return {};
  return { start: days[0], end: days[days.length - 1] };
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

  const byWorkerDate = new Map<string, TimesheetRetroAdjustment[]>();
  for (const r of retros) {
    if (r.status === 'void') continue;
    const wid = String(r.workerId || '').trim();
    const d = String(r.workDateYmd || '').slice(0, 10);
    if (!wid || !d) continue;
    const k = `${wid}|${d}`;
    const list = byWorkerDate.get(k) ?? [];
    list.push(r);
    byWorkerDate.set(k, list);
  }

  return timesheets.map((ts) => {
    const adj = [
      ...(byTsId.get(ts.id) ?? []),
      ...((() => {
        const k = `${String(ts.workerId || '').trim()}|${String(ts.date || '').slice(0, 10)}`;
        const rows = byWorkerDate.get(k) ?? [];
        const seen = new Set((byTsId.get(ts.id) ?? []).map((x) => x.id));
        return rows.filter((x) => !seen.has(x.id));
      })()),
    ];
    if (!adj.length) return ts;
    let o15 = Math.max(0, Number(ts.ot15Hours) || 0);
    let o20 = Math.max(0, Number(ts.ot20Hours) || 0);
    let o30 = Math.max(0, Number(ts.ot30Hours) || 0);
    let eventType = ts.eventType;
    let billingKind = ts.mobBillingChargeKind;
    for (const r of adj) {
      o15 += Math.max(0, Number(r.addedOt15Hours) || 0);
      o20 += Math.max(0, Number(r.addedOt20Hours) || 0);
      o30 += Math.max(0, Number(r.addedOt30Hours) || 0);
      const retroEv = String(r.retroEventType || '').trim();
      if (retroEv === 'mobilization_day' || (Number(r.addedM1Trips) || 0) > 0) {
        eventType = 'mobilization_day';
        billingKind = 'M1';
      } else if (retroEv === 'demobilization_day' || (Number(r.addedD1Trips) || 0) > 0) {
        eventType = 'demobilization_day';
        billingKind = 'D1';
      } else if (retroEv) {
        eventType = retroEv as DailyTimesheet['eventType'];
      }
    }
    return {
      ...ts,
      eventType,
      ...(billingKind ? { mobBillingChargeKind: billingKind } : {}),
      ot15Hours: o15,
      ot20Hours: o20,
      ot30Hours: o30,
    };
  });
}

function retroOtHoursTotal(retros: readonly TimesheetRetroAdjustment[]): number {
  let n = 0;
  for (const r of retros) {
    if (r.status === 'void') continue;
    n += Math.max(0, Number(r.addedOt15Hours) || 0);
    n += Math.max(0, Number(r.addedOt20Hours) || 0);
    n += Math.max(0, Number(r.addedOt30Hours) || 0);
  }
  return n;
}

async function applyRetroHoursForCommercialBilling(
  db: Firestore,
  timesheets: DailyTimesheet[],
  retros: readonly TimesheetRetroAdjustment[],
  periodStart: string,
  periodEnd: string,
): Promise<DailyTimesheet[]> {
  if (!retros.length) return timesheets;
  const enriched = await enrichTimesheetsForRetroSources(db, timesheets, retros, periodStart, periodEnd);
  return mergeRetroDeltasIntoTimesheets(enriched, retros);
}

/** Retro OT/SB ของ PO ในงวด — ตารางรายเดือนโชว์ W+n† แต่ daily_timesheets อาจเป็น 0 ชม. */
async function loadRetroAdjustmentsForPoPeriod(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
  timesheetIds: ReadonlySet<string>,
): Promise<TimesheetRetroAdjustment[]> {
  const { loadTimesheetRetroAdjustmentsForMonth } = await import(
    '@/lib/services/timesheet-retro-adjustment-service'
  );
  const months = new Set<string>([periodStart.slice(0, 7), periodEnd.slice(0, 7)]);
  const out: TimesheetRetroAdjustment[] = [];
  const seen = new Set<string>();
  for (const ym of months) {
    const rows = await loadTimesheetRetroAdjustmentsForMonth(db, ym);
    for (const r of rows) {
      if (r.status === 'void') continue;
      const rid = String(r.id || '').trim();
      if (rid && seen.has(rid)) continue;
      const d = String(r.workDateYmd || '').slice(0, 10);
      if (d < periodStart || d > periodEnd) continue;
      const po = String(r.purchaseOrderId || '').trim();
      const sid = String(r.sourceTimesheetId || '').trim();
      if (po) {
        if (po !== poId) continue;
      } else if (!sid || !timesheetIds.has(sid)) {
        continue;
      }
      if (rid) seen.add(rid);
      out.push(r);
    }
  }
  return out;
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
    byId.set(ts.id, ts);
  }
  return [...byId.values()];
}

/**
 * Trip billing — ตัด work_day ที่ไม่ใช่การทำงานจริงบนไซต์:
 * - วันเดียวกับ M1 (มี mobilization_day แล้ว)
 * - ตั้งแต่วัน D1 เป็นต้นไป
 *
 * ไม่ตัดวันที่มีชั่วโมงปกติเพียงเพราะไม่มี OT / เป็นแถว auto —
 * ค่าแรงรายวันต้องวางบิลตามงานจริง (OT เป็นรายการแยก)
 */
function ymdInOptionalRange(d: string, rangeStart?: string, rangeEnd?: string): boolean {
  if (rangeStart && d < rangeStart) return false;
  if (rangeEnd && d > rangeEnd) return false;
  return true;
}

export function filterTimesheetsForTripMobCycleBilling(
  timesheets: readonly DailyTimesheet[],
  opts?: { includeDaysAfterD1?: boolean; rangeStartYmd?: string; rangeEndYmd?: string },
): { timesheets: DailyTimesheet[]; warnings: string[] } {
  const warnings: string[] = [];
  const mobDaysByWorker = new Map<string, Set<string>>();
  const d1DaysByWorker = new Map<string, Set<string>>();
  const rangeStart = String(opts?.rangeStartYmd || '').slice(0, 10);
  const rangeEnd = String(opts?.rangeEndYmd || '').slice(0, 10);

  for (const ts of timesheets) {
    const wid = String(ts.workerId || '').trim();
    const d = String(ts.date || '').slice(0, 10);
    if (!wid || !d) continue;
    if (!ymdInOptionalRange(d, rangeStart || undefined, rangeEnd || undefined)) continue;
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

  const d1CutoffByWorker = new Map<string, string>();
  for (const [wid, days] of d1DaysByWorker) {
    const cutoff = lastConsecutiveClusterStart([...days]);
    if (cutoff) d1CutoffByWorker.set(wid, cutoff);
  }

  let droppedMobOverlap = 0;
  let droppedAfterD1 = 0;

  const out = timesheets.filter((ts) => {
    if (ts.eventType !== 'work_day') return true;
    const wid = String(ts.workerId || '').trim();
    const d = String(ts.date || '').slice(0, 10);
    if (!wid || !d) return true;

    if (mobDaysByWorker.get(wid)?.has(d)) {
      droppedMobOverlap++;
      return false;
    }

    if (d1DaysByWorker.get(wid)?.has(d)) {
      droppedAfterD1++;
      return false;
    }
    const d1Cutoff = d1CutoffByWorker.get(wid);
    if (!opts?.includeDaysAfterD1 && d1Cutoff && d > d1Cutoff) {
      droppedAfterD1++;
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
  /** อัตรา OT x1.5 เต็มต่อชม. (ช่อง OT 1.5 / ชม. บน rate sheet) — ไม่ใช่ฐานชม.ก่อนคูณ */
  const otHourlyFull = resolveBillingSellOtHourlyRate(rateCtx, statedHours);
  const ot2Hourly =
    otHourlyFull > 0
      ? (resolveBillingMatrixOtTierHourlyRate(rateCtx, 2) ?? Math.round(otHourlyFull * (2 / 1.5) * 100) / 100)
      : 0;
  const ot3Hourly =
    otHourlyFull > 0
      ? (resolveBillingMatrixOtTierHourlyRate(rateCtx, 3) ?? Math.round(otHourlyFull * 2 * 100) / 100)
      : 0;

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

  if (otHourlyFull <= 0) return;

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

  // otHourlyFull = อัตรา x1.5 แล้ว — tier อื่นสเกลจาก 1.5; overflow ใช้ตัวคูณขายหลังกะ
  if (overflowNormal > 0) {
    const overflowMult = sellOtMult / 1.5;
    pushOtLine(
      overflowOtEventType(sellOtMult),
      overflowNormal,
      overflowNormal * otHourlyFull * overflowMult,
    );
  }
  if (o15 > 0) {
    pushOtLine('ot_1.5', o15, o15 * otHourlyFull);
  }
  if (o20 > 0) {
    pushOtLine('ot_2.0', o20, o20 * ot2Hourly);
  }
  if (o30 > 0) {
    pushOtLine('ot_3.0', o30, o30 * ot3Hourly);
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

  const billingCharge = resolveCommercialInvoiceDayCharge(ts);
  if (
    (billingCharge.kind === 'M1' || billingCharge.kind === 'D1') &&
    billingCharge.m1AmountOverride != null &&
    billingCharge.m1AmountOverride > 0
  ) {
    const amt = billingCharge.m1AmountOverride;
    const eventType = billingCharge.kind === 'D1' ? 'demobilization_day' : 'mobilization_day';
    pushAcc(map, accKey(ts.positionId, eventType, amt), {
      workerId: ts.workerId,
      positionId: ts.positionId,
      eventType,
      timesheetIds: [ts.id],
      amount: amt,
      quantity: 1,
    });
    return;
  }

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
      return `${title} — OT1.5 (${qtyPhrase})`;
    case 'ot_2.0':
      return `${title} — OT2 (${qtyPhrase})`;
    case 'ot_3.0':
      return `${title} — OT3 (${qtyPhrase})`;
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
  const relatedPoIds = new Set<string>(uniqueNonEmptyIds(poId, options?.extraPoIds));
  const dateRanges = (options?.dateRanges ?? []).filter(
    (r) => r.startYmd && r.endYmd && r.startYmd <= r.endYmd,
  );
  const billingWindowStart =
    dateRanges.length > 0
      ? dateRanges.reduce((m, r) => (r.startYmd < m ? r.startYmd : m), dateRanges[0]!.startYmd)
      : periodStart;
  const billingWindowEnd =
    dateRanges.length > 0
      ? dateRanges.reduce((m, r) => (r.endYmd > m ? r.endYmd : m), dateRanges[0]!.endYmd)
      : periodEnd;

  let mainContract: MainContract | undefined;
  if (po.contractId) {
    const mcSnap = await getDoc(doc(db, 'main_contracts', po.contractId));
    if (mcSnap.exists()) {
      mainContract = { ...(mcSnap.data() as MainContract), id: mcSnap.id };
    }
  }

  const periodConstraints: QueryConstraint[] =
    mobCycleFilter.length > 0
      ? []
      : [
          where('purchaseOrderId', '==', poId),
          where('date', '>=', periodStart),
          where('date', '<=', periodEnd),
        ];
  const tsConstraints =
    mobCycleFilter.length > 0
      ? [where('readyForBilling', '==', true)]
      : [where('readyForBilling', '==', true), ...periodConstraints];
  if (waveId) {
    tsConstraints.push(where('waveId', '==', waveId));
    periodConstraints.push(where('waveId', '==', waveId));
  } else if (mobCycleFilter.length === 0) {
    const scope = (options?.poMonthWaveIds ?? [])
      .map((x) => String(x).trim())
      .filter(Boolean);
    if (scope.length === 1) {
      tsConstraints.push(where('waveId', '==', scope[0]));
      periodConstraints.push(where('waveId', '==', scope[0]));
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
      periodConstraints.push(where('waveId', 'in', capped));
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
        if (!isTripCycleActivityTimesheet(ts) && !isTripBillingTimesheetBillable(ts)) return;
        byId.set(ts.id, ts);
      };

      const { loadTimesheetsForMobCycleBilling } = await import(
        '@/lib/services/mob-cycle-billing-sync'
      );
      const { loadTimesheetRetroAdjustmentsForMonth } = await import(
        '@/lib/services/timesheet-retro-adjustment-service'
      );

      const allRetro: TimesheetRetroAdjustment[] = [];
      const reviewWorkerIds = new Set<string>();

      for (const mobCycleId of mobCycleFilter) {
        const reviewSnap = await getDoc(doc(db, 'mob_cycle_billing_reviews', mobCycleId));
        if (!reviewSnap.exists()) continue;
        const review = {
          id: reviewSnap.id,
          ...(reviewSnap.data() as object),
        } as MobCycleBillingReview;
        const reviewPo = String(review.poId || '').trim();
        if (reviewPo) relatedPoIds.add(reviewPo);
        const reviewWorker = String(review.workerId || '').trim();
        if (reviewWorker) reviewWorkerIds.add(reviewWorker);

        const segmentTs = await loadTimesheetsForMobCycleBilling(db, review, {
          windowStartYmd: billingWindowStart,
          windowEndYmd: billingWindowEnd,
        });
        for (const ts of segmentTs) addTs(ts);

        const start = String(review.tripStartDate || billingWindowStart).slice(0, 10);
        const end = String(review.tripEndDate || billingWindowEnd).slice(0, 10);
        const aid = String(review.assignmentId || '').trim();
        const retroFrom = billingWindowStart || start;
        const retroTo = billingWindowEnd || end;
        if (aid && retroFrom && retroTo) {
          const months = new Set<string>();
          months.add(retroFrom.slice(0, 7));
          months.add(retroTo.slice(0, 7));
          months.add(start.slice(0, 7));
          months.add(end.slice(0, 7));
          for (const ym of months) {
            if (!/^\d{4}-\d{2}$/.test(ym)) continue;
            const rows = await loadTimesheetRetroAdjustmentsForMonth(db, ym);
            for (const r of rows) {
              const retroWorker = String(r.workerId || '').trim();
              if (r.assignmentId !== aid && !(reviewWorker && retroWorker === reviewWorker)) continue;
              const d = String(r.workDateYmd || '').slice(0, 10);
              if (d < retroFrom || d > retroTo) continue;
              allRetro.push(r);
            }
          }
        }
      }

      if (
        /^\d{4}-\d{2}-\d{2}$/.test(billingWindowStart) &&
        /^\d{4}-\d{2}-\d{2}$/.test(billingWindowEnd)
      ) {
        const poIdsForWindow = [...relatedPoIds];
        await Promise.all(
          poIdsForWindow.map(async (windowPoId) => {
            const snap = await getDocs(
              query(
                collection(db, 'daily_timesheets'),
                where('purchaseOrderId', '==', windowPoId),
                where('date', '>=', billingWindowStart),
                where('date', '<=', billingWindowEnd),
              ),
            );
            for (const d of snap.docs) {
              const ts = { id: d.id, ...(d.data() as object) } as DailyTimesheet;
              const wid = String(ts.workerId || '').trim();
              if (reviewWorkerIds.size > 0 && wid && !reviewWorkerIds.has(wid)) continue;
              addTs(ts);
            }
          }),
        );
      }

      let list = [...byId.values()];
      list = await applyRetroHoursForCommercialBilling(
        db,
        list,
        allRetro,
        billingWindowStart || periodStart,
        billingWindowEnd || periodEnd,
      );
      tripCommercialRetroAdjustments = allRetro;
      return list;
    }
    const snap = await getDocs(query(collection(db, 'daily_timesheets'), ...tsConstraints));
    const byId = new Map<string, DailyTimesheet>();
    for (const d of snap.docs) {
      byId.set(d.id, { ...d.data(), id: d.id } as DailyTimesheet);
    }
    if (periodConstraints.length > 0) {
      const recordedSnap = await getDocs(query(collection(db, 'daily_timesheets'), ...periodConstraints));
      let addedRecorded = 0;
      for (const d of recordedSnap.docs) {
        if (byId.has(d.id)) continue;
        const ts = { ...d.data(), id: d.id } as DailyTimesheet;
        if (!isRecordedTimesheetMissingBillingFlag(ts)) continue;
        byId.set(ts.id, ts);
        addedRecorded++;
      }
      if (addedRecorded > 0) {
        warnings.push(
          `รวม ${addedRecorded} ใบงานที่บันทึกและล็อกจาก payroll แล้ว แต่ยังไม่ได้ตั้งพร้อมวางบิล — นับตาม timesheet`,
        );
      }
    }
    let list = [...byId.values()];
    const poRetro = await loadRetroAdjustmentsForPoPeriod(
      db,
      poId,
      periodStart,
      periodEnd,
      new Set(list.map((t) => t.id)),
    );
    if (poRetro.length > 0) {
      list = mergeRetroDeltasIntoTimesheets(list, poRetro);
      const otH = retroOtHoursTotal(poRetro);
      if (otH > 0) {
        warnings.push(
          `รวม OT จากแก้ไขย้อนหลัง ${otH} ชม. ในใบแจ้งหนี้ (อัตราขาย ตาม OT1.5/OT2/OT3) — ไม่แก้ payroll`,
        );
      }
    }
    return list;
  };

  const timesheetsRaw = await fetchTimesheets();
  for (const ts of timesheetsRaw) {
    const tsPo = String(ts.purchaseOrderId || '').trim();
    if (tsPo) relatedPoIds.add(tsPo);
  }
  const billingPoIdList = [...relatedPoIds];
  const extraPoIdsToLoad = billingPoIdList.filter((id) => id !== poId);

  const [loadedLines, extraPoSnaps, mobSnaps] = await Promise.all([
    loadPoLinesForBilling(db, billingPoIdList),
    Promise.all(extraPoIdsToLoad.map((id) => getDoc(doc(db, 'purchase_orders', id)))),
    Promise.all(
      billingPoIdList.map((id) =>
        getDocs(query(collection(db, 'mobilizations'), where('poId', '==', id))),
      ),
    ),
  ]);

  const poLines = loadedLines.poLines;
  const poLineMaps = loadedLines.maps;
  const billingLineMismatchWarned = new Set<string>();
  const posForWorkMode: PurchaseOrder[] = [po];
  const extraContractIds = new Set<string>();
  for (const s of extraPoSnaps) {
    if (!s.exists()) continue;
    const extraPo = { ...s.data(), id: s.id } as PurchaseOrder;
    posForWorkMode.push(extraPo);
    const cid = String(extraPo.contractId || '').trim();
    if (cid && cid !== String(po.contractId || '').trim()) extraContractIds.add(cid);
  }

  let billedPeriodStart: string | undefined;
  let billedPeriodEnd: string | undefined;
  const userTripRange = mobCycleFilter.length > 0 && dateRanges.length > 0;
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
  for (const snap of mobSnaps) {
    for (const d of snap.docs) {
      mobById.set(d.id, { ...(d.data() as Assignment), id: d.id });
    }
  }

  /** อย่าใช้ normalize แบบ payroll (W ทับ SB คน+วัน) — จะทำให้บรรทัด standby หาย */
  const normalized = normalizeTimesheetsForBillingLine(timesheetsRaw);
  const retroWorkerIds = options?.workerIds ?? undefined;
  const [reversals, addedDays] = await Promise.all([
    loadWorkDayReversalsForBillingPeriod(db, poId, periodStart, periodEnd, retroWorkerIds),
    loadWorkDayAddsForBillingPeriod(db, poId, periodStart, periodEnd, retroWorkerIds),
  ]);
  const includeReversalByWorker = options?.billingReversalIncludeByWorkerId ?? {};
  const includeAddedByWorker = options?.billingAddedDayIncludeByWorkerId ?? {};
  let reversalIncluded = 0;
  let reversalExcluded = 0;
  let addedIncluded = 0;
  let addedExcluded = 0;
  let addedSheetExcluded = 0;
  let droppedAutoStandby = 0;
  const matchedAddedIds = new Set<string>();
  const firstM1InWindowByWorker = new Map<string, string>();
  for (const ts of normalized) {
    const ymd = String(ts.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    if (ymd < billingWindowStart || ymd > billingWindowEnd) continue;
    const isM1 =
      ts.eventType === 'mobilization_day' || resolveCommercialInvoiceDayCharge(ts).kind === 'M1';
    if (!isM1) continue;
    const wid = String(ts.workerId || '').trim();
    if (!wid) continue;
    const prev = firstM1InWindowByWorker.get(wid);
    if (!prev || ymd < prev) firstM1InWindowByWorker.set(wid, ymd);
  }
  /**
   * นับวันตามใบงานที่ payroll จ่าย — วัน W ที่ลงไว้ในช่วง remob ไม่ใช่วันว่าง
   * วันหักเงินคืนและวันจ่ายเพิ่ม ใส่หรือตัดตามที่ยืนยันตอนสร้างใบ
   * แถว auto หลังวันจบไซต์ที่ไม่มีรายการเหล่านี้ ยังไม่นับ
   */
  const inAttendance = normalized.filter((ts) => {
    const ymdEarly = String(ts.date || '').slice(0, 10);
    const widEarly = String(ts.workerId || '').trim();
    const billingKind = resolveCommercialInvoiceDayCharge(ts).kind;
    if (
      billingKind === 'STANDBY' &&
      ts.poActiveAutoDaily === true &&
      widEarly &&
      /^\d{4}-\d{2}-\d{2}$/.test(ymdEarly)
    ) {
      const firstM1 = firstM1InWindowByWorker.get(widEarly);
      const aidEarly = String(ts.assignmentId || '').trim();
      const asgnEarly = aidEarly ? mobById.get(aidEarly) : undefined;
      if (asgnEarly && isYmdInRemobGapBetweenCycles(asgnEarly, ymdEarly)) {
        droppedAutoStandby += 1;
        return false;
      }
      if (firstM1 && ymdEarly >= firstM1) {
        droppedAutoStandby += 1;
        return false;
      }
    }
    const reversal = matchWorkDayReversal(ts, reversals);
    if (reversal) {
      const include = includeReversalByWorker[String(ts.workerId || '').trim()] === true;
      if (include) reversalIncluded++;
      else reversalExcluded++;
      return include;
    }
    const added = matchWorkDayReversal(ts, addedDays);
    if (added) {
      if (added.id) matchedAddedIds.add(added.id);
      const include = includeAddedByWorker[String(ts.workerId || '').trim()] === true;
      if (include) addedIncluded++;
      else {
        addedExcluded++;
        addedSheetExcluded++;
      }
      return include;
    }
    if (isDailyTimesheetPayableForWorkerPayroll(ts, mobById)) return true;
    if (
      userTripRange &&
      isTripCycleActivityTimesheet(ts) &&
      dateRanges.some((r) => {
        const ymd = String(ts.date || '').slice(0, 10);
        return ymd >= r.startYmd && ymd <= r.endYmd;
      })
    ) {
      const ymd = String(ts.date || '').slice(0, 10);
      const aid = String(ts.assignmentId || '').trim();
      const asgn = aid ? mobById.get(aid) : undefined;
      if (ts.poActiveAutoDaily === true) {
        if (asgn && shouldDeleteStalePoActiveAutoDailyRow(asgn, ymd)) return false;
        if (asgn && isYmdInRemobGapBetweenCycles(asgn, ymd)) return false;
        if (ts.eventType === 'standby_day') {
          const firstM1 = firstM1InWindowByWorker.get(String(ts.workerId || '').trim());
          if (firstM1 && ymd >= firstM1) {
            droppedAutoStandby += 1;
            return false;
          }
        }
      }
      return true;
    }
    return false;
  });
  const addedExtras: DailyTimesheet[] = [];
  for (const retro of addedDays) {
    if (retro.id && matchedAddedIds.has(retro.id)) continue;
    const workerId = String(retro.workerId || '').trim();
    const include = includeAddedByWorker[workerId] === true;
    if (!include) {
      addedExcluded++;
      continue;
    }
    const assignment = mobById.get(String(retro.assignmentId || '').trim());
    const dateYmd = String(retro.workDateYmd || '').slice(0, 10);
    if (!assignment) {
      warnings.push(`ไม่นำวันจ่ายเพิ่ม ${dateYmd || '—'} มาวางบิล — ไม่พบการมอบหมาย`);
      continue;
    }
    const synthetic = buildBillableTimesheetForAddedDay(retro, assignment);
    if (!synthetic) {
      warnings.push(`ไม่นำวันจ่ายเพิ่ม ${dateYmd || '—'} มาวางบิล — ข้อมูลตำแหน่งไม่ครบ`);
      continue;
    }
    if (inAttendance.some((ts) => matchWorkDayReversal(ts, [retro]))) continue;
    addedExtras.push(synthetic);
    addedIncluded++;
  }
  if (reversalIncluded > 0) {
    warnings.push(`นำ ${reversalIncluded} วันที่มีหักเงินคืนมาวางบิล ตามที่ยืนยัน`);
  }
  if (reversalExcluded > 0) {
    warnings.push(`ตัด ${reversalExcluded} วันที่มีหักเงินคืนออกจากใบวางบิล ตามที่ยืนยัน`);
  }
  if (addedIncluded > 0) {
    warnings.push(`นำ ${addedIncluded} วันที่มีจ่ายเพิ่มมาวางบิล ตามที่ยืนยัน`);
  }
  if (addedExcluded > 0) {
    warnings.push(`ไม่นำ ${addedExcluded} วันที่มีจ่ายเพิ่มมาวางบิล ตามที่ยืนยัน`);
  }
  if (droppedAutoStandby > 0) {
    warnings.push(
      `ไม่นับ Standby อัตโนมัติ ${droppedAutoStandby} วัน — ตาราง timesheet ไม่ได้ลง SB (ช่องว่างระหว่าง M1 / รอ remob)`,
    );
  }
  const beforeBillingDedupe = inAttendance.length + addedExtras.length;
  let timesheets = dedupeTimesheetsForBilling([...inAttendance, ...addedExtras]);
  const billingDeduped = beforeBillingDedupe - timesheets.length;

  if (mobCycleFilter.length > 0) {
    const d1Sorted = timesheets
      .filter((ts) => ts.eventType === 'demobilization_day')
      .map((ts) => String(ts.date || '').slice(0, 10))
      .filter(Boolean)
      .sort();
    const lastD1InSheet = d1Sorted[d1Sorted.length - 1];
    const rangeEnd = dateRanges.reduce((m, r) => (r.endYmd > m ? r.endYmd : m), '');
    const includeDaysAfterD1 = Boolean(
      userTripRange && lastD1InSheet && rangeEnd && rangeEnd > lastD1InSheet,
    );
    const tripFiltered = filterTimesheetsForTripMobCycleBilling(timesheets, {
      includeDaysAfterD1,
      ...(userTripRange
        ? { rangeStartYmd: billingWindowStart, rangeEndYmd: billingWindowEnd }
        : {}),
    });
    timesheets = tripFiltered.timesheets;
    warnings.push(...tripFiltered.warnings);
    if (!userTripRange) {
      const trimmed = trimTimesheetsToTripMobDemobWindow(timesheets);
      timesheets = trimmed.timesheets;
      warnings.push(...trimmed.warnings);
    }
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

  if (dateRanges.length > 0) {
    const before = timesheets.length;
    timesheets = timesheets.filter((ts) => {
      const ymd = String(ts.date || '').slice(0, 10);
      return dateRanges.some((r) => ymd >= r.startYmd && ymd <= r.endYmd);
    });
    const dropped = before - timesheets.length;
    if (dropped > 0) {
      warnings.push(`จำกัดวันที่ตามช่วงที่ส่งออกบิล — ตัด ${dropped} แถว`);
    }
  }

  if (mobCycleFilter.length > 0) {
    if (userTripRange) {
      billedPeriodStart = dateRanges.reduce((m, r) => (r.startYmd < m ? r.startYmd : m), dateRanges[0]!.startYmd);
      billedPeriodEnd = dateRanges.reduce((m, r) => (r.endYmd > m ? r.endYmd : m), dateRanges[0]!.endYmd);
    } else {
      const billed = billedPeriodFromTimesheets(timesheets);
      billedPeriodStart = billed.start;
      billedPeriodEnd = billed.end;
    }
    if (billedPeriodStart && billedPeriodEnd) {
      const next = `วางบิลตามรอบเดินทาง — ${mobCycleFilter.length} mob cycle · ช่วง ${billedPeriodStart} ถึง ${billedPeriodEnd}`;
      const idx = warnings.findIndex((w) => w.startsWith('วางบิลตามรอบเดินทาง'));
      if (idx >= 0) warnings[idx] = next;
      else warnings.push(next);
    }
  }

  const attendanceDropped = normalized.length - inAttendance.length - reversalExcluded - addedSheetExcluded;
  if (attendanceDropped > 0) {
    warnings.push(
      `ไม่นับ ${attendanceDropped} แถวในวางบิล — ลาไม่จ่าย หรือแถวอัตโนมัติหลังวันจบไซต์ขณะรอ remob`,
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
        'หลังตัดซ้ำและตัดแถวอัตโนมัติหลังวันจบไซต์ ไม่เหลือ timesheet สำหรับวางบิล',
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
      ...(billedPeriodStart ? { billedPeriodStart } : {}),
      ...(billedPeriodEnd ? { billedPeriodEnd } : {}),
    };
  }

  if (!mainContract) {
    warnings.push(
      'PO ไม่มีสัญญาหลัก (contractId) — การคำนวณวางบิลควรผูกสัญญา; ระบบจะ fallback ไปราคา snapshot จาก PO line เมื่อจำเป็น',
    );
  }

  const contractRatesByPosition = new Map<string, PositionRate>();
  const contractRatesByContractPosition = new Map<string, PositionRate>();
  const contractsById = new Map<string, MainContract>();
  if (mainContract) contractsById.set(mainContract.id, mainContract);

  const loadContractRates = async (contractId: string) => {
    const cid = String(contractId || '').trim();
    if (!cid) return;
    const ratesSnap = await getDocs(collection(db, 'main_contracts', cid, 'position_rates'));
    for (const d of ratesSnap.docs) {
      const rate = { id: d.id, ...(d.data() as object) } as PositionRate;
      if (rate.active === false) continue;
      contractRatesByContractPosition.set(`${cid}::${rate.positionId}`, rate);
      if (!contractRatesByPosition.has(rate.positionId)) {
        contractRatesByPosition.set(rate.positionId, rate);
      }
    }
  };

  await loadContractRates(String(po.contractId || '').trim());
  const extraContractsToHydrate = [...extraContractIds].filter((cid) => !contractsById.has(cid));
  if (extraContractsToHydrate.length > 0) {
    const extraMcSnaps = await Promise.all(
      extraContractsToHydrate.map((cid) => getDoc(doc(db, 'main_contracts', cid))),
    );
    for (const s of extraMcSnaps) {
      if (!s.exists()) continue;
      contractsById.set(s.id, { ...(s.data() as MainContract), id: s.id });
    }
    await Promise.all(extraContractsToHydrate.map((cid) => loadContractRates(cid)));
  }

  const poWorkModeMap = buildPoWorkModeMapFromPurchaseOrders(posForWorkMode);
  const poByIdForLabel = new Map(posForWorkMode.map((p) => [p.id, p]));

  const positionLabels = await loadPositionLabels(db, [
    ...poLines.map((pl) => pl.positionId),
    ...timesheets.map((t) => t.positionId),
  ]);

  const accMap = new Map<string, LineAcc>();

  for (const ts of timesheets) {
    const poLine = resolvePoLineForBillingDay(ts, poLineMaps, warnings, billingLineMismatchWarned);
    const workMode = resolveEffectivePayrollJobMode(ts, poWorkModeMap);
    const tsContractId = String(
      ts.contractId || poByIdForLabel.get(String(ts.purchaseOrderId || '').trim())?.contractId || po.contractId || '',
    ).trim();
    const contractRate =
      (tsContractId
        ? contractRatesByContractPosition.get(`${tsContractId}::${ts.positionId}`)
        : undefined) || contractRatesByPosition.get(ts.positionId);
    const billingContract = (tsContractId ? contractsById.get(tsContractId) : undefined) || mainContract;

    if (!poLine) {
      if (!isUnpaidLeaveEvent(ts.eventType)) {
        const poLabel =
          poByIdForLabel.get(String(ts.purchaseOrderId || '').trim())?.poCode ||
          String(ts.purchaseOrderId || '').trim() ||
          po.poCode ||
          po.id;
        warnings.push(
          `ข้าม ${ts.date} (${ts.eventType}) — ไม่พบบรรทัดราคาตำแหน่งใน ${poLabel}`,
        );
      }
      continue;
    }

    const billingCharge = resolveCommercialInvoiceDayCharge(ts);
    const effectiveEvent = mobDayChargeKindToEventType(billingCharge.kind);
    if (ts.eventType === 'standby_day' && billingCharge.kind === 'WORKING') {
      warnings.push(
        `${ts.date}: เซลล์ SB แต่ตั้งวางบิลเป็น Working — นับในบรรทัดค่าแรงวันทำงาน (ไม่สร้างบรรทัดสแตนด์บาย)`,
      );
    }
    const projected: DailyTimesheet = {
      ...ts,
      eventType: effectiveEvent,
      normalHours:
        billingCharge.kind === 'M1' || billingCharge.kind === 'D1'
          ? Number(ts.normalHours) || 0
          : Math.max(0, Number(billingCharge.hours ?? ts.normalHours ?? 8)),
      ...(billingCharge.kind === 'STANDBY' ? { standbyUnits: Math.max(1, Number(ts.standbyUnits ?? 1)) } : {}),
      ...(billingCharge.kind === 'M1' ? { mobUnits: Math.max(1, Number(ts.mobUnits ?? 1)) } : {}),
      ...(billingCharge.kind === 'D1' ? { demobUnits: Math.max(1, Number(ts.demobUnits ?? 1)) } : {}),
    };

    if (projected.eventType === 'work_day') {
      if (resolveBillingSellWorkingDayRate({ poLine, workMode, contractRate }) <= 0) {
        warnings.push(`ข้าม work_day ${ts.date} — ราคาขายใน PO line เป็น 0`);
        continue;
      }
      workDayFromDayRateBilling(projected, poLine, billingContract, accMap, workMode, contractRate);
      continue;
    }

    billingNonWorkDayFromPoAndContract(
      projected,
      poLine,
      billingContract,
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
    ...(billedPeriodStart ? { billedPeriodStart } : {}),
    ...(billedPeriodEnd ? { billedPeriodEnd } : {}),
  };
}

/** สร้างบรรทัดวางบิลจาก mob cycles ในชุด trip batch (หลายคนต่อ invoice) */
export async function generateBillingLinesForMobCycles(
  db: Firestore,
  poId: string,
  mobCycleIds: readonly string[],
  periodStart: string,
  periodEnd: string,
  options?: Pick<
    GenerateBillingLinesOptions,
    | 'tripMobDemobLocationKey'
    | 'billingReversalIncludeByWorkerId'
    | 'billingAddedDayIncludeByWorkerId'
    | 'dateRanges'
    | 'extraPoIds'
  >,
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
  const extraPoIds = uniqueNonEmptyIds(poId, options?.extraPoIds);
  const base = await generateBillingLines(db, poId, periodStart, periodEnd, undefined, {
    mobCycleIds: ids,
    billingReversalIncludeByWorkerId: options?.billingReversalIncludeByWorkerId,
    billingAddedDayIncludeByWorkerId: options?.billingAddedDayIncludeByWorkerId,
    ...(options?.dateRanges && options.dateRanges.length > 0 ? { dateRanges: options.dateRanges } : {}),
    ...(extraPoIds.length > 1 ? { extraPoIds } : {}),
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

  const { isStandbyOnlyClosedTripBatch } = await import('@/lib/services/trip-billing-service');
  if (await isStandbyOnlyClosedTripBatch(db, ids)) {
    base.warnings.push('รอบ standby-only — ไม่คิดค่า Mob/Demob ไป-กลับ');
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
      ...(base.billedPeriodStart ? { billedPeriodStart: base.billedPeriodStart } : {}),
      ...(base.billedPeriodEnd ? { billedPeriodEnd: base.billedPeriodEnd } : {}),
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
    ...(base.billedPeriodStart ? { billedPeriodStart: base.billedPeriodStart } : {}),
    ...(base.billedPeriodEnd ? { billedPeriodEnd: base.billedPeriodEnd } : {}),
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
