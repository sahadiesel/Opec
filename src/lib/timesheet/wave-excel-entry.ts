import type {
  Assignment,
  DailyTimesheet,
  DailyTimesheetStatus,
  PurchaseOrder,
  RateConditionEventType,
  Wave,
} from '@/lib/types';

function isDocFinalized(status: DailyTimesheetStatus): boolean {
  return ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED'].includes(status);
}

/** UI สถานะวัน — map ไป DailyTimesheet.eventType + ชั่วโมง */
export type WaveExcelUiKind = 'unset' | 'no_work' | 'normal' | 'with_ot' | 'standby' | 'special';

export type WaveExcelRowVisual = 'gray' | 'red' | 'yellow' | 'green';

export const WAVE_EXCEL_DEFAULT_NORMAL_HOURS = 12;

export interface WaveExcelRowState {
  workerId: string;
  assignmentId: string;
  uiKind: WaveExcelUiKind;
  normalHours: number;
  ot15: number;
  ot20: number;
  ot30: number;
  standbyUnits: number;
  mobUnits: number;
  remark: string;
  docStatus?: DailyTimesheetStatus;
  locked: boolean;
}

const UI_SEQUENCE: WaveExcelUiKind[] = ['no_work', 'normal', 'with_ot', 'standby', 'special'];

export function cycleUiKind(current: WaveExcelUiKind): WaveExcelUiKind {
  if (current === 'unset') return 'normal';
  const i = UI_SEQUENCE.indexOf(current);
  if (i < 0) return 'normal';
  return UI_SEQUENCE[(i + 1) % UI_SEQUENCE.length];
}

export function labelUiKind(k: WaveExcelUiKind): string {
  switch (k) {
    case 'unset':
      return 'ยังไม่เลือก';
    case 'no_work':
      return 'ไม่ลงงาน';
    case 'normal':
      return 'ทำงานปกติ';
    case 'with_ot':
      return 'มี OT';
    case 'standby':
      return 'Standby';
    case 'special':
      return 'Bump / พิเศษ';
    default:
      return '';
  }
}

export function emojiUiKind(k: WaveExcelUiKind): string {
  switch (k) {
    case 'unset':
      return '⚪';
    case 'no_work':
      return '❌';
    case 'normal':
      return '🟢';
    case 'with_ot':
      return '🟡';
    case 'standby':
      return '🔵';
    case 'special':
      return '🟣';
    default:
      return '';
  }
}

export function dailyDocToRowState(ts: DailyTimesheet): WaveExcelRowState {
  const locked = isDocFinalized(ts.status);
  let uiKind: WaveExcelUiKind = 'unset';
  if (ts.eventType === 'unpaid_leave' || ts.eventType === 'client_cancellation') {
    uiKind = 'no_work';
  } else if (ts.eventType === 'standby_day') {
    uiKind = 'standby';
  } else if (
    ts.eventType === 'mobilization_day' ||
    ts.eventType === 'demobilization_day' ||
    ts.eventType === 'public_holiday_worked' ||
    ts.eventType === 'off_day_worked' ||
    ts.eventType === 'travel_day' ||
    ts.eventType === 'training_day' ||
    ts.eventType === 'other'
  ) {
    uiKind = 'special';
  } else if (ts.eventType === 'work_day') {
    const ot = (ts.ot15Hours || 0) + (ts.ot20Hours || 0) + (ts.ot30Hours || 0);
    uiKind = ot > 0 ? 'with_ot' : 'normal';
  } else {
    uiKind = 'special';
  }

  return {
    workerId: ts.workerId,
    assignmentId: ts.assignmentId,
    uiKind,
    normalHours: ts.normalHours ?? WAVE_EXCEL_DEFAULT_NORMAL_HOURS,
    ot15: ts.ot15Hours || 0,
    ot20: ts.ot20Hours || 0,
    ot30: ts.ot30Hours || 0,
    standbyUnits: ts.standbyUnits ?? 1,
    mobUnits: ts.mobUnits ?? 1,
    remark: ts.remark || '',
    docStatus: ts.status,
    locked,
  };
}

export function defaultRowState(workerId: string, assignmentId: string): WaveExcelRowState {
  return {
    workerId,
    assignmentId,
    uiKind: 'unset',
    normalHours: WAVE_EXCEL_DEFAULT_NORMAL_HOURS,
    ot15: 0,
    ot20: 0,
    ot30: 0,
    standbyUnits: 1,
    mobUnits: 1,
    remark: '',
    locked: false,
  };
}

