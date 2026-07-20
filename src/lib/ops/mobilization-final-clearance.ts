import type { Assignment, RateConditionEventType } from '@/lib/types';

export type MobStandbyMobDayChoice = Extract<RateConditionEventType, 'standby_day' | 'mobilization_day'>;

/** รหัสแสดงบนกระดานลงเวลา — สอดคล้อง po-daily-board (`SB` / `MO`) */
export function mobStandbyMobDayStatusCode(
  eventType: MobStandbyMobDayChoice | string | undefined | null,
): 'SB' | 'MO' | null {
  if (eventType === 'standby_day') return 'SB';
  if (eventType === 'mobilization_day') return 'MO';
  return null;
}

export function mobStandbyMobDayChoiceLabel(
  eventType: MobStandbyMobDayChoice | string | undefined | null,
): string {
  if (eventType === 'standby_day') return 'Pre-Mob';
  if (eventType === 'mobilization_day') return 'Mob';
  return '—';
}

/** วันที่ปฏิทินในเขต Asia/Bangkok (เก็บเป็น yyyy-mm-dd) */
export function thailandTodayYmd(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** บวกจำนวนวันปฏิทินบนสตริง yyyy-mm-dd (Gregorian civil) */
export function addDaysToYmd(ymd: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd.trim();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, da + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** ขั้น 1 เสร็จเมื่อมี timestamp หรือสถานะเดิมผ่านขั้นนี้แล้ว (ข้อมูลเก่าก่อนเฟส 3) */
export function isFinalClearanceStep1Done(
  a: Pick<Assignment, 'mobReadyToTravelAt' | 'deploymentStatus'>,
): boolean {
  if (typeof a.mobReadyToTravelAt === 'number' && a.mobReadyToTravelAt > 0) return true;
  const ds = a.deploymentStatus;
  return ds === 'READY_TO_MOB' || ds === 'MOBILIZING' || ds === 'ACTIVE';
}

export function isFinalClearanceStep2Done(
  a: Pick<Assignment, 'mobStandbyRecordedAt' | 'deploymentStatus'>,
): boolean {
  if (typeof a.mobStandbyRecordedAt === 'number' && a.mobStandbyRecordedAt > 0) return true;
  const ds = a.deploymentStatus;
  return ds === 'MOBILIZING' || ds === 'ACTIVE';
}

export function isFinalClearanceStep3Done(
  a: Pick<Assignment, 'mobWorkingStartedAt' | 'deploymentStatus'>,
): boolean {
  if (typeof a.mobWorkingStartedAt === 'number' && a.mobWorkingStartedAt > 0) return true;
  return a.deploymentStatus === 'ACTIVE';
}

/**
 * คิวโควต้า PO Active — นับเป็น «กำลังทำงานบนไซต์» เมื่อมีวันเริ่มงานบันทึกแล้ว หรือผ่านขั้นเริ่มงาน (timestamp / ACTIVE)
 */
export function assignmentHasMobWorkStartedForQuotaDisplay(
  a: Pick<Assignment, 'mobWorkingStartedAt' | 'mobWorkingStartDate' | 'deploymentStatus'>,
): boolean {
  const ws = (a.mobWorkingStartDate || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ws)) return true;
  return isFinalClearanceStep3Done(a);
}

export function isMobUnassigned(a: Pick<Assignment, 'unassignedAt'>): boolean {
  return typeof a.unassignedAt === 'number' && a.unassignedAt > 0;
}

/** เฟส 1 PO workflow — ต้องระบุไซต์ก่อนขั้นที่ 1 */
export function assignmentHasMobLocationForPhase1(a: Assignment): boolean {
  if (a.mobWorkflowVersion !== 'po_active_v2') return true;
  const key = (a.mobLocationKey || '').trim();
  const wl = (a.workLocation || '').trim();
  return key.length > 0 || wl.length > 0;
}

export type FinalClearanceGate = { ok: true } | { ok: false; message: string };

/** เฟส 3: ปุ่ม 1→2→3 ห้ามข้าม — ผลตรวจสารเสพติดต้อง valid ทุกครั้งก่อนลง (หมดอายุต้องตรวจซ้ำ) */
export function canRunFinalClearanceStep(
  a: Assignment,
  step: 1 | 2 | 3,
  options?: { readinessOk: boolean; drugOk?: boolean; drugMessage?: string },
): FinalClearanceGate {
  if (isMobUnassigned(a)) {
    return { ok: false, message: 'รายการนี้ Unassign แล้ว — ไม่สามารถดำเนินการ Final clearance ต่อได้' };
  }
  if (step === 1) {
    if (isFinalClearanceStep1Done(a)) return { ok: false, message: 'ยืนยันขั้นที่ 1 แล้ว' };
    if (!assignmentHasMobLocationForPhase1(a)) {
      return {
        ok: false,
        message: 'เลือกสถานที่ปฏิบัติงาน (ไซต์) ก่อนยืนยันพร้อมเดินทาง — ใช้การ์ด «สถานที่ปฏิบัติงาน» ด้านบน',
      };
    }
    if (options && !options.readinessOk) {
      return { ok: false, message: 'ความพร้อมยังไม่ครบ — แก้ checklist ก่อนยืนยันเดินทาง' };
    }
    if (options?.drugOk === false) {
      return {
        ok: false,
        message: options.drugMessage || 'ผลตรวจสารเสพติดหมดอายุหรือยังไม่ครบ — ตรวจใหม่ก่อนยืนยันเดินทาง',
      };
    }
    return { ok: true };
  }
  if (step === 2) {
    if (!isFinalClearanceStep1Done(a)) {
      return { ok: false, message: 'ต้องยืนยัน «พร้อมเดินทาง» (ขั้นที่ 1) ก่อนบันทึกวัน Standby' };
    }
    if (isFinalClearanceStep2Done(a)) return { ok: false, message: 'บันทึก Standby แล้ว' };
    if (options?.drugOk === false) {
      return {
        ok: false,
        message: options.drugMessage || 'ผลตรวจสารเสพติดหมดอายุหรือยังไม่ครบ — ตรวจใหม่ก่อน mob',
      };
    }
    return { ok: true };
  }
  if (!isFinalClearanceStep2Done(a)) {
    return { ok: false, message: 'ต้องบันทึกวัน Standby (ขั้นที่ 2) ก่อนเริ่มวันทำงาน' };
  }
  if (isFinalClearanceStep3Done(a)) return { ok: false, message: 'เริ่มวันทำงานแล้ว' };
  if (options?.drugOk === false) {
    return {
      ok: false,
      message: options.drugMessage || 'ผลตรวจสารเสพติดหมดอายุหรือยังไม่ครบ — ตรวจใหม่ก่อนเริ่มงาน',
    };
  }
  return { ok: true };
}

/** คนที่ทับจากเดือนก่อน / รอบ Mob > 1 — เติมวันทำงานต้นเดือนปฏิทินจนถึงก่อนวัน Standby */
export function shouldAutoFillPrefixWorkDaysBeforeStandby(
  a: Pick<Assignment, 'mobCycleNumber' | 'startDate'>,
  standbyYmd: string,
): boolean {
  const ym = standbyYmd.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return false;
  const monthStart = `${ym}-01`;
  const sd = (a.startDate || '').trim().slice(0, 10);
  if ((a.mobCycleNumber ?? 1) > 1) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(sd) && sd < monthStart) return true;
  return false;
}

