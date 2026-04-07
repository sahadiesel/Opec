'use client';

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
  DailyTimesheet,
  POLine,
  OtRulesSnapshot,
  PurchaseOrder,
  SalesContractTerm,
  RateCondition,
  MainContract,
} from '@/lib/types';
import { derivePackageNormalHourlyRate, PACKAGE_OT_TIER_MULT } from '@/lib/commercial/package-hourly-rate';
import { parseWorkDayHours } from '@/lib/commercial/package-work-day-hours';
import { resolveSellRestDay, type SellRestDayResolution } from '@/lib/commercial/sell-rest-day';
import { resolveActiveSalesContractTerm } from '@/lib/services/contract-resolver';
import {
  resolveApplicableSalesRateCondition,
  calculateDailySalesValue,
  resolveQuantityForUnit,
} from '@/lib/services/sales-calculator';

export interface GeneratedBillingLine {
  description: string;
  referenceType: 'TIMESHEET';
  workerId: string;
  workerName: string;
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

interface LineAcc {
  workerId: string;
  workerName: string;
  positionId: string;
  eventType: string;
  timesheetIds: string[];
  totalAmount: number;
  totalQuantity: number;
}

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
 * work_day จากแพ็กขาย PO (sellRateSnapshot) สมมาตรกับ payroll: แพ็ก 8/12 + ตัวคูณขาย + tier + วันพิเศษฝั่งขาย
 * - ตัวคูณขาย OT ≤ 1: เก็บรายวันแบบแบน (ไม่แยก OT) × ตัวคูณวันหยุดขาย
 * - ตัวคูณขาย OT > 1: แยก 8 ชม. + overflow normal + ot15/20/30 เหมือนฝั่งต้นทุน
 */
function workDayFromPackageBilling(
  ts: DailyTimesheet,
  poLine: POLine,
  mainContract: MainContract | undefined,
  map: Map<string, LineAcc>,
  warnings: string[],
) {
  const sellRate = Number(poLine.sellRateSnapshot || 0);
  if (sellRate <= 0) return;

  const sellOtMult =
    Number(poLine.sellOtRulesSnapshot?.afterShift) ||
    Number(mainContract?.rateMultiplierPolicy?.sell?.otAfterShift) ||
    1;

  const statedHours = poLine.normalWorkHoursSnapshot === 12 ? 12 : 8;
  const sellRest = resolveSellRestDay(ts.date, mainContract);
  const w = ts.workerNameSnapshot;
  const wid = ts.workerId;
  const pos = ts.positionId;
  const tid = [ts.id];

  if (sellOtMult <= 1) {
    let amt = sellRate;
    if (sellRest.active && sellRest.kind === 'public_holiday') {
      amt *= Math.max(0, sellRest.publicHolidayWrap ?? 1);
    } else if (sellRest.active && sellRest.kind === 'weekly_rest') {
      amt *= Math.max(0, sellRest.weeklyNormalMult ?? 1);
    }
    pushAcc(map, accKey(wid, pos, 'work_day', amt), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'work_day',
      timesheetIds: tid,
      amount: amt,
      quantity: 1,
    });
    return;
  }

  const h = derivePackageNormalHourlyRate(sellRate, statedHours, sellOtMult);
  if (h <= 0) {
    warnings.push(`${w} (${ts.date}): ไม่สามารถคำนวณฐานชม.ขายจากแพ็ก — ข้าม`);
    return;
  }

  const wh = parseWorkDayHours(ts);
  const normalPart0 = wh.legalNormal * h;
  const overflowPart0 = wh.overflowNormal * h * sellOtMult;
  const tier15 = wh.o15 * h * PACKAGE_OT_TIER_MULT.OT_1_5;
  const tier20 = wh.o20 * h * PACKAGE_OT_TIER_MULT.OT_2_0;
  const tier30 = wh.o30 * h * PACKAGE_OT_TIER_MULT.OT_3_0;

