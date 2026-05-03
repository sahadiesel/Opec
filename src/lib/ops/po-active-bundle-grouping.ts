/**
 * เฟส 5 — จัดกลุ่มรายการที่มี poId ตามชุด PO Active (ลูกค้า + Onshore/Offshore)
 * ใช้ในคิวอนุมัติ / ใบแจ้งหนี้ / portal ให้สอดคล้องเกณฑ์ A6
 */

import type { JobMode, PurchaseOrder } from '@/lib/types';
import { resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';

export type PoActiveBundleGroupedRows<T> = {
  bundleKey: string;
  customerId: string;
  workMode: JobMode | undefined;
  rows: T[];
};

export function poActiveBundleWorkModeShortLabel(mode: JobMode | undefined): string {
  if (mode === 'ONSHORE') return 'Onshore';
  if (mode === 'OFFSHORE') return 'Offshore';
  return '—';
}

/**
 * จัดกลุ่มแถวที่มี poId — เรียงกลุ่มตามชื่อลูกค้า (ผ่าน customerLabel) แล้วตาม bundleKey
 */
export function groupRowsByPoActiveBundle<T extends { poId: string }>(
  rows: readonly T[],
  poById: Map<string, PurchaseOrder>,
  customerLabel: (customerId: string) => string,
  sortWithinGroup?: (a: T, b: T) => number,
): PoActiveBundleGroupedRows<T>[] {
  const m = new Map<string, T[]>();
  for (const row of rows) {
    const po = poById.get(row.poId);
    const bundleKey = po ? resolvePoActiveBundleKeyForPo(po) : `orphan:${row.poId}`;
    const arr = m.get(bundleKey) ?? [];
    arr.push(row);
    m.set(bundleKey, arr);
  }
  const out: PoActiveBundleGroupedRows<T>[] = [...m.entries()].map(([bundleKey, groupRows]) => {
    const sorted = sortWithinGroup ? [...groupRows].sort(sortWithinGroup) : [...groupRows];
    const first = sorted[0];
    const headPo = first ? poById.get(first.poId) : undefined;
    const modeFromKey =
      bundleKey.endsWith('__ONSHORE') ? 'ONSHORE' : bundleKey.endsWith('__OFFSHORE') ? 'OFFSHORE' : undefined;
    return {
      bundleKey,
      customerId: headPo?.customerId ?? '',
      workMode: modeFromKey ?? headPo?.poWorkMode,
      rows: sorted,
    };
  });
  out.sort((a, b) => {
    const na = customerLabel(a.customerId);
    const nb = customerLabel(b.customerId);
    const c = na.localeCompare(nb, 'th');
    if (c !== 0) return c;
    return a.bundleKey.localeCompare(b.bundleKey);
  });
  return out;
}
