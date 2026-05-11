import type { PortalLocale } from '@/lib/i18n/client-portal-dictionary';
import { assignmentIncludedInWaveTimesheetRoster } from '@/lib/constants/timesheet-ui';
import { assignmentOverlapsYearMonthForPoDailyBoard } from '@/lib/ops/timesheet-hub-po-month';
import { poTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import {
  lastDayOfCalendarMonth,
  mobilizationsEligibleForPoMonthGrid,
} from '@/lib/timesheet/wave-month-utils';
import { dedupeAssignmentsByWorkerAndWave, pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';
import type { DocumentSnapshot, Firestore, Query } from 'firebase/firestore';
import { collection, doc, getDoc, orderBy, query, where } from 'firebase/firestore';
import type {
  AccountsReceivable,
  Assignment,
  CommercialInvoice,
  DailyTimesheet,
  PurchaseOrder,
  TaxInvoice,
  Wave,
} from '@/lib/types';

/** Portal: hide internal "ลูกค้า" label and leading hierarchical indices in PO codes when present */
export function formatPoCodeForPortal(code: string | undefined): string {
  if (!code?.trim()) return '';
  let s = code.replace(/\s*ลูกค้า\s*/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:\d+\.)+\d+\s+/, '');
  return s;
}

/**
 * Portal tables: prefer the customer's own PO document number; otherwise formatted OPEC PO code.
 */
export function formatCustomerPoNumberForPortal(po: PurchaseOrder | null | undefined, fallbackPoId: string): string {
  const ext = po?.customerPONumber?.trim();
  if (ext) return ext;
  if (po?.poCode) return formatPoCodeForPortal(po.poCode) || po.poCode;
  return fallbackPoId;
}

/** Names from mobilization snapshot or timesheet rows — avoids workers collection list (portal rules). */
export function workerDisplayName(
  workerId: string,
  mob: Assignment | undefined,
  waveSheets: DailyTimesheet[],
): string {
  const fromMob = mob?.workerName?.trim();
  if (fromMob) return fromMob;
  const snap = waveSheets.find((s) => s.workerId === workerId)?.workerNameSnapshot?.trim();
  if (snap) return snap;
  return workerId;
}

/**
 * ตำแหน่งงานใน roster เดือน (ใช้จาก mobilization/assignment ก่อน, สำรองจาก timesheet แถวแรกของคนนั้น)
 */
export function workerPositionIdForRoster(
  workerId: string,
  mob: Assignment | undefined,
  waveSheets: DailyTimesheet[],
): string {
  const fromMob = mob?.positionId?.trim();
  if (fromMob) return fromMob;
  const ts = waveSheets.find((s) => s.workerId === workerId);
  return (ts?.positionId || '').trim();
}

/**
 * PO + เดือน (portal): roster หลักตามกฎสรุปรายเดือน — เติมคนที่มีแถว `daily_timesheets` ในเดือนนี้ของ PO
 * แต่ถูกคัดออกด้วย `assignmentHasAnyMobTimesheetDayInCalendarMonth` (ช่วง mobilization ไม่ทับวันในปฏิทินทุกวัน แต่มีจริงใน DB)
 */
export function buildPortalPoMonthRosterAssignments(
  assignmentsForPo: Assignment[],
  monthYm: string,
  poId: string,
  poMonthDailySheets: DailyTimesheet[],
): Assignment[] {
  const pid = poId.trim();
  const strict = mobilizationsEligibleForPoMonthGrid(assignmentsForPo, monthYm, poMonthDailySheets);
  const strictWorkerIds = new Set(strict.map((a) => a.workerId));

  const monthPrefix = `${monthYm}-`;
  const sheetRowsForPoMonth = filterDailyTimesheetsForPortalPoMonthGrid(
    poMonthDailySheets,
    pid,
    monthYm,
    assignmentsForPo,
  );

  const workersWithSheets = new Set(sheetRowsForPoMonth.map((ts) => ts.workerId));

  const supplemental: Assignment[] = [];
  for (const wid of workersWithSheets) {
    if (strictWorkerIds.has(wid)) continue;

    const tsForWorker = sheetRowsForPoMonth.filter((ts) => ts.workerId === wid);
    const assignmentIdsFromTs = new Set(
      tsForWorker
        .map((ts) => ts.assignmentId)
        .filter((id): id is string => typeof id === 'string' && id.trim() !== ''),
    );

    const workerMobs = assignmentsForPo.filter((a) => a.workerId === wid);
    let narrowed =
      assignmentIdsFromTs.size > 0
        ? workerMobs.filter((a) => assignmentIdsFromTs.has(a.id))
        : workerMobs;
    if (narrowed.length === 0 && assignmentIdsFromTs.size > 0) {
      narrowed = workerMobs;
    }

    const picked = pickRosterLinePerWorker(narrowed)[0];
    if (!picked || !assignmentIncludedInWaveTimesheetRoster(picked)) continue;

    const tsTouchesAssignment = tsForWorker.some(
      (ts) => ts.assignmentId && ts.assignmentId === picked.id,
    );
    const overlapsBoard = assignmentOverlapsYearMonthForPoDailyBoard(picked, monthYm);

    if (overlapsBoard || tsTouchesAssignment) {
      supplemental.push(picked);
    }
  }

  const merged = dedupeAssignmentsByWorkerAndWave([...strict, ...supplemental]);
  const covered = new Set(merged.map((a) => a.workerId));

  const fromSheetsOnly: Assignment[] = [];
  for (const wid of workersWithSheets) {
    if (covered.has(wid)) continue;
    const tsForWorker = sheetRowsForPoMonth.filter((ts) => ts.workerId === wid);
    const anyMob = pickRosterLinePerWorker(assignmentsForPo.filter((a) => a.workerId === wid))[0];
    if (anyMob) {
      fromSheetsOnly.push(anyMob);
      continue;
    }
    if (tsForWorker.length > 0) {
      fromSheetsOnly.push(syntheticAssignmentFromPortalTimesheets(wid, tsForWorker, pid));
    }
  }

  return dedupeAssignmentsByWorkerAndWave([...merged, ...fromSheetsOnly]);
}

/** Most recent calendar months as yyyy-MM (current month first). */
export function getLastNCalendarMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    out.push(`${y}-${m}`);
  }
  return out;
}

