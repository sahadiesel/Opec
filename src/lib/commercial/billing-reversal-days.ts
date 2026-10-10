import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { defaultPackageHoursForWorkMode } from '@/lib/ops/mob-day-charge';
import type { Assignment, DailyTimesheet, TimesheetRetroAdjustment } from '@/lib/types';

export type BillingReversalDay = {
  timesheetId: string;
  dateYmd: string;
  /** 30/09/2569 */
  dateLabel: string;
  eventLabel: 'W' | 'SB';
};

export type BillingReversalWorkerPrompt = {
  workerId: string;
  workerName: string;
  days: BillingReversalDay[];
};

export type BillingRetroPromptSet = {
  reversals: BillingReversalWorkerPrompt[];
  addedDays: BillingReversalWorkerPrompt[];
};

export type BillingRetroChoices = {
  reversalIncludeByWorkerId: Record<string, boolean>;
  addedDayIncludeByWorkerId: Record<string, boolean>;
};

export function emptyBillingRetroChoices(): BillingRetroChoices {
  return { reversalIncludeByWorkerId: {}, addedDayIncludeByWorkerId: {} };
}

function thaiBeLabel(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-');
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${Number(y) + 543}`;
}

function eventLabelOf(retro: TimesheetRetroAdjustment): 'W' | 'SB' {
  return retro.retroEventType === 'standby_day' ? 'SB' : 'W';
}

function monthsCovering(periodStart: string, periodEnd: string): string[] {
  const start = periodStart.slice(0, 7);
  const end = periodEnd.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start)) return [];
  if (!/^\d{4}-\d{2}$/.test(end) || end <= start) return [start];
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  for (let i = 0; i < 36; i++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym >= end) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** วันหักเงินคืน และวันจ่ายเพิ่มหลังจ่ายค่าแรงแล้ว — ถามก่อนวางบิล */
export async function listBillingRetroPrompts(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
  workerIds?: readonly string[],
): Promise<BillingRetroPromptSet> {
  const rows = await loadWorkDayRetrosForBillingPeriod(db, poId, periodStart, periodEnd, workerIds);
  const reversals = groupRetroPrompts(rows.filter((row) => row.adjustmentKind === 'work_day_reversal'));
  const addedDays = groupRetroPrompts(rows.filter((row) => row.adjustmentKind === 'work_day_add'));
  await fillWorkerNames(db, [...reversals, ...addedDays]);
  const byName = (a: BillingReversalWorkerPrompt, b: BillingReversalWorkerPrompt) =>
    a.workerName.localeCompare(b.workerName, 'th', { sensitivity: 'base' });
  reversals.sort(byName);
  addedDays.sort(byName);
  return { reversals, addedDays };
}

/** วันที่มีรายการหักเงินคืน (work_day_reversal) ในงวดนี้ — ใช้ถามก่อนวางบิล */
export async function listBillingReversalPrompts(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
  workerIds?: readonly string[],
): Promise<BillingReversalWorkerPrompt[]> {
  const set = await listBillingRetroPrompts(db, poId, periodStart, periodEnd, workerIds);
  return set.reversals;
}

function groupRetroPrompts(reversals: readonly TimesheetRetroAdjustment[]): BillingReversalWorkerPrompt[] {
  const byWorker = new Map<string, BillingReversalWorkerPrompt>();
  for (const retro of reversals) {
    const workerId = String(retro.workerId || '').trim();
    const dateYmd = String(retro.workDateYmd || '').slice(0, 10);
    if (!workerId || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) continue;
    const day: BillingReversalDay = {
      timesheetId: String(retro.sourceTimesheetId || '').trim(),
      dateYmd,
      dateLabel: thaiBeLabel(dateYmd),
      eventLabel: eventLabelOf(retro),
    };
    const cur = byWorker.get(workerId);
    if (!cur) {
      byWorker.set(workerId, {
        workerId,
        workerName: String(retro.workerNameSnapshot || '').trim() || workerId,
        days: [day],
      });
      continue;
    }
    if (!cur.days.some((d) => d.dateYmd === day.dateYmd && d.eventLabel === day.eventLabel)) {
      cur.days.push(day);
    }
    if (cur.workerName === workerId && retro.workerNameSnapshot?.trim()) {
      cur.workerName = retro.workerNameSnapshot.trim();
    }
  }
  const prompts = [...byWorker.values()];
  for (const prompt of prompts) {
    prompt.days.sort((a, b) => a.dateYmd.localeCompare(b.dateYmd) || a.eventLabel.localeCompare(b.eventLabel));
  }
  return prompts;
}

async function fillWorkerNames(db: Firestore, prompts: BillingReversalWorkerPrompt[]): Promise<void> {
  for (const prompt of prompts) {
    const current = prompt.workerName.trim();
    if (current && current !== prompt.workerId) continue;
    const snap = await getDoc(doc(db, 'workers', prompt.workerId));
    if (!snap.exists()) continue;
    const w = snap.data() as {
      firstName?: string;
      lastName?: string;
      firstNameTh?: string;
      lastNameTh?: string;
      workerCode?: string;
    };
    const en = `${w.firstName || ''} ${w.lastName || ''}`.replace(/\s+/g, ' ').trim();
    const th = `${w.firstNameTh || ''} ${w.lastNameTh || ''}`.replace(/\s+/g, ' ').trim();
    prompt.workerName = en || th || (w.workerCode || '').trim() || prompt.workerId;
  }
}

export async function loadWorkDayReversalsForBillingPeriod(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
  workerIds?: readonly string[],
): Promise<TimesheetRetroAdjustment[]> {
  const rows = await loadWorkDayRetrosForBillingPeriod(db, poId, periodStart, periodEnd, workerIds);
  return rows.filter((row) => row.adjustmentKind === 'work_day_reversal');
}

export async function loadWorkDayAddsForBillingPeriod(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
  workerIds?: readonly string[],
): Promise<TimesheetRetroAdjustment[]> {
  const rows = await loadWorkDayRetrosForBillingPeriod(db, poId, periodStart, periodEnd, workerIds);
  return rows.filter((row) => row.adjustmentKind === 'work_day_add');
}

async function loadWorkDayRetrosForBillingPeriod(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
  workerIds?: readonly string[],
): Promise<TimesheetRetroAdjustment[]> {
  const pid = poId.trim();
  const start = periodStart.slice(0, 10);
  const end = periodEnd.slice(0, 10);
  if (!pid || !start || !end) return [];
  const allow = new Set((workerIds ?? []).map((id) => id.trim()).filter(Boolean));
  const { loadTimesheetRetroAdjustmentsForMonth } = await import(
    '@/lib/services/timesheet-retro-adjustment-service'
  );
  const seen = new Set<string>();
  const out: TimesheetRetroAdjustment[] = [];
  for (const ym of monthsCovering(start, end)) {
    const rows = await loadTimesheetRetroAdjustmentsForMonth(db, ym);
    for (const row of rows) {
      if (row.adjustmentKind !== 'work_day_reversal' && row.adjustmentKind !== 'work_day_add') continue;
      if (row.status === 'void') continue;
      const dateYmd = String(row.workDateYmd || '').slice(0, 10);
      if (dateYmd < start || dateYmd > end) continue;
      const po = String(row.purchaseOrderId || '').trim();
      if (po && po !== pid) continue;
      const workerId = String(row.workerId || '').trim();
      if (allow.size > 0 && !allow.has(workerId)) continue;
      const id = String(row.id || '').trim();
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(row);
    }
  }
  return out;
}

function sameReversalEvent(
  timesheetEvent: string | undefined,
  retroEvent: string | undefined,
): boolean {
  const retro = retroEvent === 'standby_day' ? 'standby_day' : 'work_day';
  const ts = timesheetEvent === 'standby_day' ? 'standby_day' : 'work_day';
  return retro === ts;
}

export function matchWorkDayReversal(
  ts: Pick<DailyTimesheet, 'id' | 'workerId' | 'date' | 'purchaseOrderId' | 'eventType'>,
  reversals: readonly TimesheetRetroAdjustment[],
): TimesheetRetroAdjustment | undefined {
  const id = String(ts.id || '').trim();
  const bySource = reversals.find((row) => {
    const sourceId = String(row.sourceTimesheetId || '').trim();
    return Boolean(id && sourceId && sourceId === id);
  });
  if (bySource) return bySource;
  const workerId = String(ts.workerId || '').trim();
  const dateYmd = String(ts.date || '').slice(0, 10);
  const poId = String(ts.purchaseOrderId || '').trim();
  return reversals.find((row) => {
    if (String(row.workerId || '').trim() !== workerId) return false;
    if (String(row.workDateYmd || '').slice(0, 10) !== dateYmd) return false;
    if (!sameReversalEvent(ts.eventType, row.retroEventType)) return false;
    const retroPo = String(row.purchaseOrderId || '').trim();
    return !retroPo || !poId || retroPo === poId;
  });
}

/** วันจ่ายเพิ่มไม่มีใบงานใน daily_timesheets — สร้างแถววางบิลเมื่อผู้ใช้ยืนยัน */
export function buildBillableTimesheetForAddedDay(
  retro: TimesheetRetroAdjustment,
  assignment: Assignment,
): DailyTimesheet | null {
  const dateYmd = String(retro.workDateYmd || '').slice(0, 10);
  const workerId = String(retro.workerId || '').trim();
  const positionId = String(assignment.positionId || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd) || !workerId || !positionId) return null;
  const hours = defaultPackageHoursForWorkMode(assignment.workMode);
  const id = String(retro.sourceTimesheetId || '').trim() || `add_${retro.id}`;
  return {
    id,
    workerId,
    assignmentId: assignment.id,
    date: dateYmd,
    eventType: 'work_day',
    normalHours: hours,
    ot15Hours: 0,
    ot20Hours: 0,
    ot30Hours: 0,
    waveId: String(retro.waveId || assignment.waveId || ''),
    siteId: String(retro.waveId || assignment.waveId || ''),
    purchaseOrderId: String(retro.purchaseOrderId || assignment.poId || ''),
    poLineId: String(assignment.poLineId || ''),
    contractId: String(assignment.contractId || ''),
    customerId: String(assignment.customerId || ''),
    positionId,
    workMode: assignment.workMode,
    shiftType: 'DAY',
    workerNameSnapshot: String(retro.workerNameSnapshot || assignment.workerName || workerId),
    status: 'LOCKED',
    poActiveAutoDaily: false,
    readyForBilling: true,
  } as DailyTimesheet;
}
