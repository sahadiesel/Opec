import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDocs } from 'firebase/firestore';
import type {
  Assignment,
  DeploymentStatus,
  MobilizationRequirementFulfillmentLine,
  PositionPPERequirement,
  PositionToolRequirement,
  WorkerStoreEquipmentReadiness,
} from '@/lib/types';

export const MOBILIZATION_FULFILLMENT_SUBCOLLECTION = 'fulfillment_lines';

export function fulfillmentLineDocId(kind: 'ppe' | 'tool', positionRequirementId: string): string {
  return `${kind}_${positionRequirementId}`;
}

/** งานมอบหมายที่ต้องดูแลเรื่องเบิกคลัง */
export const DEPLOYMENT_STATUSES_FOR_STORE_FULFILLMENT: DeploymentStatus[] = [
  'READINESS_CHECK',
  'CLIENT_SUBMITTED',
  'CLIENT_APPROVED',
  'CONFIRMED',
  'READY_TO_MOB',
  'MOBILIZING',
  'ACTIVE',
];

export function isMobilizationInStoreFulfillmentScope(a: Pick<Assignment, 'deploymentStatus'>): boolean {
  return DEPLOYMENT_STATUSES_FOR_STORE_FULFILLMENT.includes(a.deploymentStatus as DeploymentStatus);
}

export function appliesPpeRequirement(req: PositionPPERequirement): boolean {
  return !!req.required;
}

export function appliesToolRequirement(req: PositionToolRequirement): boolean {
  return !!req.allowed;
}

export function fulfillmentLineSatisfied(
  quantityRequired: number,
  line: MobilizationRequirementFulfillmentLine | undefined,
): boolean {
  if (!line) return false;
  if (line.status === 'WAIVED') return true;
  if (line.status === 'RETURNED') return false;
  return (line.quantityIssued || 0) >= quantityRequired;
}

export function nextStatusAfterIssue(
  quantityRequired: number,
  prevIssued: number,
  addQty: number,
): 'PARTIAL' | 'ISSUED' {
  const next = prevIssued + addQty;
  return next >= quantityRequired ? 'ISSUED' : 'PARTIAL';
}

export async function loadFulfillmentMap(
  firestore: Firestore,
  mobilizationId: string,
): Promise<Map<string, MobilizationRequirementFulfillmentLine>> {
  const ref = collection(
    firestore,
    'mobilizations',
    mobilizationId,
    MOBILIZATION_FULFILLMENT_SUBCOLLECTION,
  );
  const snap = await getDocs(ref);
  const map = new Map<string, MobilizationRequirementFulfillmentLine>();
  for (const d of snap.docs) {
    map.set(d.id, { ...(d.data() as MobilizationRequirementFulfillmentLine), id: d.id });
  }
  return map;
}

export function mobilizationStoreLinesComplete(
  posPPE: PositionPPERequirement[],
  posTools: PositionToolRequirement[],
  fulfillmentById: Map<string, MobilizationRequirementFulfillmentLine>,
): boolean {
  for (const p of posPPE) {
    if (!appliesPpeRequirement(p)) continue;
    const id = fulfillmentLineDocId('ppe', p.id);
    if (!fulfillmentLineSatisfied(p.quantityDefault || 1, fulfillmentById.get(id))) return false;
  }
  for (const t of posTools) {
    if (!appliesToolRequirement(t)) continue;
    const id = fulfillmentLineDocId('tool', t.id);
    if (!fulfillmentLineSatisfied(t.quantityDefault || 1, fulfillmentById.get(id))) return false;
  }
  return true;
}

export async function computeWorkerStoreEquipmentReadiness(
  firestore: Firestore,
  workerId: string,
  openMobilizations: Assignment[],
  loadPositionReqs: (positionId: string) => Promise<{ ppe: PositionPPERequirement[]; tools: PositionToolRequirement[] }>,
): Promise<WorkerStoreEquipmentReadiness> {
  const scoped = openMobilizations.filter(
    (m) => m.workerId === workerId && isMobilizationInStoreFulfillmentScope(m),
  );
  if (scoped.length === 0) return 'na';

  for (const m of scoped) {
    const { ppe, tools } = await loadPositionReqs(m.positionId);
    const fmap = await loadFulfillmentMap(firestore, m.id);
    if (!mobilizationStoreLinesComplete(ppe, tools, fmap)) {
      return 'pending';
    }
  }
  return 'complete';
}

export function thaiFulfillmentLabel(
  status: MobilizationRequirementFulfillmentLine['status'] | 'PENDING',
  quantityRequired: number,
  quantityIssued: number,
): string {
  if (status === 'WAIVED') return 'มีอยู่แล้ว (ไม่ประสงค์เบิก)';
  if (status === 'RETURNED') return 'คืนแล้ว';
  if (status === 'ISSUED' || (quantityIssued > 0 && quantityIssued >= quantityRequired)) return 'เบิกแล้ว';
  if (status === 'PARTIAL' || quantityIssued > 0) return 'เบิกบางส่วน';
  return 'ยังไม่เบิก';
}