export function formatYearMonthLabel(ym: string, locale: PortalLocale): string {
  const [ys, ms] = ym.split('-').map(Number);
  if (!ys || !ms) return ym;
  const d = new Date(ys, ms - 1, 1);
  return d.toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', { month: 'short', year: 'numeric' });
}

/** `poId_yyyy-MM` — แยก `poId` กับเดือนจาก `sourcePoMonthReviewId` */
export function poIdAndYearMonthFromPoMonthReviewId(source: string | undefined): { poId: string; yearMonth: string } | null {
  const s = source?.trim();
  if (!s) return null;
  const i = s.lastIndexOf('_');
  if (i < 0) return null;
  const ym = s.slice(i + 1);
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const poId = s.slice(0, i);
  if (!poId) return null;
  return { poId, yearMonth: ym };
}

export function poMonthTimesheetReviewDocId(poId: string, yearMonth: string): string {
  return `${poId}_${yearMonth}`;
}

/** Calendar month yyyy-MM for a commercial invoice (review id suffix or period start). */
export function yearMonthFromCommercialInvoice(inv: CommercialInvoice): string | null {
  const poSrc = inv.sourcePoMonthReviewId?.trim();
  if (poSrc) {
    const p = poIdAndYearMonthFromPoMonthReviewId(poSrc);
    if (p) return p.yearMonth;
  }
  const sid = inv.sourceWaveMonthReviewId?.trim();
  if (sid) {
    const m = sid.match(/(\d{4}-\d{2})$/);
    if (m) return m[1];
  }
  const ps = inv.periodStart?.slice(0, 7);
  if (ps && /^\d{4}-\d{2}$/.test(ps)) return ps;
  const pe = inv.periodEnd?.slice(0, 7);
  if (pe && /^\d{4}-\d{2}$/.test(pe)) return pe;
  return null;
}

