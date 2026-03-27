'use client';

import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
} from 'firebase/firestore';
import type {
  DailyTimesheet,
  POLine,
  BillingNoteLine,
  OtRulesSnapshot,
} from '@/lib/types';

interface WorkerLineGroup {
  workerId: string;
  workerName: string;
  positionId: string;
  poLineId: string;
  timesheetIds: string[];
  normalDays: number;
  ot15Hours: number;
  ot20Hours: number;
  ot30Hours: number;
  holidayDays: number;
  standbyDays: number;
  travelDays: number;
}

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

/**
 * Generates billing note lines by matching approved timesheets against PO Line sell rates.
 *
 * Logic per worker:
 *   - 1 line for normal work_day (qty = days, unitPrice = sellRate)
 *   - 1 line per OT tier if hours > 0 (qty = hours, unitPrice = hourlyRate * multiplier)
 *   - 1 line for standby/travel etc. at full sellRate per day
 */
export async function generateBillingLines(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
  waveId?: string,
): Promise<BillingLineGenerationResult> {
  const warnings: string[] = [];

  // 1. Fetch PO Lines
  const poLinesSnap = await getDocs(
    query(
      collection(db, 'purchase_orders', poId, 'po_lines'),
      where('status', '==', 'active'),
    ),
  );
  const poLines = poLinesSnap.docs.map(
    (d) => ({ ...d.data(), id: d.id } as POLine),
  );

  if (poLines.length === 0) {
    warnings.push('ไม่พบ PO Line ที่ active ใน PO นี้');
    return { lines: [], totalAmount: 0, timesheetCount: 0, warnings };
  }

  const poLinesByPosition = new Map<string, POLine>();
  for (const pl of poLines) {
    poLinesByPosition.set(pl.positionId, pl);
  }

  // 2. Fetch approved/ready-for-billing timesheets
  const constraints = [
    where('purchaseOrderId', '==', poId),
    where('readyForBilling', '==', true),
    where('date', '>=', periodStart),
    where('date', '<=', periodEnd),
  ];
  if (waveId) constraints.push(where('waveId', '==', waveId));

  const tsSnap = await getDocs(
    query(collection(db, 'daily_timesheets'), ...constraints),
  );
  const timesheets = tsSnap.docs.map(
    (d) => ({ ...d.data(), id: d.id } as DailyTimesheet),
  );

  if (timesheets.length === 0) {
    warnings.push(
      'ไม่พบ timesheet ที่พร้อมวางบิล (readyForBilling) ในช่วงเวลาที่เลือก',
    );
    return { lines: [], totalAmount: 0, timesheetCount: 0, warnings };
  }

  // 3. Group by worker + position
  const grouped = new Map<string, WorkerLineGroup>();
  for (const ts of timesheets) {
    const key = `${ts.workerId}__${ts.positionId}`;
    let g = grouped.get(key);
    if (!g) {
      g = {
        workerId: ts.workerId,
        workerName: ts.workerNameSnapshot,
        positionId: ts.positionId,
        poLineId: ts.poLineId,
        timesheetIds: [],
        normalDays: 0,
        ot15Hours: 0,
        ot20Hours: 0,
        ot30Hours: 0,
        holidayDays: 0,
        standbyDays: 0,
        travelDays: 0,
      };
      grouped.set(key, g);
    }
    g.timesheetIds.push(ts.id);

    switch (ts.eventType) {
      case 'work_day':
        g.normalDays += 1;
        break;
      case 'standby_day':
        g.standbyDays += 1;
        break;
      case 'travel_day':
        g.travelDays += 1;
        break;
      case 'off_day_worked':
        g.holidayDays += 1;
        break;
      default:
        g.normalDays += 1;
        break;
    }
    g.ot15Hours += ts.ot15Hours || 0;
    g.ot20Hours += ts.ot20Hours || 0;
    g.ot30Hours += ts.ot30Hours || 0;
  }

  // 4. Generate lines
  const lines: GeneratedBillingLine[] = [];

  for (const g of grouped.values()) {
    const poLine = poLinesByPosition.get(g.positionId);
    if (!poLine) {
      warnings.push(
        `${g.workerName} (${g.positionId}): ไม่พบ PO Line — ข้ามรายการ`,
      );
      continue;
    }

    const sellRate = poLine.sellRateSnapshot;
    const otRules: OtRulesSnapshot = poLine.sellOtRulesSnapshot || {};
    const normalWorkHours = poLine.normalWorkHoursSnapshot || 12;

    if (g.normalDays > 0) {
      const amt = g.normalDays * sellRate;
      lines.push({
        description: `${g.workerName} — ค่าแรงวันทำงาน (${g.normalDays} วัน)`,
        referenceType: 'TIMESHEET',
        workerId: g.workerId,
        workerName: g.workerName,
        positionId: g.positionId,
        eventType: 'work_day',
        timesheetIds: g.timesheetIds,
        quantity: g.normalDays,
        unitPrice: sellRate,
        amount: amt,
      });
    }

    if (g.ot15Hours > 0) {
      const mult = otRules.afterShift ?? 1.5;
      const amt = calcOtAmount(g.ot15Hours, sellRate, normalWorkHours, mult);
      lines.push({
        description: `${g.workerName} — OT x${mult} (${g.ot15Hours} ชม.)`,
        referenceType: 'TIMESHEET',
        workerId: g.workerId,
        workerName: g.workerName,
        positionId: g.positionId,
        eventType: 'ot_1.5',
        timesheetIds: g.timesheetIds,
        quantity: g.ot15Hours,
        unitPrice: (sellRate / normalWorkHours) * mult,
        amount: amt,
      });
    }

    if (g.ot20Hours > 0) {
      const mult = 2.0;
      const amt = calcOtAmount(g.ot20Hours, sellRate, normalWorkHours, mult);
      lines.push({
        description: `${g.workerName} — OT x${mult} (${g.ot20Hours} ชม.)`,
        referenceType: 'TIMESHEET',
        workerId: g.workerId,
        workerName: g.workerName,
        positionId: g.positionId,
        eventType: 'ot_2.0',
        timesheetIds: g.timesheetIds,
        quantity: g.ot20Hours,
        unitPrice: (sellRate / normalWorkHours) * mult,
        amount: amt,
      });
    }

    if (g.ot30Hours > 0) {
      const mult = 3.0;
      const amt = calcOtAmount(g.ot30Hours, sellRate, normalWorkHours, mult);
      lines.push({
        description: `${g.workerName} — OT x${mult} (${g.ot30Hours} ชม.)`,
        referenceType: 'TIMESHEET',
        workerId: g.workerId,
        workerName: g.workerName,
        positionId: g.positionId,
        eventType: 'ot_3.0',
        timesheetIds: g.timesheetIds,
        quantity: g.ot30Hours,
        unitPrice: (sellRate / normalWorkHours) * mult,
        amount: amt,
      });
    }

    if (g.holidayDays > 0) {
      const mult = otRules.holiday ?? 1.0;
      const amt = g.holidayDays * sellRate * mult;
      lines.push({
        description: `${g.workerName} — ทำงานวันหยุด x${mult} (${g.holidayDays} วัน)`,
        referenceType: 'TIMESHEET',
        workerId: g.workerId,
        workerName: g.workerName,
        positionId: g.positionId,
        eventType: 'off_day_worked',
        timesheetIds: g.timesheetIds,
        quantity: g.holidayDays,
        unitPrice: sellRate * mult,
        amount: amt,
      });
    }

    if (g.standbyDays > 0) {
      lines.push({
        description: `${g.workerName} — สแตนด์บาย (${g.standbyDays} วัน)`,
        referenceType: 'TIMESHEET',
        workerId: g.workerId,
        workerName: g.workerName,
        positionId: g.positionId,
        eventType: 'standby_day',
        timesheetIds: g.timesheetIds,
        quantity: g.standbyDays,
        unitPrice: sellRate,
        amount: g.standbyDays * sellRate,
      });
    }

    if (g.travelDays > 0) {
      lines.push({
        description: `${g.workerName} — วันเดินทาง (${g.travelDays} วัน)`,
        referenceType: 'TIMESHEET',
        workerId: g.workerId,
        workerName: g.workerName,
        positionId: g.positionId,
        eventType: 'travel_day',
        timesheetIds: g.timesheetIds,
        quantity: g.travelDays,
        unitPrice: sellRate,
        amount: g.travelDays * sellRate,
      });
    }
  }

  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);

  return {
    lines,
    totalAmount,
    timesheetCount: timesheets.length,
    warnings,
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