  const normalPart = applySellRestMultiplier(normalPart0, sellRest, 'normal');
  const overflowPart = applySellRestMultiplier(overflowPart0, sellRest, 'ot');
  const t15 = applySellRestMultiplier(tier15, sellRest, 'ot');
  const t20 = applySellRestMultiplier(tier20, sellRest, 'ot');
  const t30 = applySellRestMultiplier(tier30, sellRest, 'ot');

  if (wh.legalNormal > 0 && normalPart > 0) {
    const q = wh.legalNormal;
    const up = normalPart / q;
    pushAcc(map, accKey(wid, pos, 'work_day', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'work_day',
      timesheetIds: tid,
      amount: normalPart,
      quantity: q,
    });
  }
  if (wh.overflowNormal > 0 && overflowPart > 0) {
    const q = wh.overflowNormal;
    const up = overflowPart / q;
    pushAcc(map, accKey(wid, pos, 'sell_overflow_normal', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'sell_overflow_normal',
      timesheetIds: tid,
      amount: overflowPart,
      quantity: q,
    });
  }
  if (wh.o15 > 0 && t15 > 0) {
    const q = wh.o15;
    const up = t15 / q;
    pushAcc(map, accKey(wid, pos, 'ot_1.5', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'ot_1.5',
      timesheetIds: tid,
      amount: t15,
      quantity: q,
    });
  }
  if (wh.o20 > 0 && t20 > 0) {
    const q = wh.o20;
    const up = t20 / q;
    pushAcc(map, accKey(wid, pos, 'ot_2.0', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'ot_2.0',
      timesheetIds: tid,
      amount: t20,
      quantity: q,
    });
  }
  if (wh.o30 > 0 && t30 > 0) {
    const q = wh.o30;
    const up = t30 / q;
    pushAcc(map, accKey(wid, pos, 'ot_3.0', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'ot_3.0',
      timesheetIds: tid,
      amount: t30,
      quantity: q,
    });
  }
}

function accKey(
  workerId: string,
  positionId: string,
  eventType: string,
  unitPrice: number,
): string {
  const up = roundMoney(unitPrice);
  return `${workerId}__${positionId}__${eventType}__${up}`;
}

function pushAcc(
  map: Map<string, LineAcc>,
  key: string,
  row: Omit<LineAcc, 'totalAmount' | 'totalQuantity'> & {
    amount: number;
    quantity: number;
  },
) {
  let a = map.get(key);
  if (!a) {
    a = {
      workerId: row.workerId,
      workerName: row.workerName,
      positionId: row.positionId,
      eventType: row.eventType,
      timesheetIds: [],
      totalAmount: 0,
      totalQuantity: 0,
    };
    map.set(key, a);
  }
  a.totalAmount += row.amount;
  a.totalQuantity += row.quantity;
  if (!a.timesheetIds.includes(row.timesheetIds[0])) {
    a.timesheetIds.push(row.timesheetIds[0]);
  }
}

function tsWithoutOtHours(ts: DailyTimesheet): DailyTimesheet {
  return {
    ...ts,
    ot15Hours: 0,
    ot20Hours: 0,
    ot30Hours: 0,
    holidayHours: 0,
  };
}

function workDayContractParts(
  ts: DailyTimesheet,
  term: SalesContractTerm,
  conditions: RateCondition[],
): {
  dailyAnchor: number;
  workCond: RateCondition;
  normalWorkHours: number;
} | null {
  const workCond = resolveApplicableSalesRateCondition(conditions, ts, term);
  if (!workCond) return null;
  const normalWorkHours =
    ts.normalHours && ts.normalHours > 0 ? ts.normalHours : 12;
  const tsBase = tsWithoutOtHours(ts);
  const dailyAnchor = calculateDailySalesValue(tsBase, workCond, 0);
  return { dailyAnchor, workCond, normalWorkHours };
}