/**
 * Portal: read month review doc — permission denied (e.g. non-approved status) must not break the whole hub scan.
 */
export async function portalTryGetWaveMonthReviewSnap(
  db: Firestore,
  waveId: string,
  yearMonth: string,
): Promise<DocumentSnapshot | null> {
  try {
    return await getDoc(doc(db, 'wave_month_timesheet_reviews', `${waveId}_${yearMonth}`));
  } catch {
    return null;
  }
}

export async function portalTryGetPoMonthReviewSnap(
  db: Firestore,
  poId: string,
  yearMonth: string,
): Promise<DocumentSnapshot | null> {
  try {
    return await getDoc(doc(db, 'po_month_timesheet_reviews', poMonthTimesheetReviewDocId(poId, yearMonth)));
  } catch {
    return null;
  }
}

/**
 * Waves from the normal portal query plus any wave referenced by a commercial invoice for this customer
 * (covers cases where the wave list was empty or missing a row while billing already exists).
 */
export async function mergeWavesWithCommercialReferences(
  db: Firestore,
  customerId: string,
  baseWaves: Wave[],
  commercials: CommercialInvoice[] | undefined,
): Promise<Wave[]> {
  const map = new Map(baseWaves.map((w) => [w.id, w]));
  for (const c of commercials ?? []) {
    if (c.status === 'VOID' || !c.waveId) continue;
    if (map.has(c.waveId)) continue;
    let snap;
    try {
      snap = await getDoc(doc(db, 'waves', c.waveId));
    } catch {
      continue;
    }
    if (!snap.exists()) continue;
    const w = { id: snap.id, ...(snap.data() as object) } as Wave;
    if (w.customerId === customerId) map.set(w.id, w);
  }
  return [...map.values()];
}

/**
 * Timesheets for one wave + calendar month — matches internal wave-month view.
 * Do not rely on `customerId` on each daily_timesheet row (legacy rows may omit it); Firestore rules use wave ownership.
 */
export function dailyTimesheetsQueryForPortalWaveMonth(
  db: Firestore,
  waveId: string,
  monthYm: string,
): Query<DailyTimesheet> | null {
  if (!/^\d{4}-\d{2}$/.test(monthYm)) return null;
  const monthLast = lastDayOfCalendarMonth(monthYm);
  return query(
    collection(db, 'daily_timesheets'),
    where('waveId', '==', waveId),
    where('date', '>=', `${monthYm}-01`),
    where('date', '<=', monthLast),
  ) as Query<DailyTimesheet>;
}

/** One PO + calendar month — ใช้ `purchaseOrderId` + ช่วง `date` (กฎพอร์ทัล: PO ลูกค้าเดียวกัน) */
export function dailyTimesheetsQueryForPortalPoMonth(
  db: Firestore,
  poId: string,
  monthYm: string,
): Query<DailyTimesheet> | null {
  if (!/^\d{4}-\d{2}$/.test(monthYm)) return null;
  const monthLast = lastDayOfCalendarMonth(monthYm);
  return query(
    collection(db, 'daily_timesheets'),
    where('purchaseOrderId', '==', poId),
    where('date', '>=', `${monthYm}-01`),
    where('date', '<=', monthLast),
  ) as Query<DailyTimesheet>;
}

/**
 * พอร์ทัลลูกค้า: โหลด timesheet ทั้งเดือนตาม customerId แล้วกรองฝั่ง client ตาม PO
 * — ดึงแถวที่ `purchaseOrderId` ว่าง/คลาดเคลื่อนแต่ผูก wave หรือ assignment ของ PO ได้
 */
