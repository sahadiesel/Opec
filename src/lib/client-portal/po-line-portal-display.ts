import { jobModeSellLabel, sellSnapshotForWorkMode } from '@/lib/commercial/position-rate-sell';
import type { Assignment, JobMode, POLine, PurchaseOrder } from '@/lib/types';

export function resolvePortalPoWorkMode(po: Pick<PurchaseOrder, 'poWorkMode'>): JobMode {
  return po.poWorkMode ?? 'OFFSHORE';
}

/** ราคาขายต่อหน่วยตามโหมดงานของ PO (Onshore / Offshore) */
export function resolvePortalPoLineSellRate(
  line: Pick<POLine, 'sellRateSnapshot' | 'sellRateSnapshotOnshore' | 'sellRateSnapshotOffshore'>,
  po: Pick<PurchaseOrder, 'poWorkMode'>,
): number {
  return sellSnapshotForWorkMode(line, resolvePortalPoWorkMode(po));
}

export function portalPoWorkModeLabel(mode: JobMode, locale: 'en' | 'th'): string {
  if (locale === 'th') {
    return mode === 'ONSHORE' ? 'Onshore' : 'Offshore';
  }
  return jobModeSellLabel(mode);
}

/**
 * สถานที่ปฏิบัติงาน — อ่านจาก po line ก่อน แล้ว fallback จาก mobilization ที่ผูกบรรทัดเดียวกัน
 */
export function resolvePortalPoLineWorkLocation(
  line: Pick<POLine, 'poId' | 'id' | 'workLocation'>,
  assignments: Assignment[] | null | undefined,
): string {
  const direct = (line.workLocation || '').trim();
  if (direct) return direct;

  for (const a of assignments ?? []) {
    if (a.poId !== line.poId || a.poLineId !== line.id) continue;
    const wl = (a.workLocation || '').trim();
    if (wl) return wl;
  }

  return '';
}
