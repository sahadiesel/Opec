function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** จุดในวงเล็บของบรรทัด Mob/Demob — ใช้รวมบรรทัดที่อยู่เดียวกัน */
export function mobDemobLocationLabelFromDescription(description: string): string {
  const matches = [...String(description || '').matchAll(/\(([^)]+)\)/g)];
  const label = matches.map((m) => m[1]?.trim() || '').find((s) => s.length > 0);
  return label || String(description || '').trim();
}

function isMobDemobRoundTripLine(line: { eventType?: string; description: string }): boolean {
  if (line.eventType === 'trip_mob_demob_round_trip') return true;
  return /ค่า Mob\/Demob ไป-กลับ|Mob\/Demob round-trip fee/i.test(line.description || '');
}

type MobDemobCollapsibleLine = {
  description: string;
  eventType?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  workerId?: string;
  workerName?: string;
  positionId?: string;
  timesheetIds?: string[];
};

/** จุดเดียวกัน + ราคาเดียวกัน = หนึ่งบรรทัด ไม่ใส่ชื่อคนหรือตำแหน่ง */
export function collapseSameLocationMobDemobLines<T extends MobDemobCollapsibleLine>(lines: T[]): T[] {
  const out: T[] = [];
  const indexByKey = new Map<string, number>();
  for (const line of lines) {
    if (!isMobDemobRoundTripLine(line)) {
      out.push(line);
      continue;
    }
    const loc = mobDemobLocationLabelFromDescription(line.description);
    const price = roundMoney(Number(line.unitPrice) || 0);
    const key = `${loc}__${price}`;
    const quantity = Number(line.quantity) || 0;
    const hit = indexByKey.get(key);
    if (hit == null) {
      indexByKey.set(key, out.length);
      out.push({
        ...line,
        description: `ค่า Mob/Demob ไป-กลับ (${loc})`,
        workerId: undefined,
        workerName: undefined,
        positionId: undefined as T['positionId'],
        quantity,
        unitPrice: price,
        amount: roundMoney(price * quantity),
      });
      continue;
    }
    const prev = out[hit]!;
    const nextQty = (Number(prev.quantity) || 0) + quantity;
    const timesheetIds = [...(prev.timesheetIds ?? []), ...(line.timesheetIds ?? [])];
    out[hit] = {
      ...prev,
      quantity: nextQty,
      unitPrice: price,
      amount: roundMoney(price * nextQty),
      timesheetIds: timesheetIds.length > 0 ? [...new Set(timesheetIds)] : prev.timesheetIds,
      workerId: undefined,
      workerName: undefined,
      positionId: undefined as T['positionId'],
    };
  }
  return out;
}