export function dailyTimesheetsQueryForPortalCustomerMonth(
  db: Firestore,
  customerId: string,
  monthYm: string,
): Query<DailyTimesheet> | null {
  if (!customerId.trim() || !/^\d{4}-\d{2}$/.test(monthYm)) return null;
  const monthLast = lastDayOfCalendarMonth(monthYm);
  return query(
    collection(db, 'daily_timesheets'),
    where('customerId', '==', customerId.trim()),
    where('date', '>=', `${monthYm}-01`),
    where('date', '<=', monthLast),
    /** สอดคล้อง index เดียวกับ CustomerQueryService.getScopedDailyTimesheetsForMonth */
    orderBy('date', 'desc'),
  ) as Query<DailyTimesheet>;
}

/**
 * รวมผลจาก query เดือนลูกค้า + query เดือนตาม PO (doc เดียวกันใช้ id เดียว)
 * — ให้ตรงกับ wave-month ภายในที่กรองจาก purchaseOrderId แม้แถวบางวันจะไม่มี customerId
 */
export function mergePortalDailyTimesheetsForPoMonth(
  customerMonthSheets: DailyTimesheet[],
  poMonthSheets: DailyTimesheet[],
): DailyTimesheet[] {
  const m = new Map<string, DailyTimesheet>();
  for (const row of customerMonthSheets) {
    if (row.id) m.set(row.id, row);
  }
  for (const row of poMonthSheets) {
    if (row.id) m.set(row.id, row);
  }
  return [...m.values()];
}

/** กรองชุด timesheet ที่โหลดแบบกว้างให้เหลือเฉพาะแถวที่เกี่ยวกับ PO + เดือนนี้ */
export function filterDailyTimesheetsForPortalPoMonthGrid(
  sheets: DailyTimesheet[],
  poId: string,
  monthYm: string,
  assignmentsForPo: Assignment[],
): DailyTimesheet[] {
  const pid = poId.trim();
  const prefix = `${monthYm}-`;
  const poScope = poTimesheetScopeId(pid);
  const mobIds = new Set(assignmentsForPo.map((a) => a.id));
  const waveIds = new Set(assignmentsForPo.map((a) => (a.waveId || '').trim()).filter(Boolean));

  /** คนที่มีอย่างน้อยหนึ่งแถวในเดือนนี้ที่ผูก PO ชัดเจน — เอาแถวอื่นของคนเดียวกันในเดือนมาด้วย (แถวบางวันไม่มี purchaseOrderId) */
  const workerIdsWithExplicitPo = new Set<string>();
  for (const ts of sheets) {
    if (!ts.date.startsWith(prefix)) continue;
    if ((ts.purchaseOrderId || '').trim() === pid) workerIdsWithExplicitPo.add(ts.workerId);
  }

  return sheets.filter((ts) => {
    if (!ts.date.startsWith(prefix)) return false;
    if ((ts.purchaseOrderId || '').trim() === pid) return true;
    if (workerIdsWithExplicitPo.has(ts.workerId)) return true;
    if ((ts.waveId || '').trim() === poScope) return true;
    if (ts.assignmentId && mobIds.has(ts.assignmentId)) return true;
    if (ts.waveId && waveIds.has(ts.waveId.trim())) return true;
    return false;
  });
}

function dominantTimesheetField(rows: DailyTimesheet[], pick: (r: DailyTimesheet) => string | undefined): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = pick(r)?.trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

