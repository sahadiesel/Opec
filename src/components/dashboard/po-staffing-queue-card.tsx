'use client';

import { PoQuotaQueueCardShell, usePoQuotaQueueRows } from '@/components/ops/po-quota-queue';

export interface PoStaffingQueueCardProps {
  /** แสดงเฉพาะเมื่อผู้ใช้เป็นฝ่ายที่เกี่ยวกับการจัดกำลัง / PO */
  enabled: boolean;
}

/**
 * แดชบอร์ด — PO สายสัญญา active + สัญญาหลัก active จัดกลุ่มเป็นชุดลูกค้า×Onshore/Offshore (แสดงครบทุกชุดที่มีโควต้า)
 * ใช้ logic เดียวกับหน้า /po-active-quota-queue
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
