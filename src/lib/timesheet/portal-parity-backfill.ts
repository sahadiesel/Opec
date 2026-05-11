import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Assignment, DailyTimesheet, PurchaseOrder } from '@/lib/types';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';

export type PortalParityBackfillResult = {
  poCustomerId: string;
  mobilizationsScanned: number;
  mobilizationsUpdated: number;
  dailySheetsScanned: number;
  dailySheetsUpdated: number;
};

const FIRESTORE_BATCH_LIMIT = 400;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Legacy repair: denormalize `customerId` (and PO link on daily rows) so client portal queries
 * (`customerId` + month, and roster via scoped mobilizations) match internal wave-month.
 */
export async function runPortalParityBackfillForPoMonth(
  db: Firestore,
  poId: string,
  monthYm: string,
): Promise<PortalParityBackfillResult> {
  const pid = poId.trim();
  const ym = monthYm.trim();
  if (!pid || !/^\d{4}-\d{2}$/.test(ym)) {
    throw new Error('Invalid poId or monthYm');
  }

  const poRef = doc(db, 'purchase_orders', pid);
  const poSnap = await getDoc(poRef);
  if (!poSnap.exists()) throw new Error('Purchase order not found');
  const po = { id: poSnap.id, ...(poSnap.data() as object) } as PurchaseOrder;
  const poCustomerId = (po.customerId || '').trim();
  if (!poCustomerId) throw new Error('PO has no customerId');

  const monthStart = `${ym}-01`;
  const monthEnd = lastDayOfCalendarMonth(ym);

  const mobSnap = await getDocs(query(collection(db, 'mobilizations'), where('poId', '==', pid)));
  const mobIds = new Set<string>();
  const waveIdSet = new Set<string>();
  for (const d of mobSnap.docs) {
    mobIds.add(d.id);
    const m = d.data() as Partial<Assignment>;
    const w = (m.waveId || '').trim();
    if (w) waveIdSet.add(w);
  }

  let mobilizationsUpdated = 0;
  {
    let batch = writeBatch(db);
    let n = 0;
    const commitBatch = async () => {
      if (n === 0) return;
      await batch.commit();
      batch = writeBatch(db);
      n = 0;
    };

    for (const d of mobSnap.docs) {
      const m = d.data() as Partial<Assignment>;
      const cur = (m.customerId || '').trim();
      if (cur === poCustomerId) continue;
      batch.update(d.ref, { customerId: poCustomerId, updatedAt: Date.now() });
      mobilizationsUpdated++;
      n++;
      if (n >= FIRESTORE_BATCH_LIMIT) await commitBatch();
    }
    await commitBatch();
  }

  const sheetById = new Map<string, DailyTimesheet>();

  const qByPo = query(
    collection(db, 'daily_timesheets'),
    where('purchaseOrderId', '==', pid),
    where('date', '>=', monthStart),
    where('date', '<=', monthEnd),
  );
  const snapPo = await getDocs(qByPo);
  for (const d of snapPo.docs) {
    sheetById.set(d.id, { id: d.id, ...(d.data() as object) } as DailyTimesheet);
  }

  const waveIds = [...waveIdSet];
  for (const part of chunk(waveIds, 30)) {
    if (part.length === 0) continue;
    const qW = query(
      collection(db, 'daily_timesheets'),
      where('waveId', 'in', part),
      where('date', '>=', monthStart),
      where('date', '<=', monthEnd),
    );
    const snapW = await getDocs(qW);
    for (const d of snapW.docs) {
      sheetById.set(d.id, { id: d.id, ...(d.data() as object) } as DailyTimesheet);
    }
  }

  function sheetLinkedToPo(sheet: DailyTimesheet): boolean {
    const aid = (sheet.assignmentId || '').trim();
    const wid = (sheet.waveId || '').trim();
    const spid = (sheet.purchaseOrderId || '').trim();
    if (spid === pid) return true;
    if (aid && mobIds.has(aid)) return true;
    if (wid && waveIdSet.has(wid)) return true;
    return false;
  }

  function patchesForSheet(sheet: DailyTimesheet): Record<string, string> | null {
    if (!sheetLinkedToPo(sheet)) return null;
    const patch: Record<string, string> = {};
    const curCust = (sheet.customerId || '').trim();
    if (curCust !== poCustomerId) patch.customerId = poCustomerId;

    const curPo = (sheet.purchaseOrderId || '').trim();
    const aid = (sheet.assignmentId || '').trim();
    const linkedMob = aid && mobIds.has(aid);
    const linkedPo = curPo === pid;
    const linkedWaveOnly = !linkedMob && !linkedPo && waveIdSet.has((sheet.waveId || '').trim());

    if (linkedMob || linkedPo) {
      if (curPo !== pid) patch.purchaseOrderId = pid;
    } else if (linkedWaveOnly && !curPo) {
      patch.purchaseOrderId = pid;
    }

    return Object.keys(patch).length > 0 ? patch : null;
  }

  let dailySheetsUpdated = 0;
  {
    let batch = writeBatch(db);
    let n = 0;
    const commitBatch = async () => {
      if (n === 0) return;
      await batch.commit();
      batch = writeBatch(db);
      n = 0;
    };

    for (const sheet of sheetById.values()) {
      const patch = patchesForSheet(sheet);
      if (!patch) continue;
      batch.update(doc(db, 'daily_timesheets', sheet.id), { ...patch, updatedAt: Date.now() });
      dailySheetsUpdated++;
      n++;
      if (n >= FIRESTORE_BATCH_LIMIT) await commitBatch();
    }
    await commitBatch();
  }

  return {
    poCustomerId,
    mobilizationsScanned: mobSnap.size,
    mobilizationsUpdated,
    dailySheetsScanned: sheetById.size,
    dailySheetsUpdated,
  };
}
