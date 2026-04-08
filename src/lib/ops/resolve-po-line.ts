import type { POLine } from '@/lib/types';

/**
 * หา PO line ที่ผูกกับเวฟอย่างปลอดภัย — ต้องตรงทั้ง `poId` และ `poLineId` (และโดยค่าเริ่มต้นเฉพาะ `active`)
 */
export function resolvePoLineForWave(
  lines: POLine[] | null | undefined,
  poId: string,
  poLineId: string,
  options?: { includeInactive?: boolean },
): POLine | undefined {
  if (!lines?.length || !poId || !poLineId) return undefined;
  const line = lines.find((l) => l.id === poLineId && l.poId === poId);
  if (!line) return undefined;
  if (!options?.includeInactive && line.status !== 'active') return undefined;
  return line;
}
