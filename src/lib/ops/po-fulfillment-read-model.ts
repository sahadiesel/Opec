import type { Assignment, DeploymentStatus, POLine, Position, PurchaseOrder, Wave } from '@/lib/types';
import { plannedOnWaveForPoLine } from '@/lib/ops/wave-allocation';
import { isPoRosterWaveId } from '@/lib/ops/po-roster-wave';
import { assignmentHasMobWorkStartedForQuotaDisplay } from '@/lib/ops/mobilization-final-clearance';
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

/**
 * `unassignedAt` บนบางเอกสารเป็น Firestore Timestamp — ต้องรองรับนอกจาก number เพื่อปล่อยโควต้า/Unassign
 */
export function assignmentHasUnassignedAtSet(a: Pick<Assignment, 'unassignedAt'> | undefined): boolean {
  if (!a) return false;
  const u = a.unassignedAt as unknown;
  if (u == null) return false;
  if (typeof u === 'number' && Number.isFinite(u) && u > 0) return true;
  if (typeof u === 'object') {
    const t = u as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof t.toMillis === 'function') {
      try {
        const ms = t.toMillis();
        return Number.isFinite(ms) && ms > 0;
      } catch {
        return false;
      }
    }
    const sec = typeof t.seconds === 'number' ? t.seconds : typeof t._seconds === 'number' ? t._seconds : null;
    return sec != null && sec > 0;
  }
  return false;
}

/** ไม่จองโควต้าบรรทัด PO — Unassign / ปิดรายการ / จบภารกิจ (DEMOBILIZED) */
export function assignmentReleasedFromPoLineQuota(
  a: Pick<Assignment, 'deploymentStatus' | 'unassignedAt'>,
): boolean {
  if (assignmentHasUnassignedAtSet(a)) return true;
  const normalized = normalizeDeploymentToken(a.deploymentStatus);
  return Boolean(normalized && NORMALIZED_DEPLOYMENT_RELEASED_FROM_QUOTA.has(normalized));
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
    return !assignmentReleasedFromPoLineQuota(a);
  }
  return deploymentStatusCountsTowardQuota(assignmentOrStatus as DeploymentStatus | undefined);
}

/** คนเดียวกันที่มีหลาย mobilization ในชุด PO ที่ยังนับโควต้า — ใช้แจ้งซ้ำจากข้อมูลเก่า */
export interface DuplicateQuotaMobilizationGroup {
  /** `workerId` หรือ `_unknown:<mobId>` เมื่อไม่มี workerId */
  workerKey: string;
  assignments: Assignment[];
}

export function findDuplicateQuotaMobilizationGroups(
  assignments: Assignment[] | undefined,
  poIdSet: ReadonlySet<string>,
): DuplicateQuotaMobilizationGroup[] {
  const m = new Map<string, Assignment[]>();
  for (const a of assignments ?? []) {
    if (!poIdSet.has(a.poId)) continue;
    if (!assignmentCountsTowardQuota(a)) continue;
    const wid = (a.workerId || '').trim();
    const wkey = wid || `_unknown:${a.id}`;
    const arr = m.get(wkey) ?? [];
    arr.push(a);
    m.set(wkey, arr);
  }
  const out: DuplicateQuotaMobilizationGroup[] = [];
  for (const [workerKey, rows] of m) {
    if (rows.length <= 1) continue;
    rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    out.push({ workerKey, assignments: rows });
  }
  out.sort((a, b) =>
    (a.assignments[0]?.assignmentNo || a.workerKey).localeCompare(
      b.assignments[0]?.assignmentNo || b.workerKey,
      'th',
      { numeric: true },
    ),
  );
  return out;
}

export interface PoLineFulfillmentRow {
  lineId: string;
  positionId: string;
  workLocation?: string;
  lineStatus: POLine['status'];
  requiredQty: number;
  assignedCount: number;
  /** จองโควต้าแล้วและถือว่าขึ้นไซต์/เริ่มงานแล้ว */
  onSiteCount: number;
  /** จองโควต้าแล้วแต่ยังรอ mobilization / ยังไม่เริ่มงานบนไซต์ */
  standbyCount: number;
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
    /**
     * นับคนไม่ซ้ำต่อบรรทัด PO — สอดคล้องหน้า Assignments (ชุด PO Active) ที่ใช้ `pickRosterLinePerWorker`
     * (หนึ่งแถวต่อคน) · ถ้ามี mobilization ซ้ำบนบรรทัดเดิม `.length` จะเกินจำนวนแถวที่ผู้ใช้เห็น
     */
    const byWorker = new Map<string, Assignment[]>();
    for (const a of asg) {
      if (a.poId !== poId || a.poLineId !== line.id || !assignmentCountsTowardQuota(a)) continue;
      const wid = (a.workerId || '').trim();
      const key = wid || `mob:${a.id}`;
      const arr = byWorker.get(key) ?? [];
      arr.push(a);
      byWorker.set(key, arr);
    }
    const assignedCount = byWorker.size;
    let onSiteCount = 0;
    let standbyCount = 0;
    for (const arr of byWorker.values()) {
      if (arr.some((x) => assignmentHasMobWorkStartedForQuotaDisplay(x))) onSiteCount++;
      else standbyCount++;
    }
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
      /** นับเฉพาะบรรทัด active ต่อโควต้า — สอดคล้อง `remainingSlots` / หัวตารางรวม */
      requiredQty,
      assignedCount,
      onSiteCount,
      standbyCount,
      remainingSlots,
      waveCount: lineWaves.length,
      plannedWorkersInWaves,
    };
  });
}

export function aggregateActiveLineTotals(rows: PoLineFulfillmentRow[]): {
  required: number;
  assigned: number;
  onSite: number;
  onStandby: number;
  openSlots: number;
  waveCount: number;
} {
  const { required, assigned, onSite, onStandby, waveCount } = rows
    .filter((r) => r.lineStatus === 'active')
    .reduce(
      (acc, r) => ({
        required: acc.required + r.requiredQty,
        assigned: acc.assigned + r.assignedCount,
        onSite: acc.onSite + r.onSiteCount,
        onStandby: acc.onStandby + r.standbyCount,
        waveCount: acc.waveCount + r.waveCount,
      }),
      { required: 0, assigned: 0, onSite: 0, onStandby: 0, waveCount: 0 },
    );
  /** ระดับชุด/PO: ว่าง = โควต้ารวม − มอบหมายที่ยังจองสล็อต (ไม่ใช้แค่ผลรวม per-line เพื่อกันคลาดกับตัวเลขหัวแถว) */
  const openSlots = Math.max(0, required - assigned);
  return { required, assigned, onSite, onStandby, openSlots, waveCount };
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
