import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { JobMode, PoActiveBundle, PurchaseOrder } from '@/lib/types';
import { isContractBasedPurchaseOrder } from '@/lib/ops/po-active-eligibility';

export function poActiveBundleDocId(customerId: string, workMode: JobMode): string {
  return `${customerId}__${workMode}`;
}

/**
 * แปลงคีย์จาก query/path ที่มีขีดเดียวก่อนโหมด (`customer_OFFSHORE`) ให้เป็น canonical `customer__OFFSHORE`
 * — ลดกรณีลิงก์ผิดแล้วโหลดเอกสาร bundle ไม่ตรง
 */
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

/** แยก customer + โหมดจาก id แบบ `{customerId}__ONSHORE|OFFSHORE` (หลัง normalize) */
export function parseCanonicalPoActiveBundleRouteKey(
  rawBundleId: string,
): { customerId: string; workMode: JobMode } | null {
  const id = normalizePoActiveBundleId(rawBundleId);
  if (!id || id.startsWith('orphan:')) return null;
  const sep = '__';
  const i = id.lastIndexOf(sep);
  if (i <= 0 || i + sep.length >= id.length) return null;
  const customerId = id.slice(0, i).trim();
  const modeRaw = id.slice(i + sep.length).trim().toUpperCase();
  if (!customerId) return null;
  if (modeRaw !== 'ONSHORE' && modeRaw !== 'OFFSHORE') return null;
  return { customerId, workMode: modeRaw as JobMode };
}

/**
 * โหมด On/Off ที่ใช้กับ PO — อ้าง `poWorkMode` บน PO ก่อน (ไม่ใช้ jobMode ตำแหน่ง)
 * fallback: แยกจาก poActiveBundleId → assignment/timesheet → OFFSHORE
 */
export function resolveWorkModeForPoContext(
  po: Pick<PurchaseOrder, 'poWorkMode' | 'poActiveBundleId'>,
  fallback?: JobMode | null,
): JobMode {
  const wm = po.poWorkMode;
  if (wm === 'ONSHORE' || wm === 'OFFSHORE') return wm;
  const parsed = parseCanonicalPoActiveBundleRouteKey((po.poActiveBundleId || '').trim());
  if (parsed?.workMode) return parsed.workMode;
  if (fallback === 'ONSHORE' || fallback === 'OFFSHORE') return fallback;
  return 'OFFSHORE';
}

/** คีย์ชุด PO Active สำหรับจัดกลุ่ม UI — ใช้ฟิลด์บน PO ถ้ามี ไม่เช่นนั้นคำนวณแบบเดียวกับเอกสาร `po_active_bundles` */
export function resolvePoActiveBundleKeyForPo(po: PurchaseOrder): string {
  const bid = (po.poActiveBundleId || '').trim();
  /** normalize เพื่อให้เทียบกับ URL / `po_active_bundles` id แบบ `{customerId}__ONSHORE|OFFSHORE` ได้แม้ข้อมูลเก่าใช้ `_OFFSHORE` ขีดเดียว */
  if (bid) return normalizePoActiveBundleId(bid);
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
      .filter((p) => isContractBasedPurchaseOrder(p) && (p.poWorkMode ?? 'OFFSHORE') === m)
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
    const eligible = isContractBasedPurchaseOrder(p);
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

/** Master switch: ปิดการลงรายวันอัตโนมัติของ bundle (Scheduler + silent sync บนกระดาน) */
export async function isPoActiveBundleAutoDailyDisabled(db: Firestore, bundleId: string): Promise<boolean> {
  const id = normalizePoActiveBundleId(bundleId);
  if (!id || id.startsWith('orphan:')) return false;
  const snap = await getDoc(doc(db, 'po_active_bundles', id));
  if (!snap.exists()) return false;
  return (snap.data() as PoActiveBundle).poActiveAutoDailyDisabled === true;
}