function workDayFromPoLine(
  ts: DailyTimesheet,
  poLine: POLine,
  map: Map<string, LineAcc>,
) {
  const sellRate = poLine.sellRateSnapshot;
  const otRules: OtRulesSnapshot = poLine.sellOtRulesSnapshot || {};
  const normalWorkHours = poLine.normalWorkHoursSnapshot || 12;
  const w = ts.workerNameSnapshot;
  const wid = ts.workerId;
  const pos = ts.positionId;
  const tid = [ts.id];

  const baseAmt = sellRate;
  const upBase = baseAmt;
  pushAcc(map, accKey(wid, pos, 'work_day', upBase), {
    workerId: wid,
    workerName: w,
    positionId: pos,
    eventType: 'work_day',
    timesheetIds: tid,
    amount: baseAmt,
    quantity: 1,
  });

  const ot15 = ts.ot15Hours || 0;
  if (ot15 > 0) {
    const mult = otRules.afterShift ?? DEFAULT_OT_MULT.ot15;
    const amt = calcOtAmount(ot15, sellRate, normalWorkHours, mult);
    const up = (sellRate / normalWorkHours) * mult;
    pushAcc(map, accKey(wid, pos, 'ot_1.5', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'ot_1.5',
      timesheetIds: tid,
      amount: amt,
      quantity: ot15,
    });
  }
  const ot20 = ts.ot20Hours || 0;
  if (ot20 > 0) {
    const mult = DEFAULT_OT_MULT.ot20;
    const amt = calcOtAmount(ot20, sellRate, normalWorkHours, mult);
    const up = (sellRate / normalWorkHours) * mult;
    pushAcc(map, accKey(wid, pos, 'ot_2.0', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'ot_2.0',
      timesheetIds: tid,
      amount: amt,
      quantity: ot20,
    });
  }
  const ot30 = ts.ot30Hours || 0;
  if (ot30 > 0) {
    const mult = DEFAULT_OT_MULT.ot30;
    const amt = calcOtAmount(ot30, sellRate, normalWorkHours, mult);
    const up = (sellRate / normalWorkHours) * mult;
    pushAcc(map, accKey(wid, pos, 'ot_3.0', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'ot_3.0',
      timesheetIds: tid,
      amount: amt,
      quantity: ot30,
    });
  }
}

function workDayFromContract(
  ts: DailyTimesheet,
  term: SalesContractTerm,
  conditions: RateCondition[],
  poLine: POLine | undefined,
  map: Map<string, LineAcc>,
  warnings: string[],
) {
  const parts = workDayContractParts(ts, term, conditions);
  if (!parts) {
    if (poLine) {
      warnings.push(
        `${ts.workerNameSnapshot} (${ts.date}): ไม่พบเงื่อนไขขาย work_day — ใช้ราคา snapshot จาก PO line`,
      );
      workDayFromPoLine(ts, poLine, map);
    } else {
      warnings.push(
        `${ts.workerNameSnapshot} (${ts.date}): ไม่พบเงื่อนไขขาย work_day และไม่มี PO line สำหรับตำแหน่งนี้ — ข้าม`,
      );
    }
    return;
  }

  const { dailyAnchor, workCond, normalWorkHours } = parts;
  const w = ts.workerNameSnapshot;
  const wid = ts.workerId;
  const pos = ts.positionId;
  const tid = [ts.id];

  if (workCond.unitType === 'HOUR') {
    const amount = calculateDailySalesValue(ts, workCond, 0);
    const qty = resolveQuantityForUnit(ts, workCond.unitType);
    if (qty <= 0) {
      warnings.push(`${w} (${ts.date}): work_day แบบ HOUR แต่จำนวนชั่วโมงเป็น 0 — ข้าม`);
      return;
    }
    const up = amount / qty;
    pushAcc(map, accKey(wid, pos, 'work_day', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'work_day',
      timesheetIds: tid,
      amount,
      quantity: qty,
    });
    return;
  }

  if (dailyAnchor > 0) {
    pushAcc(map, accKey(wid, pos, 'work_day', dailyAnchor), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'work_day',
      timesheetIds: tid,
      amount: dailyAnchor,
      quantity: 1,
    });
  }

  const anchor = dailyAnchor > 0 ? dailyAnchor : (workCond.baseRate ?? 0);
  if (anchor <= 0) {
    if ((ts.ot15Hours || 0) + (ts.ot20Hours || 0) + (ts.ot30Hours || 0) > 0) {
      warnings.push(
        `${w} (${ts.date}): ไม่สามารถคำนวณ OT ได้ (daily rate เป็น 0) — ข้าม OT`,
      );
    } else if (dailyAnchor <= 0) {
      warnings.push(
        `${w} (${ts.date}): work_day ได้มูลค่า 0 จากเงื่อนไขขาย — ข้าม`,
      );
    }
    return;
  }

  const ot15 = ts.ot15Hours || 0;
  if (ot15 > 0) {
    const mult = DEFAULT_OT_MULT.ot15;
    const amt = calcOtAmount(ot15, anchor, normalWorkHours, mult);
    const up = (anchor / normalWorkHours) * mult;
    pushAcc(map, accKey(wid, pos, 'ot_1.5', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'ot_1.5',
      timesheetIds: tid,
      amount: amt,
      quantity: ot15,
    });
  }
  const ot20 = ts.ot20Hours || 0;
  if (ot20 > 0) {
    const mult = DEFAULT_OT_MULT.ot20;
    const amt = calcOtAmount(ot20, anchor, normalWorkHours, mult);
    const up = (anchor / normalWorkHours) * mult;
    pushAcc(map, accKey(wid, pos, 'ot_2.0', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'ot_2.0',
      timesheetIds: tid,
      amount: amt,
      quantity: ot20,
    });
  }
  const ot30 = ts.ot30Hours || 0;
  if (ot30 > 0) {
    const mult = DEFAULT_OT_MULT.ot30;
    const amt = calcOtAmount(ot30, anchor, normalWorkHours, mult);
    const up = (anchor / normalWorkHours) * mult;
    pushAcc(map, accKey(wid, pos, 'ot_3.0', up), {
      workerId: wid,
      workerName: w,
      positionId: pos,
      eventType: 'ot_3.0',
      timesheetIds: tid,
      amount: amt,
      quantity: ot30,
    });
  }
}

