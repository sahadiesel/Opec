'use client';

import { PoQuotaQueueCardShell, usePoQuotaQueueRows } from '@/components/ops/po-quota-queue';

export interface PoStaffingQueueCardProps {
  /** แสดงเฉพาะเมื่อผู้ใช้เป็นฝ่ายที่เกี่ยวกับการจัดกำลัง / PO */
  enabled: boolean;
}

/**
 * แดชบอร์ดลำดับที่ 1 — อ่านอย่างเดียว: PO สถานะ active (สายสัญญา + สัญญาหลัก active) ที่ยังมีโควต้าว่าง
 * ใช้ logic เดียวกับการ์ดบนหน้า PO (po-fulfillment-read-model) และหน้า /po-active-quota-queue
 */
export function PoStaffingQueueCard({ enabled }: PoStaffingQueueCardProps) {
  const { queueRows, customers, allPositions, loading } = usePoQuotaQueueRows(enabled);

  if (!enabled) return null;

  return (
    <div className="space-y-4">
      <PoQuotaQueueCardShell
        queueRows={queueRows}
        customers={customers}
        allPositions={allPositions}
        loading={loading}
      />
    </div>
  );
}