export function rowIsComplete(r: WaveExcelRowState): boolean {
  if (r.locked) return true;
  switch (r.uiKind) {
    case 'unset':
      return false;
    case 'no_work':
      return true;
    case 'normal':
      return r.normalHours > 0;
    case 'with_ot':
      return r.normalHours > 0 && r.ot15 + r.ot20 + r.ot30 > 0;
    case 'standby':
      return (r.standbyUnits ?? 0) > 0;
    case 'special':
      return (r.mobUnits ?? 0) > 0 || r.normalHours > 0;
    default:
      return false;
  }
}

export function rowVisual(r: WaveExcelRowState, gridLoaded: boolean): WaveExcelRowVisual {
  if (!gridLoaded) return 'gray';
  if (r.locked) return 'green';
  if (r.uiKind === 'unset') return 'red';
  if (rowIsComplete(r)) return 'green';
  return 'yellow';
}

export function waveExcelSummary(rows: WaveExcelRowState[], gridLoaded: boolean) {
  const total = rows.length;
  let green = 0;
  let yellow = 0;
  let red = 0;
  let gray = 0;
  for (const r of rows) {
    const v = rowVisual(r, gridLoaded);
    if (v === 'green') green++;
    else if (v === 'yellow') yellow++;
    else if (v === 'red') red++;
    else gray++;
  }
  return { total, green, yellow, red, gray };
}

export interface BuildPayloadContext {
  waveId: string;
  targetDate: string;
  workerName: string;
  assignment: Assignment;
  wave: Wave;
  po: PurchaseOrder;
}

export function rowStateToTimesheetPayload(
  r: WaveExcelRowState,
  ctx: BuildPayloadContext
): Partial<DailyTimesheet> | null {
  if (r.locked || r.uiKind === 'unset') return null;

  const { assignment: asgn, wave, po, waveId, targetDate, workerName } = ctx;
  const contractId =
    asgn.contractId && asgn.contractId.length > 0 ? asgn.contractId : po.contractId || 'UNASSIGNED';
  const siteId = (asgn.waveId && asgn.waveId.length > 0 ? asgn.waveId : wave.id) || 'site';

  const base = {
    workerId: r.workerId,
    assignmentId: r.assignmentId,
    date: targetDate,
    workerNameSnapshot: workerName,
    waveId,
    purchaseOrderId: asgn.poId,
    poLineId: asgn.poLineId || `po-line-${asgn.id}`,
    contractId,
    siteId,
    positionId: asgn.positionId,
    workMode: asgn.workMode,
    remark: r.remark?.trim() || undefined,
    status: 'DRAFT' as const,
    readyForPayroll: false,
    readyForBilling: false,
    sourceType: 'PAPER' as const,
  };

  const zeroOt = { ot15Hours: 0, ot20Hours: 0, ot30Hours: 0 };

  switch (r.uiKind) {
    case 'no_work':
      return {
        ...base,
        eventType: 'unpaid_leave' as RateConditionEventType,
        shiftType: 'DAY' as const,
        normalHours: 0,
        ...zeroOt,
        standbyUnits: 0,
        mobUnits: 0,
        demobUnits: 0,
      };
    case 'normal':
      return {
        ...base,
        eventType: 'work_day' as RateConditionEventType,
        shiftType: 'DAY' as const,
        normalHours: r.normalHours,
        ...zeroOt,
      };
    case 'with_ot':
      return {
        ...base,
        eventType: 'work_day' as RateConditionEventType,
        shiftType: 'DAY' as const,
        normalHours: r.normalHours,
        ot15Hours: r.ot15,
        ot20Hours: r.ot20,
        ot30Hours: r.ot30,
      };
    case 'standby':
      return {
        ...base,
        eventType: 'standby_day' as RateConditionEventType,
        shiftType: 'STANDBY' as const,
        normalHours: 0,
        ...zeroOt,
        standbyUnits: Math.max(0, r.standbyUnits || 1),
      };
    case 'special':
      return {
        ...base,
        eventType: 'mobilization_day' as RateConditionEventType,
        shiftType: 'DAY' as const,
        normalHours: r.normalHours || 0,
        ...zeroOt,
        mobUnits: Math.max(0, r.mobUnits || 1),
      };
    default:
      return null;
  }
}

export function poOverlapsPayrollPeriod(po: PurchaseOrder, periodStart: string, periodEnd: string): boolean {
  const s = new Date(periodStart + 'T00:00:00').getTime();
  const e = new Date(periodEnd + 'T23:59:59').getTime();
  return po.startDate <= e && po.endDate >= s;
}