function genericEventFromContract(
  ts: DailyTimesheet,
  term: SalesContractTerm,
  conditions: RateCondition[],
  poLine: POLine | undefined,
  map: Map<string, LineAcc>,
  warnings: string[],
) {
  const cond = resolveApplicableSalesRateCondition(conditions, ts, term);
  if (cond) {
    const amount = calculateDailySalesValue(ts, cond, 0);
    const qty = Math.max(resolveQuantityForUnit(ts, cond.unitType), 0);
    if (qty <= 0 && amount <= 0) return;
    const q = qty > 0 ? qty : 1;
    const up = amount / q;
    pushAcc(map, accKey(ts.workerId, ts.positionId, ts.eventType, up), {
      workerId: ts.workerId,
      workerName: ts.workerNameSnapshot,
      positionId: ts.positionId,
      eventType: ts.eventType,
      timesheetIds: [ts.id],
      amount,
      quantity: q,
    });
    return;
  }

  if (!poLine) {
    warnings.push(
      `${ts.workerNameSnapshot} (${ts.date}, ${ts.eventType}): ไม่พบเงื่อนไขขายและไม่มี PO line — ข้าม`,
    );
    return;
  }

  warnings.push(
    `${ts.workerNameSnapshot} (${ts.date}, ${ts.eventType}): ไม่พบเงื่อนไขขาย — ใช้ราคา snapshot จาก PO line`,
  );
  const sellRate = poLine.sellRateSnapshot;
  const otRules: OtRulesSnapshot = poLine.sellOtRulesSnapshot || {};
  const normalWorkHours = poLine.normalWorkHoursSnapshot || 12;
  const w = ts.workerNameSnapshot;
  const wid = ts.workerId;
  const pos = ts.positionId;
  const tid = [ts.id];

  switch (ts.eventType) {
    case 'off_day_worked': {
      const mult = otRules.holiday ?? 1.0;
      const amt = sellRate * mult;
      const up = sellRate * mult;
      pushAcc(map, accKey(wid, pos, 'off_day_worked', up), {
        workerId: wid,
        workerName: w,
        positionId: pos,
        eventType: 'off_day_worked',
        timesheetIds: tid,
        amount: amt,
        quantity: 1,
      });
      break;
    }
    case 'standby_day': {
      pushAcc(map, accKey(wid, pos, 'standby_day', sellRate), {
        workerId: wid,
        workerName: w,
        positionId: pos,
        eventType: 'standby_day',
        timesheetIds: tid,
        amount: sellRate,
        quantity: 1,
      });
      break;
    }
    case 'travel_day': {
      pushAcc(map, accKey(wid, pos, 'travel_day', sellRate), {
        workerId: wid,
        workerName: w,
        positionId: pos,
        eventType: 'travel_day',
        timesheetIds: tid,
        amount: sellRate,
        quantity: 1,
      });
      break;
    }
    default:
      warnings.push(
        `${w} (${ts.date}, ${ts.eventType}): ไม่มีเงื่อนไขขายและไม่รองรับ fallback จาก PO — ข้าม`,
      );
  }
}

