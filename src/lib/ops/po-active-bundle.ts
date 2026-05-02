import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { JobMode, PoActiveBundle, PurchaseOrder } from '@/lib/types';

export function poActiveBundleDocId(customerId: string, workMode: JobMode): string {
  return `${customerId}__${workMode}`;
}

/** คีย์ชุด PO Active สำหรับจัดกลุ่ม UI — ใช้ฟิลด์บน PO ถ้ามี ไม่เช่นนั้นคำนวณแบบเดียวกับเอกสาร `po_active_bundles` */
export function resolvePoActiveBundleKeyForPo(po: PurchaseOrder): string {
  const bid = (po.poActiveBundleId || '').trim();
  if (bid) return bid;
  const cid = (po.customerId || '').trim();
  if (!cid) return `orphan:${po.id}`;
  const mode = po.poWorkMode ?? 'OFFSHORE';
  return poActiveBundleDocId(cid, mode);
}

/**
 * รวบรวม PO สายสัญญาที่ Active ของลูกค้า แยกตาม Onshore/Offshore — เขียน `po_active_bundles` และอัปเดต `poActiveBundleId` บนแต่ละ PO
 */
export async function rebuildAllPoActiveBundlesForCustomer(
  db: Firestore,
  customerId: string,
): Promise<void> {
  const cid = (customerId || '').trim();
  if (!cid) return;

  const snap = await getDocs(query(collection(db, 'purchase_orders'), where('customerId', '==', cid)));
  const all: PurchaseOrder[] = snap.docs.map(
    (d) => ({ id: d.id, ...(d.data() as object) } as PurchaseOrder),
  );

  const modes: JobMode[] = ['ONSHORE', 'OFFSHORE'];
  const idsByMode = new Map<JobMode, string[]>();
  for (const m of modes) {
    const ids = all
      .filter(
        (p) =>
          p.status === 'active' &&
          (p.poType || 'contract') === 'contract' &&
          !!(p.contractId || '').trim() &&
          (p.poWorkMode ?? 'OFFSHORE') === m,
      )
      .map((p) => p.id);
    idsByMode.set(m, [...new Set(ids)]);
  }

  const now = Date.now();
  for (const m of modes) {
    const poIds = idsByMode.get(m) ?? [];
    const bid = poActiveBundleDocId(cid, m);
    const ref = doc(db, 'po_active_bundles', bid);
    const payload: PoActiveBundle = {
      id: bid,
      customerId: cid,
      workMode: m,
      poIds,
      updatedAt: now,
    };
    await setDoc(ref, payload, { merge: true });
  }

  for (const p of all) {
    const eligible =
      p.status === 'active' &&
      (p.poType || 'contract') === 'contract' &&
      !!(p.contractId || '').trim();
    const pref = doc(db, 'purchase_orders', p.id);
    if (!eligible) {
      if (p.poActiveBundleId) {
        await updateDoc(pref, { poActiveBundleId: deleteField(), updatedAt: now });
      }
      continue;
    }
    const mode = p.poWorkMode ?? 'OFFSHORE';
    const bid = poActiveBundleDocId(cid, mode);
    await updateDoc(pref, { poActiveBundleId: bid, updatedAt: now });
  }
}
