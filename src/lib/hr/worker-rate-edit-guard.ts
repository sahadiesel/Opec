import type { Worker } from '@/lib/types';

export type WorkerRateEditNotice = {
  title: string;
  bullets: string[];
};

function moneyChanged(a: number | undefined, b: number | undefined): boolean {
  const na = Number(a);
  const nb = Number(b);
  const fa = Number.isFinite(na) ? na : 0;
  const fb = Number.isFinite(nb) ? nb : 0;
  return fa !== fb;
}

/**
 * เตือนก่อนบันทึกตำแหน่งหรือแพ็กค่าแรง — วันเก่าไม่ถูกเขียนทับ
 * คืน null ถ้าไม่มีฟิลด์ที่กระทบเงินเดือน/บิล
 */
export function describeWorkerRateEdit(params: {
  before: Pick<
    Worker,
    | 'currentPositionId'
    | 'laborCostUsePositionDefault'
    | 'laborCostCustomOnshore'
    | 'laborCostCustomOffshore'
  >;
  after: Partial<Worker>;
  openAssignmentCount: number;
}): WorkerRateEditNotice | null {
  const { before, after, openAssignmentCount } = params;
  const positionChanged =
    after.currentPositionId != null &&
    String(after.currentPositionId).trim() !== String(before.currentPositionId || '').trim();
  const useDefaultChanged =
    after.laborCostUsePositionDefault != null &&
    after.laborCostUsePositionDefault !== before.laborCostUsePositionDefault;
  const onshoreChanged = moneyChanged(before.laborCostCustomOnshore, after.laborCostCustomOnshore);
  const offshoreChanged = moneyChanged(before.laborCostCustomOffshore, after.laborCostCustomOffshore);
  const laborChanged = useDefaultChanged || onshoreChanged || offshoreChanged;
  if (!positionChanged && !laborChanged) return null;

  const bullets: string[] = [];
  if (positionChanged) {
    bullets.push('ตำแหน่งในทะเบียนจะเป็นตำแหน่งใหม่ — วันที่ลงไว้แล้วไม่ถูกเปลี่ยนตำแหน่งย้อนหลัง');
  }
  if (laborChanged) {
    bullets.push('แพ็กค่าแรงใหม่ใช้กับวันหลังจากจบงานรอบนี้แล้วเริ่มรอบใหม่เท่านั้น');
  }
  bullets.push(
    'วันก่อนวันจบไซต์ยังจ่ายตามอัตราที่ถ่ายไว้ตอนกดจบงาน ไม่ดึงราคาที่แก้ในทะเบียนตอนนี้',
  );
  bullets.push(
    'ใบวางบิลใช้บรรทัด PO ของแต่ละวัน ไม่เปลี่ยนเพราะแก้ทะเบียน — ถ้าครึ่งเดือนหลังคนละตำแหน่งหรือคนละบริษัท ต้องจบงานรอบแรก แล้ว remob หรือมอบหมายใหม่ก่อนลงวันถัดไป',
  );
  if (openAssignmentCount > 0) {
    bullets.push(
      `คนนี้ยังมีงานที่ยังไม่จบ ${openAssignmentCount} รายการ — ถ้าไม่จบงานก่อน วันใหม่จะยังคิดด้วยตำแหน่งและราคาของรอบเดิม`,
    );
  }

  return {
    title: positionChanged && laborChanged
      ? 'ยืนยันแก้ตำแหน่งและค่าแรง'
      : positionChanged
        ? 'ยืนยันเปลี่ยนตำแหน่ง'
        : 'ยืนยันแก้แพ็กค่าแรง',
    bullets,
  };
}
