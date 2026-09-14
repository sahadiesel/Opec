import type { Assignment, DailyTimesheet, PurchaseOrder, RateConditionEventType, Wave } from '@/lib/types';

function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function defaultApplyPayrollYmAfter(sourceYm: string): string {
  const [y, m] = sourceYm.split('-').map(Number);
  if (!y || !m) return ymNow();
  let nm = m + 1;
  let ny = y;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function buildSyntheticTimesheetForRetro(input: {
  workerId: string;
  workerName: string;
  assignment: Assignment;
  wave: Wave;
  po: PurchaseOrder | undefined;
  cellDate: string;
  existingTs?: DailyTimesheet;
}): DailyTimesheet {
  const { workerId, workerName, assignment, wave, po, cellDate, existingTs } = input;
  const contractId = (assignment.contractId || po?.contractId || '').trim();
  const poLineId = (assignment.poLineId || wave.poLineId || '').trim();
  const positionId = (assignment.positionId || '').trim();
  const id = `${workerId}_${assignment.id}_${cellDate}`;
  const eventType = (existingTs?.eventType as RateConditionEventType) ?? 'mobilization_day';
  return {
    id,
    workerId,
    assignmentId: assignment.id,
    date: cellDate,
    eventType,
    normalHours: existingTs?.normalHours ?? 12,
    ot15Hours: existingTs?.ot15Hours ?? 0,
    ot20Hours: existingTs?.ot20Hours ?? 0,
    ot30Hours: existingTs?.ot30Hours ?? 0,
    waveId: wave.id,
    siteId: wave.id,
    purchaseOrderId: assignment.poId || wave.poId,
    poLineId,
    contractId,
    customerId: wave.customerId || '',
    positionId,
    workMode: assignment.workMode ?? 'OFFSHORE',
    shiftType: 'DAY',
    workerNameSnapshot: existingTs?.workerNameSnapshot || workerName,
    status: existingTs?.status ?? 'LOCKED',
  } as DailyTimesheet;
}

export function sumAdjustmentOtHours(
  rows: readonly {
    addedOt15Hours?: number;
    addedOt20Hours?: number;
    addedOt30Hours?: number;
    status?: string;
  }[],
  status?: 'approved' | 'applied',
): number {
  return rows
    .filter((r) => (status ? r.status === status : r.status !== 'void'))
    .reduce(
      (s, r) =>
        s +
        Math.max(0, Number(r.addedOt15Hours) || 0) +
        Math.max(0, Number(r.addedOt20Hours) || 0) +
        Math.max(0, Number(r.addedOt30Hours) || 0),
      0,
    );
}
