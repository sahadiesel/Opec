import { doc, getDoc, setDoc, type DocumentData, type Firestore } from 'firebase/firestore';
import { timestampToHtmlDateValue } from '@/lib/date-thai';
import type { POLine, PurchaseOrder, Wave, WaveLineAllocation } from '@/lib/types';
import { deriveSiteLocationFromAllocations } from '@/lib/ops/wave-allocation';

export const PO_ROSTER_WAVE_PREFIX = 'po_roster_';

export function poRosterWaveDocId(poId: string): string {
  return `${PO_ROSTER_WAVE_PREFIX}${poId}`;
}

export function isPoRosterWaveId(waveId: string | undefined | null): boolean {
  return !!waveId && waveId.startsWith(PO_ROSTER_WAVE_PREFIX);
}

/**
 * Wave เดียวต่อ PO สำหรับมอบหมายตามบรรทัด PO — ไม่ต้องสร้าง Wave แยกใน UI
 * ยังใช้ waveId ใน mobilizations / daily_timesheets ตามโมเดลเดิม
 */
export async function ensurePoRosterWaveForPo(
  db: Firestore,
  po: PurchaseOrder,
  allLines: POLine[],
): Promise<Wave> {
  const id = poRosterWaveDocId(po.id);
  const waveRef = doc(db, 'waves', id);
  const existingSnap = await getDoc(waveRef);

  const activeLines = allLines.filter((l) => l.poId === po.id && l.status === 'active');
  const lineAllocations: WaveLineAllocation[] = activeLines
    .map((l) => ({
      poLineId: l.id,
      plannedWorkers: Math.max(0, Math.floor(Number(l.quantity) || 0)),
    }))
    .filter((a) => a.plannedWorkers > 0);

  const poStart = timestampToHtmlDateValue(po.startDate);
  const poEnd = timestampToHtmlDateValue(po.endDate);
  let minStart = poStart;
  let maxEnd = poEnd;
  for (const l of activeLines) {
    const ls = timestampToHtmlDateValue(l.startDate);
    const le = timestampToHtmlDateValue(l.endDate);
    if (ls && (!minStart || ls < minStart)) minStart = ls;
    if (le && (!maxEnd || le > maxEnd)) maxEnd = le;
  }

  const primaryLineId = lineAllocations[0]?.poLineId || activeLines[0]?.id || '';
  const siteLocation = deriveSiteLocationFromAllocations(lineAllocations, allLines, po.id);
  const plannedTotal = lineAllocations.reduce((s, a) => s + a.plannedWorkers, 0);
  const now = Date.now();
  const prev = existingSnap.exists() ? (existingSnap.data() as Wave) : null;

  const payload: Wave = {
    id,
    waveCode: `${po.poCode}-PO-ROSTER`,
    poId: po.id,
    poLineId: primaryLineId,
    customerId: po.customerId,
    projectName: (po.projectName || po.title || '').trim() || po.poCode,
    siteLocation,
    startDate: minStart || poStart,
    endDate: maxEnd || poEnd,
    status: 'ACTIVE',
    plannedWorkers: plannedTotal,
    assignedWorkers: typeof prev?.assignedWorkers === 'number' ? prev.assignedWorkers : 0,
    rotationPattern: 'po_line_roster',
    lineAllocations,
    notes:
      'สร้าง/ซิงก์อัตโนมัติ — มอบหมายจากเมนู Assignments ตามบรรทัด PO (ไม่ต้องสร้าง Wave แยก)',
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };

  await setDoc(waveRef, payload as unknown as DocumentData, { merge: true });
  const snap = await getDoc(waveRef);
  return { id, ...(snap.data() as object) } as Wave;
}
