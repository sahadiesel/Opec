'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import type { POLine, PoLocationMonthTimesheet, PurchaseOrder } from '@/lib/types';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';

/** ค่าว่างบน po line รวมเป็นกลุ่มเดียว */
export function normalizeWorkLocationKey(raw: string | undefined | null): string {
  const t = (raw ?? '').trim();
  return t.length > 0 ? t : '__default__';
}

function fnv1a32Hex(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** สร้าง id คงที่: `poId` + งวด + hash(location) — ไม่มีอักขระเสี่ยงสำหรับ Firestore */
export function poLocationMonthShellDocId(
  poId: string,
  yearMonth: string,
  locationKey: string,
): string {
  const nk = normalizeWorkLocationKey(locationKey);
  return `${poId}_${yearMonth}_${fnv1a32Hex(`${poId}|${yearMonth}|${nk}`)}`;
}

export function formatPoLocationMonthShellListLabel(
  poCode: string,
  yearMonth: string,
  locationLabel: string,
): string {
  return `TS·${poCode}·${yearMonth}·${locationLabel}`.replace(/\s+/g, ' ').trim();
}

export function purchaseOrderOverlapsYearMonth(
  po: Pick<PurchaseOrder, 'startDate' | 'endDate'>,
  yearMonth: string,
): boolean {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false;
  if (po.startDate == null || po.endDate == null) return true;
  const mStart = `${yearMonth}-01`;
  const mEnd = lastDayOfCalendarMonth(yearMonth);
  const s = new Date(Number(po.startDate)).toISOString().slice(0, 10);
  const e = new Date(Number(po.endDate)).toISOString().slice(0, 10);
  return s <= mEnd && e >= mStart;
}

/**
 * อ่าน po_lines รวมตาม workLocation แล้ว setDoc หัวงวดต่อสถานที่ (merge)
 */
export async function ensurePoLocationMonthShellsForPo(
  db: Firestore,
  po: Pick<PurchaseOrder, 'id' | 'customerId' | 'contractId' | 'poType' | 'poCode' | 'projectName'>,
  yearMonth: string,
  actor: { userId: string; displayName: string },
): Promise<{ created: number; touched: number }> {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return { created: 0, touched: 0 };
  if ((po.poType || 'contract') === 'quotation') return { created: 0, touched: 0 };

  const linesSnap = await getDocs(collection(db, 'purchase_orders', po.id, 'po_lines'));
  const byLoc = new Map<string, { label: string; lineIds: string[] }>();

  for (const d of linesSnap.docs) {
    const line = { id: d.id, ...(d.data() as object) } as POLine;
    if (line.status === 'cancelled') continue;
    const k = normalizeWorkLocationKey(line.workLocation);
    const label = (line.workLocation ?? '').trim() || 'สถานที่ (รวมยังไม่ระบุ)';
    const cur = byLoc.get(k) ?? { label, lineIds: [] as string[] };
    cur.lineIds.push(d.id);
    if (!cur.label || (label && label.length > cur.label.length)) cur.label = label;
    byLoc.set(k, cur);
  }

  if (byLoc.size === 0) {
    return { created: 0, touched: 0 };
  }

  const now = Date.now();
  let created = 0;
  let touched = 0;

  for (const [locKey, { label, lineIds }] of byLoc) {
    const id = poLocationMonthShellDocId(po.id, yearMonth, locKey);
    const ref = doc(db, 'po_location_month_timesheets', id);
    const snap = await getDoc(ref);
    const prev = snap.exists() ? (snap.data() as PoLocationMonthTimesheet) : null;
    const base: Record<string, unknown> = {
      id,
      poId: po.id,
      customerId: po.customerId,
      contractId: po.contractId,
      yearMonth,
      locationKey: locKey,
      locationLabel: label,
      poCodeSnapshot: po.poCode,
      projectNameSnapshot: po.projectName,
      sourcePoLineIds: lineIds,
      updatedAt: now,
      createdByName: actor.displayName,
    };

    if (!prev) {
      base.status = 'planning';
      base.createdAt = now;
      base.createdByUserId = actor.userId;
      await setDoc(ref, base, { merge: true });
      created++;
      touched++;
    } else {
      base.status = prev.status;
      base.createdAt = prev.createdAt;
      if (prev.createdByUserId) base.createdByUserId = prev.createdByUserId;
      await setDoc(ref, base, { merge: true });
      touched++;
    }
  }

  return { created, touched };
}
