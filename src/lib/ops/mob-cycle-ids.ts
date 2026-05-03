/**
 * Mobilization cycle ids — stable keys per assignment + cycle number (เฟส 0 PO Active workflow)
 */

/** สร้าง id คงที่ต่อรอบ mobilization ภายใต้ assignment เดียว */
export function buildMobCycleDocId(assignmentId: string, mobCycleNumber: number): string {
  const id = (assignmentId || '').trim();
  const n =
    typeof mobCycleNumber === 'number' && Number.isFinite(mobCycleNumber) && mobCycleNumber >= 1
      ? Math.floor(mobCycleNumber)
      : 1;
  return `${id}_c${n}`;
}
