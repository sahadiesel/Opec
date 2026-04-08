import type { Assignment, DeploymentStatus, POLine, Wave } from '@/lib/types';
import { plannedOnWaveForPoLine } from '@/lib/ops/wave-allocation';

/** Mobilization ที่ยังถือว่าจองโควต้า (ยังไม่ปิด/ถอนกำลัง) */
const DEPLOYMENT_RELEASED_FROM_QUOTA: DeploymentStatus[] = ['DEMOBILIZED', 'CLOSED'];

export function assignmentCountsTowardQuota(status: DeploymentStatus): boolean {
  return !DEPLOYMENT_RELEASED_FROM_QUOTA.includes(status);
}

export interface PoLineFulfillmentRow {
  lineId: string;
  positionId: string;
  workLocation?: string;
  lineStatus: POLine['status'];
  requiredQty: number;
  assignedCount: number;
  remainingSlots: number;
  waveCount: number;
  plannedWorkersInWaves: number;
}

export function buildPoFulfillmentByLine(
  lines: POLine[] | null | undefined,
  assignments: Assignment[] | null | undefined,
  waves: Wave[] | null | undefined,
  poId: string
): PoLineFulfillmentRow[] {
  const list = lines || [];
  const asg = assignments || [];
  const wv = waves || [];

  return list.map((line) => {
    const assignedCount = asg.filter(
      (a) =>
        a.poId === poId &&
        a.poLineId === line.id &&
        assignmentCountsTowardQuota(a.deploymentStatus)
    ).length;
    const lineWaves = wv.filter(
      (w) => w.poId === poId && plannedOnWaveForPoLine(w, line.id) > 0
    );
    const plannedWorkersInWaves = lineWaves.reduce(
      (s, w) => s + plannedOnWaveForPoLine(w, line.id),
      0
    );
    const requiredQty = line.status === 'active' ? line.quantity : 0;
    const remainingSlots =
      line.status === 'active' ? Math.max(0, line.quantity - assignedCount) : 0;

    return {
      lineId: line.id,
      positionId: line.positionId,
      workLocation: line.workLocation,
      lineStatus: line.status,
      requiredQty: line.quantity,
      assignedCount,
      remainingSlots,
      waveCount: lineWaves.length,
      plannedWorkersInWaves,
    };
  });
}

export function aggregateActiveLineTotals(rows: PoLineFulfillmentRow[]): {
  required: number;
  assigned: number;
  openSlots: number;
  waveCount: number;
} {
  return rows
    .filter((r) => r.lineStatus === 'active')
    .reduce(
      (acc, r) => ({
        required: acc.required + r.requiredQty,
        assigned: acc.assigned + r.assignedCount,
        openSlots: acc.openSlots + r.remainingSlots,
        waveCount: acc.waveCount + r.waveCount,
      }),
      { required: 0, assigned: 0, openSlots: 0, waveCount: 0 }
    );
}