/** Mobilization จำลองเมื่อมีแถว timesheet ใน portal แต่ไม่อ่านเอกสาร mobilizations ได้ — ใช้แค่จับคู่กริดอ่านอย่างเดียว */
function syntheticAssignmentFromPortalTimesheets(
  workerId: string,
  rows: DailyTimesheet[],
  poId: string,
): Assignment {
  const pid = poId.trim();
  const assignmentId = dominantTimesheetField(rows, (r) => r.assignmentId);
  const waveId =
    dominantTimesheetField(rows, (r) => r.waveId) || poTimesheetScopeId(pid);
  const id = assignmentId || `portal_ts_only:${workerId}:${pid}`;
  const first = rows[0]!;
  return {
    id,
    assignmentNo: '',
    workerId,
    waveId,
    poId: pid,
    poLineId: (first.poLineId || '').trim(),
    positionId: (first.positionId || '').trim(),
    customerId: (first.customerId || '').trim(),
    projectName: '',
    startDate: '',
    endDate: '',
    deploymentStatus: 'ACTIVE',
    clientApprovalStatus: 'APPROVED',
    readinessStatus: 'ready',
    workMode: first.workMode ?? 'OFFSHORE',
    workerName: first.workerNameSnapshot,
    readinessSummary: {
      passportValid: 'pass',
      medicalValid: 'pass',
      certificatesComplete: 'pass',
      safetyTrainingComplete: 'pass',
      fitToWork: 'pass',
      ppeIssued: 'pass',
      toolsIssued: 'pass',
      overlapClear: 'pass',
      clientApproved: 'pass',
    },
    createdAt: 0,
    updatedAt: 0,
  } as Assignment;
}

/**
 * ซ่อนงวด timesheet ในพอร์ทัลเมื่อชุดเรียกเก็บปิดวงแล้ว: ใบแจ้งหนี้เชิงพาณิธุรกิจยืนยันแล้ว + มีใบกำกับภาษีในเดือนนั้น + ลูกหนี้ปิดยอดแล้ว
 * (ไม่เกี่ยวกับ payroll ภายใน OPEC)
 */
export function shouldHidePortalWaveMonthAfterBillingSettlement(
  wave: Wave,
  yearMonth: string,
  commercials: CommercialInvoice[],
  taxInvoices: TaxInvoice[],
  arItems: AccountsReceivable[],
): boolean {
  const reviewId = `${wave.id}_${yearMonth}`;
  const comm = commercials.find((c) => c.sourceWaveMonthReviewId === reviewId && c.status === 'ISSUED');
  if (!comm) return false;

  const monthFirst = `${yearMonth}-01`;
  const monthLast = lastDayOfCalendarMonth(yearMonth);

  const tis = taxInvoices.filter((t) => {
    if (t.status !== 'ISSUED') return false;
    if (t.issueDate < monthFirst || t.issueDate > monthLast) return false;
    if (t.waveId && t.waveId !== wave.id) return false;
    return true;
  });
  if (tis.length === 0) return false;

  for (const ti of tis) {
    const ar = arItems.find((a) => a.referenceType === 'TAX_INVOICE' && a.referenceId === ti.id);
    if (!ar) return false;
    if (ar.outstandingAmount > 0.02) return false;
  }
  return true;
}

/** ซ่อนราย PO+เดือน หลัง commercial + ใบกำกับ + AR ปิดยอด (อ้าง `sourcePoMonthReviewId`) */
export function shouldHidePortalPoMonthAfterBillingSettlement(
  poId: string,
  yearMonth: string,
  commercials: CommercialInvoice[],
  taxInvoices: TaxInvoice[],
  arItems: AccountsReceivable[],
): boolean {
  const reviewId = poMonthTimesheetReviewDocId(poId, yearMonth);
  const comm = commercials.find((c) => c.sourcePoMonthReviewId === reviewId && c.status === 'ISSUED');
  if (!comm) return false;

  const monthFirst = `${yearMonth}-01`;
  const monthLast = lastDayOfCalendarMonth(yearMonth);
  const tis = taxInvoices.filter((t) => {
    if (t.status !== 'ISSUED') return false;
    if (t.issueDate < monthFirst || t.issueDate > monthLast) return false;
    if (t.sourceCommercialInvoiceId) return t.sourceCommercialInvoiceId === comm.id;
    if (t.waveId) return t.waveId === comm.waveId;
    return false;
  });
  if (tis.length === 0) return false;
  for (const ti of tis) {
    const ar = arItems.find((a) => a.referenceType === 'TAX_INVOICE' && a.referenceId === ti.id);
    if (!ar) return false;
    if (ar.outstandingAmount > 0.02) return false;
  }
  return true;
}
