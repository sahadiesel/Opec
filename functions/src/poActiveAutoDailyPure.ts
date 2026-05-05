/**
 * Pure helpers — keep in sync with src/lib/timesheet/po-active-auto-daily-build.ts
 * and src/lib/ops/po-active-bundle.ts (bundle key only).
 */

export type JobMode = 'ONSHORE' | 'OFFSHORE';

export type AssignmentLike = {
  id: string;
  deploymentStatus?: string;
  unassignedAt?: number;
  poId?: string;
  poLineId?: string;
  workerId?: string;
  waveId?: string;
  workerName?: string;
  contractId?: string;
  positionId: string;
  /** ข้อมูลเก่าอาจว่าง — ใช้ OFFSHORE เป็นค่าเริ่มต้นเช่นเดียวกับ PO */
  workMode?: JobMode;
  mobWorkingStartDate?: string;
  startDate?: string;
  mobLocationEndDate?: string;
  endDate?: string;
  poActiveAutoWorkSuspended?: boolean;
  poActiveStandbyAutoStartYmd?: string;
  poActiveStandbyAutoEndYmd?: string;
};

export type PurchaseOrderLike = {
  id: string;
  contractId?: string;
  customerId?: string;
  poActiveBundleId?: string;
  poWorkMode?: JobMode;
  endDate?: number;
};

export type POLineLike = {
  id: string;
  normalWorkHoursSnapshot?: number;
};

export type DailyTimesheetLike = {
  status?: string;
  poActiveAutoDaily?: boolean;
};

export function thailandTodayYmd(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

export function poActiveDailyTimesheetDocId(workerId: string, assignmentId: string, date: string): string {
  return `${workerId}_${assignmentId}_${date}`;
}

function msToYmdUtc(ms: unknown): string {
  const n = typeof ms === 'number' && Number.isFinite(ms) ? ms : Date.now();
  return new Date(n).toISOString().slice(0, 10);
}

export function poActiveBundleDocId(customerId: string, workMode: JobMode): string {
  return `${customerId}__${workMode}`;
}

export function normalizePoActiveBundleId(raw: string): string {
  const s = (raw || '').trim();
  if (!s || s.startsWith('orphan:')) return s;
  if (s.endsWith('__ONSHORE') || s.endsWith('__OFFSHORE')) return s;
  if (s.endsWith('_ONSHORE') && !s.endsWith('__ONSHORE')) {
    return `${s.slice(0, -'_ONSHORE'.length)}__ONSHORE`;
  }
  if (s.endsWith('_OFFSHORE') && !s.endsWith('__OFFSHORE')) {
    return `${s.slice(0, -'_OFFSHORE'.length)}__OFFSHORE`;
  }
  return s;
}

export function resolvePoActiveBundleKeyForPo(po: PurchaseOrderLike): string {
  const bid = (po.poActiveBundleId || '').trim();
  if (bid) return normalizePoActiveBundleId(bid);
  const cid = (po.customerId || '').trim();
  if (!cid) return `orphan:${po.id}`;
  const mode = po.poWorkMode ?? 'OFFSHORE';
  return poActiveBundleDocId(cid, mode);
}

export function isAssignmentEligibleForPoActiveAutoDaily(a: AssignmentLike): boolean {
  if (a.deploymentStatus !== 'ACTIVE') return false;
  if (typeof a.unassignedAt === 'number' && a.unassignedAt > 0) return false;
  return !!(a.poId?.trim() && a.poLineId?.trim() && a.workerId?.trim() && a.waveId?.trim());
}

/** sync กับ src/lib/timesheet/po-active-auto-daily-build.ts — resolvePoActiveAutoDailySyncKind */
export function resolvePoActiveAutoDailySyncKind(
  a: AssignmentLike,
  dateYmd: string,
): 'work_day' | 'standby_day' | null {
  if (!isAssignmentEligibleForPoActiveAutoDaily(a)) return null;
  const suspended = a.poActiveAutoWorkSuspended === true;
  const sbStart = (a.poActiveStandbyAutoStartYmd || '').trim().slice(0, 10);
  const sbEnd = (a.poActiveStandbyAutoEndYmd || '').trim().slice(0, 10);
  const hasSeg = /^\d{4}-\d{2}-\d{2}$/.test(sbStart) && /^\d{4}-\d{2}-\d{2}$/.test(sbEnd);
  if (suspended) {
    if (!hasSeg) return null;
    if (dateYmd >= sbStart && dateYmd <= sbEnd) return 'standby_day';
    if (dateYmd > sbEnd) return null;
  }
  return 'work_day';
}

export function computePoActiveAutoDailyRange(
  a: AssignmentLike,
  po: Pick<PurchaseOrderLike, 'endDate'>,
): { start: string; end: string } | null {
  const today = thailandTodayYmd();
  const throughYmd = today;
  const startRaw = ((a.mobWorkingStartDate || a.startDate || '') as string).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) return null;

  const endFromMob = ((a.mobLocationEndDate || a.endDate || '') as string).trim();
  const endFromPo = msToYmdUtc(po.endDate);
  let cap = throughYmd;
  if (/^\d{4}-\d{2}-\d{2}$/.test(endFromMob)) {
    cap = minYmd(cap, endFromMob);
  }
  cap = minYmd(cap, endFromPo);

  if (startRaw > cap) return null;
  return { start: startRaw, end: cap };
}

export function normalHoursFromPoLine(line: POLineLike): number {
  const h = line.normalWorkHoursSnapshot;
  if (h === 12 || h === 8) return h;
  return 8;
}

export function buildPoActiveAutoDailyRowPayload(p: {
  assignment: AssignmentLike;
  po: PurchaseOrderLike;
  line: POLineLike;
  date: string;
  workerNameSnapshot: string;
  poActiveBundleId: string;
  laborCostContractTermId?: string;
}): Record<string, unknown> {
  const { assignment: a, po, line, date, workerNameSnapshot, poActiveBundleId, laborCostContractTermId } = p;
  const contractId = (a.contractId || po.contractId || '').trim();
  const siteId = (a.waveId || '').trim();
  const nh = normalHoursFromPoLine(line);
  const workMode: JobMode = a.workMode === 'ONSHORE' || a.workMode === 'OFFSHORE' ? a.workMode : 'OFFSHORE';

  return {
    workerId: a.workerId,
    assignmentId: a.id,
    date,
    workerNameSnapshot,
    waveId: siteId,
    contractId,
    purchaseOrderId: po.id,
    poLineId: line.id,
    poActiveBundleId,
    customerId: po.customerId,
    siteId,
    positionId: a.positionId,
    workMode,
    eventType: 'work_day',
    shiftType: 'DAY',
    normalHours: nh,
    ot15Hours: 0,
    ot20Hours: 0,
    ot30Hours: 0,
    status: 'DRAFT',
    readyForPayroll: false,
    readyForBilling: false,
    sourceType: 'DIGITAL',
    poActiveAutoDaily: true,
    remark: 'Auto — PO Active workflow',
    ...(laborCostContractTermId ? { laborCostContractTermId } : {}),
  };
}

export function buildPoActiveAutoStandbyRowPayload(p: {
  assignment: AssignmentLike;
  po: PurchaseOrderLike;
  line: POLineLike;
  date: string;
  workerNameSnapshot: string;
  poActiveBundleId: string;
  laborCostContractTermId?: string;
}): Record<string, unknown> {
  const row = buildPoActiveAutoDailyRowPayload(p);
  return {
    ...row,
    eventType: 'standby_day',
    shiftType: 'STANDBY',
    remark: 'Auto — PO Active standby stop',
  };
}
