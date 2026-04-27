import type { Assignment, DeploymentStatus } from '@/lib/types';

/** มอบหมายที่ยัง "อยู่ใน wave" สำหรับนับตัวเลขมอบหมาย/แผน (ไม่นับจบ & ปิดบัญชี) */
const TERMINAL: DeploymentStatus[] = ['DEMOBILIZED', 'CLOSED'];

/**
 * รายมอบหมายยังนับฝั่ง "คนมอบหมาย" สำหรับสัดส่วน มอบหมาย/แผน
 * — ยกเว้น Demob/ปิดรายการ ซึ่งยังมี document ลิงก์ wave เดิม
 */
export function isAssignmentActiveOnWaveRoster(
  a: Pick<Assignment, 'deploymentStatus'>,
): boolean {
  const s = a.deploymentStatus as DeploymentStatus;
  return !TERMINAL.includes(s);
}

export function countActiveAssignmentsOnWaveRoster(
  mobs: readonly Pick<Assignment, 'deploymentStatus'>[] | null | undefined,
): number {
  if (!mobs?.length) return 0;
  return mobs.filter((m) => isAssignmentActiveOnWaveRoster(m)).length;
}

/**
 * กรณีเดียวกัน (worker) มีมากกว่า 1 รายการมอบหมายบน wave เดิม (เช่น demob แล้วยังลิงก์) — แสดง/นับเฉพาะรายการที่ "ยังอยู่บน roster"
 * หรือรายการล่าสุดถ้าทุกอัน terminal
 */
export function pickRosterLinePerWorker(mobs: readonly Assignment[]): Assignment[] {
  if (!mobs.length) return [];
  const by = new Map<string, Assignment[]>();
  for (const a of mobs) {
    const w = a.workerId;
    const list = by.get(w) ?? [];
    list.push(a);
    by.set(w, list);
  }
  const out: Assignment[] = [];
  for (const list of by.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const actives = list.filter((a) => isAssignmentActiveOnWaveRoster(a));
    if (actives.length) {
      out.push(actives.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b)));
      continue;
    }
    out.push(list.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b)));
  }
  return out;
}

/**
 * หน้า Assignments: ลูกจ้าง 1 คน + wave เดียวกัน ไม่ควรแสดงมากกว่า 1 แถว (ราย demob เก่าซ้อนราย active ใหม่)
 */
export function dedupeAssignmentsByWorkerAndWave(mobs: readonly Assignment[]): Assignment[] {
  if (!mobs.length) return [];
  const by = new Map<string, Assignment[]>();
  for (const a of mobs) {
    const k = `${a.workerId}::${a.waveId}`;
    const list = by.get(k) ?? [];
    list.push(a);
    by.set(k, list);
  }
  const out: Assignment[] = [];
  for (const list of by.values()) {
    out.push(...pickRosterLinePerWorker(list));
  }
  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
