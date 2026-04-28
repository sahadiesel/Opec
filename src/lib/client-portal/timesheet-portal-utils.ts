import type { PortalLocale } from '@/lib/i18n/client-portal-dictionary';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';
import type { DocumentSnapshot, Firestore, Query } from 'firebase/firestore';
import { collection, doc, getDoc, query, where } from 'firebase/firestore';
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