/** บันทึก Standby (ครั้งแรกหรือแก้ไข) */
export function canSaveFinalClearanceStandby(
  a: Assignment,
  opts?: { editingExisting: boolean; drugOk?: boolean; drugMessage?: string },
): FinalClearanceGate {
  if (isMobUnassigned(a)) {
    return { ok: false, message: 'รายการนี้ Unassign แล้ว — ไม่สามารถดำเนินการ Final clearance ต่อได้' };
  }
  if (!isFinalClearanceStep1Done(a)) {
    return { ok: false, message: 'ต้องยืนยัน «พร้อมเดินทาง» (ขั้นที่ 1) ก่อนบันทึกวัน Standby' };
  }
  if (isFinalClearanceStep2Done(a) && !opts?.editingExisting) {
    return { ok: false, message: 'บันทึก Standby แล้ว — ใช้ปุ่มแก้ไขหากต้องการเปลี่ยนวันที่' };
  }
  if (opts?.drugOk === false) {
    return {
      ok: false,
      message: opts.drugMessage || 'ผลตรวจสารเสพติดหมดอายุหรือยังไม่ครบ — ตรวจใหม่ก่อน mob',
    };
  }
  return { ok: true };
}

/** เริ่มวันทำงาน (ครั้งแรกหรือแก้ไข) */
export function canSaveFinalClearanceWorkStart(
  a: Assignment,
  opts?: { editingExisting: boolean; drugOk?: boolean; drugMessage?: string },
): FinalClearanceGate {
  if (isMobUnassigned(a)) {
    return { ok: false, message: 'รายการนี้ Unassign แล้ว — ไม่สามารถดำเนินการ Final clearance ต่อได้' };
  }
  if (!isFinalClearanceStep2Done(a)) {
    return { ok: false, message: 'ต้องบันทึกวัน Standby (ขั้นที่ 2) ก่อนเริ่มวันทำงาน' };
  }
  if (isFinalClearanceStep3Done(a) && !opts?.editingExisting) {
    return { ok: false, message: 'เริ่มวันทำงานแล้ว — ใช้ปุ่มแก้ไขหากต้องการเปลี่ยนวันที่' };
  }
  if (opts?.drugOk === false) {
    return {
      ok: false,
      message: opts.drugMessage || 'ผลตรวจสารเสพติดหมดอายุหรือยังไม่ครบ — ตรวจใหม่ก่อนเริ่มงาน',
    };
  }
  return { ok: true };
}

/** ย้อนขั้น 1 ได้เมื่อยังไม่บันทึก Standby */
export function canRevertFinalClearanceStep1(a: Assignment): FinalClearanceGate {
  if (isMobUnassigned(a)) {
    return { ok: false, message: 'รายการนี้ Unassign แล้ว' };
  }
  if (!isFinalClearanceStep1Done(a)) {
    return { ok: false, message: 'ยังไม่ได้ยืนยันขั้นที่ 1' };
  }
  if (isFinalClearanceStep2Done(a)) {
    return {
      ok: false,
      message: 'แก้ขั้นที่ 1 ไม่ได้เมื่อบันทึก Standby แล้ว — ให้ใช้ปุ่มแก้ไขขั้นที่ 2 (ระบบจะย้อนขั้นที่ 3 ถ้ามี)',
    };
  }
  return { ok: true };
}
