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
  Position,
  PurchaseOrder,
  RateConditionEventType,
  MainContract,
} from '@/lib/types';
import { sellSnapshotForWorkMode } from '@/lib/commercial/position-rate-sell';
import { derivePackageNormalHourlyRate, PACKAGE_OT_TIER_MULT } from '@/lib/commercial/package-hourly-rate';
import { parseWorkDayHours } from '@/lib/commercial/package-work-day-hours';
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
  const sellRate = Number(sellSnapshotForWorkMode(poLine, ts.workMode) || 0);
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
    pushAcc(map, accKey(pos, 'work_day', amt), {
      workerId: wid,
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
    pushAcc(map, accKey(pos, 'work_day', up), {
      workerId: wid,
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
    pushAcc(map, accKey(pos, 'sell_overflow_normal', up), {
      workerId: wid,
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
    pushAcc(map, accKey(pos, 'ot_1.5', up), {
      workerId: wid,
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
    pushAcc(map, accKey(pos, 'ot_2.0', up), {
      workerId: wid,
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
    pushAcc(map, accKey(pos, 'ot_3.0', up), {
      workerId: wid,
      positionId: pos,
      eventType: 'ot_3.0',
      timesheetIds: tid,
      amount: t30,
      quantity: q,
    });
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
) {
  if (ts.eventType === 'unpaid_leave') return;

  const sellRate = sellSnapshotForWorkMode(poLine, ts.workMode);
  const otRules: OtRulesSnapshot = poLine.sellOtRulesSnapshot || {};
  const wid = ts.workerId;
  const pos = ts.positionId;
  const tid = [ts.id];

  if (PO_FALLBACK_FLAT_DAILY_EVENTS.includes(ts.eventType as RateConditionEventType)) {
    const mult = poFallbackSellDayMultiplier(mainContract, ts.eventType, otRules);
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

function peoplePrefix(acc: LineAcc): string {
  const n = acc.workerIds.size;
  if (n <= 0) return '';
  return `${n} คน · `;
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

function descriptionForLine(acc: LineAcc, positionTitle: string): string {
  const title = positionTitle || acc.positionId;
  const pfx = peoplePrefix(acc);
  const q = acc.totalQuantity;
  switch (acc.eventType) {
    case 'work_day':
      return `${title} — ค่าแรงวันทำงาน (${pfx}${q} วัน)`;
    case 'ot_1.5':
      return `${title} — OT x1.5 (${pfx}${q} ชม.)`;
    case 'ot_2.0':
      return `${title} — OT x2 (${pfx}${q} ชม.)`;
    case 'ot_3.0':
      return `${title} — OT x3 (${pfx}${q} ชม.)`;
    case 'off_day_worked':
      return `${title} — ทำงานวันหยุด (${pfx}${q} วัน)`;
    case 'standby_day':
      return `${title} — สแตนด์บาย (${pfx}${q} วัน)`;
    case 'travel_day':
      return `${title} — วันเดินทาง (${pfx}${q} วัน)`;
    case 'public_holiday_worked':
      return `${title} — ทำงานวันหยุดนักขัตฤกษ์ (${pfx}${q} วัน)`;
    case 'mobilization_day':
      return `${title} — โมบิไลเซชัน (${pfx}${q} วัน)`;
    case 'demobilization_day':
      return `${title} — ดีโมบิไลเซชัน (${pfx}${q} วัน)`;
    case 'sell_overflow_normal':
      return `${title} — ชม.ปกติเกินกรอบ 8 ชม. (ขาย) (${pfx}${q} ชม.)`;
    default:
      return `${title} — ${acc.eventType} (${pfx}${q} หน่วย)`;
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

  const [poLinesSnap, tsSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, 'purchase_orders', poId, 'po_lines'),
        where('status', '==', 'active'),
      ),
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

  const timesheets = tsSnap.docs.map(
    (d) => ({ ...d.data(), id: d.id } as DailyTimesheet),
  );

  if (timesheets.length === 0) {
    warnings.push(
      'ไม่พบ timesheet ที่พร้อมวางบิล (readyForBilling) ในช่วงเวลาที่เลือก',
    );
    return { lines: [], totalAmount: 0, timesheetCount: 0, warnings };
  }

  if (!mainContract) {
    warnings.push(
      'PO ไม่มีสัญญาหลัก (contractId) — การคำนวณวางบิลควรผูกสัญญา; ระบบจะ fallback ไปราคา snapshot จาก PO line เมื่อจำเป็น',
    );
  }

  const positionLabels = await loadPositionLabels(db, [
    ...poLines.map((pl) => pl.positionId),
    ...timesheets.map((t) => t.positionId),
  ]);

  const accMap = new Map<string, LineAcc>();

  for (const ts of timesheets) {
    const poLine = poLinesByPosition.get(ts.positionId);

    if (!poLine) {
      warnings.push(`ข้าม ${ts.date} (${ts.eventType}) — ไม่มี PO line สำหรับตำแหน่ง`);
      continue;
    }

    if (ts.eventType === 'work_day') {
      if (Number(sellSnapshotForWorkMode(poLine, ts.workMode) || 0) <= 0) {
        warnings.push(`ข้าม work_day ${ts.date} — ราคาขายใน PO line เป็น 0`);
        continue;
      }
      workDayFromPackageBilling(ts, poLine, mainContract, accMap, warnings);
      continue;
    }

    billingNonWorkDayFromPoAndContract(ts, poLine, mainContract, accMap, warnings);
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
