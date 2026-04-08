import type { POLine, Wave, WaveLineAllocation } from '@/lib/types';

/** อ่านโควต้าต่อบรรทัดจากเวฟ — รองรับทั้งรูปแบบใหม่ (lineAllocations) และเวฟเก่า (poLineId + plannedWorkers เดี่ยว) */
export function normalizeWaveAllocations(wave: Wave): WaveLineAllocation[] {
  const raw = wave.lineAllocations;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .filter((x) => x?.poLineId)
      .map((x) => ({
        poLineId: x.poLineId,
        plannedWorkers: Math.max(0, Math.floor(Number(x.plannedWorkers) || 0)),
      }))
      .filter((x) => x.plannedWorkers > 0);
  }
  if (wave.poLineId) {
    return [
      {
        poLineId: wave.poLineId,
        plannedWorkers: Math.max(0, Math.floor(Number(wave.plannedWorkers) || 0)),
      },
    ];
  }
  return [];
}

export function plannedOnWaveForPoLine(wave: Wave, poLineId: string): number {
  const hit = normalizeWaveAllocations(wave).find((a) => a.poLineId === poLineId);
  return hit?.plannedWorkers ?? 0;
}

export function totalPlannedWorkersOnWave(wave: Wave): number {
  return normalizeWaveAllocations(wave).reduce((s, a) => s + a.plannedWorkers, 0);
}

export function primaryPoLineId(wave: Wave): string {
  const n = normalizeWaveAllocations(wave);
  return n[0]?.poLineId || wave.poLineId || '';
}

/** รวมจำนวนคนที่วางในเวฟทั้งหมดสำหรับ PO line นี้ (ไม่นับเวฟ CLOSED) */
export function sumPlannedForPoLineAcrossWaves(
  waveList: Wave[] | null | undefined,
  poId: string,
  poLineId: string,
  excludeWaveId?: string | null,
): number {
  if (!waveList?.length) return 0;
  return waveList.reduce((acc, w) => {
    if (excludeWaveId && w.id === excludeWaveId) return acc;
    if (w.poId !== poId || w.status === 'CLOSED') return acc;
    return acc + plannedOnWaveForPoLine(w, poLineId);
  }, 0);
}

/** สร้างข้อความสถานที่จาก workLocation ของแต่ละบรรทัดที่เลือก */
export function deriveSiteLocationFromAllocations(
  allocations: WaveLineAllocation[],
  lines: POLine[] | null | undefined,
  poId: string,
): string {
  const list = lines || [];
  const locs: string[] = [];
  const seen = new Set<string>();
  for (const a of allocations) {
    const line = list.find((l) => l.id === a.poLineId && l.poId === poId);
    const w = (line?.workLocation || '').trim();
    if (w && !seen.has(w)) {
      seen.add(w);
      locs.push(w);
    }
  }
  return locs.join(' · ');
}
