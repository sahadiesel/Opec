import type { Assignment, DeploymentStatus, POLine, Position, PurchaseOrder, Wave } from '@/lib/types';
import { plannedOnWaveForPoLine } from '@/lib/ops/wave-allocation';
import { isPoRosterWaveId } from '@/lib/ops/po-roster-wave';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';

/**
 * ปล่อยโควต้าเมื่อปิดรายการ / ถอนมอบหมาย / จบงาน (Assignment)
 * - Unassign: `unassignedAt` + มักเป็น deployment CLOSED — ไม่นับ
 * - จบงานจากหน้า Assignment: deployment DEMOBILIZED — ไม่นับ (สอดคล้อง toast «ไม่นับโควต้า»)
 * - รอบ Mob ใหม่หลังจบที่ Wave Board: deployment กลับเป็น DRAFT — ยังนับเป็นจองโควต้าต่อคนเดิม
 * - CLOSED / DEMOBILIZED normalize (NFKC + trim + uppercase)
 */
const NORMALIZED_DEPLOYMENT_RELEASED_FROM_QUOTA = new Set(['CLOSED', 'DEMOBILIZED']);

function normalizeDeploymentToken(status: unknown): string {
  if (status === undefined || status === null) return '';
  try {
    return String(status).trim().normalize('NFKC').toUpperCase();
  } catch {
    return String(status).trim().toUpperCase();
  }
}

function deploymentStatusCountsTowardQuota(status: DeploymentStatus | string | undefined): boolean {
  const normalized = normalizeDeploymentToken(status);
  if (!normalized) return true;
  return !NORMALIZED_DEPLOYMENT_RELEASED_FROM_QUOTA.has(normalized);
}

/** ส่งทั้งเอกสาร mobilization เพื่อให้ถอนมอบหมาย (`unassignedAt`) ปล่อยโควต้าได้ถูกต้อง */
export function assignmentCountsTowardQuota(
  assignmentOrStatus:
    | DeploymentStatus
    | Pick<Assignment, 'deploymentStatus' | 'unassignedAt'>
    | undefined,
): boolean {
  if (assignmentOrStatus !== null && typeof assignmentOrStatus === 'object') {
    const a = assignmentOrStatus as Pick<Assignment, 'deploymentStatus' | 'unassignedAt'>;
    if (typeof a.unassignedAt === 'number' && a.unassignedAt > 0) return false;
    return deploymentStatusCountsTowardQuota(a.deploymentStatus);
  }
  return deploymentStatusCountsTowardQuota(assignmentOrStatus as DeploymentStatus | undefined);
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
  /** ต้องจำกัดเฉพาะบรรทัดของ PO นี้ — ผู้เรียกบางที่ส่ง collectionGroup ทั้งระบบมาได้ */
  const list = (lines || []).filter((line) => line.poId === poId);
  const asg = assignments || [];
  const wv = waves || [];

  return list.map((line) => {
    const assignedCount = asg.filter(
      (a) =>
        a.poId === poId &&
        a.poLineId === line.id &&
        assignmentCountsTowardQuota(a),
    ).length;
    const lineWaves = wv.filter(
      (w) =>
        w.poId === poId &&
        !isPoRosterWaveId(w.id) &&
        plannedOnWaveForPoLine(w, line.id) > 0
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

/** เฟส C: รวมโควต้าตาม position ข้าม PO สัญญาที่ active ทั้งหมด (นับ PO status=active + สัญญาหลัก active) */
export interface PoPositionAggregateRow {
  positionId: string;
  positionName: string;
  required: number;
  assigned: number;
  vacant: number;
}

export function buildPositionAggregateAcrossActiveContractPos(
  activePOs: PurchaseOrder[] | null | undefined,
  activeMainContractIds: Set<string>,
  allPOLines: POLine[] | null | undefined,
  allAssignments: Assignment[] | null | undefined,
  allWaves: Wave[] | null | undefined,
  allPositions: Position[] | null | undefined,
): PoPositionAggregateRow[] {
  const list = activePOs ?? [];
  const lines = allPOLines ?? [];
  const asg = allAssignments ?? [];
  const wv = allWaves ?? [];
  const posById = new Map((allPositions ?? []).map((p) => [p.id, p]));

  const byPos = new Map<string, { required: number; assigned: number }>();
  for (const po of list) {
    if (po.status !== 'active') continue;
    if ((po.poType || 'contract') !== 'contract' || !po.contractId) continue;
    if (!activeMainContractIds.has(po.contractId)) continue;
    const poLines = lines.filter((l) => l.poId === po.id);
    if (!poLines.length) continue;
    const fulfillment = buildPoFulfillmentByLine(poLines, asg, wv, po.id);
    for (const row of fulfillment) {
      if (row.lineStatus !== 'active') continue;
      const cur = byPos.get(row.positionId) ?? { required: 0, assigned: 0 };
      cur.required += row.requiredQty;
      cur.assigned += row.assignedCount;
      byPos.set(row.positionId, cur);
    }
  }

  const out: PoPositionAggregateRow[] = [];
  for (const [positionId, v] of byPos) {
    const p = posById.get(positionId);
    out.push({
      positionId,
      positionName: p ? positionListPrimaryName(p as PositionDoc) : positionId,
      required: v.required,
      assigned: v.assigned,
      vacant: Math.max(0, v.required - v.assigned),
    });
  }
  out.sort((a, b) => a.positionName.localeCompare(b.positionName, 'th'));
  return out;
}