function descriptionForLine(acc: LineAcc): string {
  const w = acc.workerName;
  const q = acc.totalQuantity;
  switch (acc.eventType) {
    case 'work_day':
      return `${w} — ค่าแรงวันทำงาน (${q} วัน)`;
    case 'ot_1.5':
      return `${w} — OT x1.5 (${q} ชม.)`;
    case 'ot_2.0':
      return `${w} — OT x2 (${q} ชม.)`;
    case 'ot_3.0':
      return `${w} — OT x3 (${q} ชม.)`;
    case 'off_day_worked':
      return `${w} — ทำงานวันหยุด (${q} วัน)`;
    case 'standby_day':
      return `${w} — สแตนด์บาย (${q} วัน)`;
    case 'travel_day':
      return `${w} — วันเดินทาง (${q} วัน)`;
    case 'sell_overflow_normal':
      return `${w} — ชม.ปกติเกินกรอบ 8 ชม. (ขาย) (${q} ชม.)`;
    default:
      return `${w} — ${acc.eventType} (${q} หน่วย)`;
  }
}

/**
 * Generates billing note lines from approved timesheets.
 *
 * **work_day** + `sellRateSnapshot` > 0: แพ็กขาย 8/12 ชม. + ตัวคูณขาย (PO/สัญญา) สมมาตร payroll — ก่อน rate conditions
 * อื่นๆ / work_day ไม่มีราคา PO: sales terms + rate conditions; PO snapshot เป็น fallback
 */
export async function generateBillingLines(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
  waveId?: string,
): Promise<BillingLineGenerationResult> {
  const warnings: string[] = [];

  const poRef = doc(db, 'purchase_orders', poId);
  const poSnap = await getDoc(poRef);
  if (!poSnap.exists()) {
    warnings.push('ไม่พบ PO');
    return { lines: [], totalAmount: 0, timesheetCount: 0, warnings };
  }
  const po = { ...poSnap.data(), id: poSnap.id } as PurchaseOrder;

  let mainContract: MainContract | undefined;
  if (po.contractId) {
    const mcSnap = await getDoc(doc(db, 'main_contracts', po.contractId));
    if (mcSnap.exists()) {
      mainContract = { ...(mcSnap.data() as MainContract), id: mcSnap.id };
    }
  }

  const tsConstraints = [
    where('purchaseOrderId', '==', poId),
    where('readyForBilling', '==', true),
    where('date', '>=', periodStart),
    where('date', '<=', periodEnd),
  ];
  if (waveId) tsConstraints.push(where('waveId', '==', waveId));

  const [poLinesSnap, salesTermsSnap, rateCondSnap, tsSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, 'purchase_orders', poId, 'po_lines'),
        where('status', '==', 'active'),
      ),
    ),
    getDocs(
      query(
        collection(db, 'sales_contract_terms'),
        where('customerId', '==', po.customerId),
      ),
    ),
    getDocs(
      query(collection(db, 'rate_conditions'), where('appliesTo', '==', 'SALES')),
    ),
    getDocs(query(collection(db, 'daily_timesheets'), ...tsConstraints)),
  ]);

  const poLines = poLinesSnap.docs.map(
    (d) => ({ ...d.data(), id: d.id } as POLine),
  );
  const poLinesByPosition = new Map<string, POLine>();
  for (const pl of poLines) {
    poLinesByPosition.set(pl.positionId, pl);
  }

  const salesTerms = salesTermsSnap.docs.map(
    (d) => ({ ...d.data(), id: d.id } as SalesContractTerm),
  );
  const rateConditions = rateCondSnap.docs
    .map((d) => ({ ...d.data(), id: d.id } as RateCondition))
    .filter((c) => c.parentType === 'SALES_CONTRACT');

  const timesheets = tsSnap.docs.map(
    (d) => ({ ...d.data(), id: d.id } as DailyTimesheet),
  );

  if (timesheets.length === 0) {
    warnings.push(
      'ไม่พบ timesheet ที่พร้อมวางบิล (readyForBilling) ในช่วงเวลาที่เลือก',
    );
    return { lines: [], totalAmount: 0, timesheetCount: 0, warnings };
  }

  if (salesTerms.length === 0) {
    warnings.push(
      'ไม่พบ sales contract terms ของลูกค้านี้ — จะใช้ราคา snapshot จาก PO line เมื่อจำเป็น',
    );
  }

  const accMap = new Map<string, LineAcc>();

  for (const ts of timesheets) {
    const termRes = resolveActiveSalesContractTerm(salesTerms, {
      poId,
      customerId: po.customerId,
      date: ts.date,
    });
    warnings.push(...termRes.warnings);

    const term = termRes.data;
    const poLine = poLinesByPosition.get(ts.positionId);
    const conditions = term
      ? rateConditions.filter((c) => c.parentId === term.id)
      : [];

    if (
      ts.eventType === 'work_day' &&
      poLine &&
      Number(poLine.sellRateSnapshot || 0) > 0
    ) {
      workDayFromPackageBilling(
        ts,
        poLine,
        mainContract,
        accMap,
        warnings,
      );
      continue;
    }

    if (!term) {
      if (ts.eventType === 'work_day') {
        if (poLine) {
          warnings.push(
            `${ts.workerNameSnapshot} (${ts.date}): ไม่พบ sales term ที่ใช้ได้ — ใช้ราคา snapshot จาก PO line (legacy)`,
          );
          workDayFromPoLine(ts, poLine, accMap);
        } else {
          warnings.push(
            `${ts.workerNameSnapshot} (${ts.date}): ไม่พบ sales term และไม่มี PO line — ข้าม`,
          );
        }
      } else if (poLine) {
        warnings.push(
          `${ts.workerNameSnapshot} (${ts.date}): ไม่พบ sales term — ใช้ PO line สำหรับบางประเภทวัน`,
        );
        genericEventFromContract(ts, {} as SalesContractTerm, [], poLine, accMap, warnings);
      } else {
        warnings.push(
          `${ts.workerNameSnapshot} (${ts.date}): ไม่พบ sales term และไม่มี PO line — ข้าม`,
        );
      }
      continue;
    }

    if (ts.eventType === 'work_day') {
      workDayFromContract(ts, term, conditions, poLine, accMap, warnings);
    } else {
      genericEventFromContract(ts, term, conditions, poLine, accMap, warnings);
    }
  }

  const lines: GeneratedBillingLine[] = [];

  for (const acc of accMap.values()) {
    const qty = acc.totalQuantity;
    const amount = roundMoney(acc.totalAmount);
    const unitPrice = qty > 0 ? roundMoney(amount / qty) : 0;
    lines.push({
      description: descriptionForLine(acc),
      referenceType: 'TIMESHEET',
      workerId: acc.workerId,
      workerName: acc.workerName,
      positionId: acc.positionId,
      eventType: acc.eventType,
      timesheetIds: acc.timesheetIds,
      quantity: roundMoney(qty),
      unitPrice,
      amount,
    });
  }

  lines.sort((a, b) =>
    `${a.workerName} ${a.eventType}`.localeCompare(
      `${b.workerName} ${b.eventType}`,
      'th',
    ),
  );

  const totalAmount = roundMoney(lines.reduce((s, l) => s + l.amount, 0));

  return {
    lines,
    totalAmount,
    timesheetCount: timesheets.length,
    warnings: [...new Set(warnings)],
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
      workerId: line.workerId,
      workerName: line.workerName,
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
