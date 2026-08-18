import type { Assignment, ChecklistItemStatus, RateConditionEventType } from '@/lib/types';

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

/** วันเริ่มงานหลัง Mob — วันปฏิทินถัดจากวัน M1 */
export function workStartYmdAfterMob(mobYmd: string): string {
  return addDaysToYmd(mobYmd.trim().slice(0, 10), 1);
}

function checklistPass(status: ChecklistItemStatus | string | undefined | null): boolean {
  return status === 'pass';
}

/**
 * ขั้น 1 (แสดงผล) — พร้อมเดินทางเมื่อ checklist 1–4 ผ่าน:
 * พาส/บัตร · แพทย์ · ใบเซอร์ · ผลตรวจสารเสพติด
 */
export function isTravelReadyDisplay(
  a: Pick<Assignment, 'readinessSummary'>,
  drugOk: boolean,
): boolean {
  const s = a.readinessSummary;
  return (
    checklistPass(s?.passportValid) &&
    checklistPass(s?.medicalValid) &&
    checklistPass(s?.certificatesComplete) &&
    drugOk
  );
}

/** ขั้น 1 เสร็จเมื่อมี timestamp หรือสถานะเดิมผ่านขั้นนี้แล้ว (ข้อมูลเก่าก่อนเฟส 3) */
export function isFinalClearanceStep1Done(
  a: Pick<Assignment, 'mobReadyToTravelAt' | 'deploymentStatus'>,
): boolean {
  if (typeof a.mobReadyToTravelAt === 'number' && a.mobReadyToTravelAt > 0) return true;
  const ds = a.deploymentStatus;
  return ds === 'READY_TO_MOB' || ds === 'MOBILIZING' || ds === 'ACTIVE';
}

/** ขั้น Pre-Mob เสร็จ — มีวันที่ SB หรือข้าม หรือ legacy step2 */
export function isFinalClearancePreMobDone(
  a: Pick<
    Assignment,
    | 'mobPreMobDate'
    | 'mobPreMobSkipped'
    | 'mobPreMobRecordedAt'
    | 'mobStep2Choice'
    | 'mobStandbyRecordedAt'
    | 'mobStandbyDayEventType'
  >,
): boolean {
  if (a.mobPreMobSkipped === true) return true;
  if ((a.mobPreMobDate || '').trim().length >= 10) return true;
  if (typeof a.mobPreMobRecordedAt === 'number' && a.mobPreMobRecordedAt > 0) return true;
  // legacy: บันทึก Pre-Mob/Mob รวมขั้นเดียวแล้ว
  if (typeof a.mobStandbyRecordedAt === 'number' && a.mobStandbyRecordedAt > 0) {
    if (a.mobStep2Choice === 'PRE_MOB' || a.mobStep2Choice === 'MOB') return true;
    if (a.mobStandbyDayEventType === 'standby_day' || a.mobStandbyDayEventType === 'mobilization_day') {
      return true;
    }
  }
  return false;
}

/** ขั้น Mob เสร็จ — มีวัน M1 / ข้าม Mob (หรือ legacy ที่ถือว่าจบขั้น Standby/Mob แล้ว) */
export function isFinalClearanceMobDone(
  a: Pick<
    Assignment,
    | 'mobStandbyRecordedAt'
    | 'mobStandbyDayEventType'
    | 'mobStep2Choice'
    | 'mobPreMobDate'
    | 'mobMobSkipped'
    | 'deploymentStatus'
  >,
): boolean {
  if (a.deploymentStatus === 'ACTIVE') return true;
  if (a.mobMobSkipped === true) return true;
  if (!(typeof a.mobStandbyRecordedAt === 'number' && a.mobStandbyRecordedAt > 0)) return false;
  if (a.mobStandbyDayEventType === 'mobilization_day' || a.mobStep2Choice === 'MOB') return true;
  // legacy PRE_MOB เป็นขั้นเดียวก่อนแยก Pre-Mob/Mob — ถือว่าจบขั้น Mob เพื่อเริ่มงานได้
  if (a.mobStep2Choice === 'PRE_MOB' && !(a.mobPreMobDate || '').trim()) return true;
  if (a.mobStandbyDayEventType === 'standby_day' && !(a.mobPreMobDate || '').trim()) return true;
  return false;
}

/**
 * ขั้น Standby/Mob เดิม (ก่อนเริ่มงาน) — ใช้กับ gate เริ่มวันทำงาน
 * = มีวัน Mob แล้ว (หรือ legacy ที่จบขั้น 2 แล้ว)
 */
export function isFinalClearanceStep2Done(
  a: Pick<
    Assignment,
    | 'mobStandbyRecordedAt'
    | 'deploymentStatus'
    | 'mobStandbyDayEventType'
    | 'mobStep2Choice'
    | 'mobPreMobDate'
    | 'mobMobSkipped'
  >,
): boolean {
  return isFinalClearanceMobDone(a);
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

/** เฟส 1 PO workflow — ต้องระบุไซต์ก่อนขั้นถัดไป */
export function assignmentHasMobLocationForPhase1(a: Assignment): boolean {
  if (a.mobWorkflowVersion !== 'po_active_v2') return true;
  const key = (a.mobLocationKey || '').trim();
  const wl = (a.workLocation || '').trim();
  return key.length > 0 || wl.length > 0;
}

export type FinalClearanceGate = { ok: true } | { ok: false; message: string };

/** เฟส 3: ปุ่มตามลำดับ — ผลตรวจสารเสพติดต้อง valid ทุกครั้งก่อนลง */
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
        message: 'เลือกสถานที่ปฏิบัติงาน (ไซต์) ก่อน — ใช้ขั้นที่ 2 ใน Final Clearance',
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
    if (!assignmentHasMobLocationForPhase1(a)) {
      return { ok: false, message: 'ต้องบันทึกสถานที่ (ขั้นที่ 2) ก่อน' };
    }
    if (options && !options.readinessOk) {
      return { ok: false, message: 'ยังไม่พร้อมเดินทาง — ตรวจ checklist 1–4 ให้ผ่านก่อน' };
    }
    if (isFinalClearanceStep2Done(a)) return { ok: false, message: 'บันทึก Mob แล้ว' };
    if (options?.drugOk === false) {
      return {
        ok: false,
        message: options.drugMessage || 'ผลตรวจสารเสพติดหมดอายุหรือยังไม่ครบ — ตรวจใหม่ก่อน mob',
      };
    }
    return { ok: true };
  }
  if (!isFinalClearanceStep2Done(a)) {
    return { ok: false, message: 'ต้องบันทึกวัน Mob (ขั้นที่ 4) ก่อนเริ่มวันทำงาน' };
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

/**
 * เติม W ต้นเดือนจนถึงก่อนวัน Standby — เฉพาะคนที่มอบหมายมาจากเดือนก่อน (carry-over รอบแรก)
 * ไม่ใช้ mobCycle > 1 / remob หลังจบไซต์: จะไปเติม W วันก่อนเริ่มงานรอบใหม่ (เช่น remob 17 → เติม W 1–16)
 */
export function shouldAutoFillPrefixWorkDaysBeforeStandby(
  a: Pick<
    Assignment,
    'mobCycleNumber' | 'startDate' | 'mobLocationEndDate' | 'mobWorkingStartDate' | 'mobStandbyDate'
  >,
  standbyYmd: string,
): boolean {
  const st = standbyYmd.trim().slice(0, 10);
  const ym = st.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym) || !/^\d{4}-\d{2}-\d{2}$/.test(st)) return false;

  const cycle =
    typeof a.mobCycleNumber === 'number' && Number.isFinite(a.mobCycleNumber) ? a.mobCycleNumber : 1;
  if (cycle > 1) return false;

  /** remob บนเอกสารเดิม: จบไซต์รอบเก่าแล้วยังไม่ถึง / ก่อน SB หรือเริ่มงานรอบใหม่ */
  const mobEnd = (a.mobLocationEndDate || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(mobEnd)) {
    const mobStart = (a.mobWorkingStartDate || '').trim().slice(0, 10);
    if (mobEnd < st) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(mobStart) && mobEnd < mobStart) return false;
  }

  const monthStart = `${ym}-01`;
  const sd = (a.startDate || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sd) && sd < monthStart) return true;
  return false;
}

/** บันทึก Pre-Mob (SB) หรือข้าม */
export function canSaveFinalClearancePreMob(
  a: Assignment,
  opts?: { editingExisting?: boolean; drugOk?: boolean; drugMessage?: string; travelReady?: boolean },
): FinalClearanceGate {
  if (isMobUnassigned(a)) {
    return { ok: false, message: 'รายการนี้ Unassign แล้ว — ไม่สามารถดำเนินการ Final clearance ต่อได้' };
  }
  if (!assignmentHasMobLocationForPhase1(a)) {
    return { ok: false, message: 'ต้องบันทึกสถานที่ (ขั้นที่ 2) ก่อน' };
  }
  if (opts?.travelReady === false) {
    return { ok: false, message: 'ยังไม่พร้อมเดินทาง — ตรวจ checklist 1–4 ให้ผ่านก่อน' };
  }
  if (isFinalClearancePreMobDone(a) && !opts?.editingExisting) {
    return { ok: false, message: 'บันทึก / ข้าม Pre-Mob แล้ว' };
  }
  if (isFinalClearanceMobDone(a) && !opts?.editingExisting) {
    return { ok: false, message: 'บันทึก Mob แล้ว — ไม่สามารถแก้ Pre-Mob ได้' };
  }
  if (opts?.drugOk === false) {
    return {
      ok: false,
      message: opts.drugMessage || 'ผลตรวจสารเสพติดหมดอายุหรือยังไม่ครบ — ตรวจใหม่ก่อน',
    };
  }
  return { ok: true };
}

/** บันทึก Mob (M1) */
export function canSaveFinalClearanceMob(
  a: Assignment,
  opts?: { editingExisting?: boolean; drugOk?: boolean; drugMessage?: string; travelReady?: boolean },
): FinalClearanceGate {
  if (isMobUnassigned(a)) {
    return { ok: false, message: 'รายการนี้ Unassign แล้ว — ไม่สามารถดำเนินการ Final clearance ต่อได้' };
  }
  if (!assignmentHasMobLocationForPhase1(a)) {
    return { ok: false, message: 'ต้องบันทึกสถานที่ (ขั้นที่ 2) ก่อน' };
  }
  if (opts?.travelReady === false) {
    return { ok: false, message: 'ยังไม่พร้อมเดินทาง — ตรวจ checklist 1–4 ให้ผ่านก่อน' };
  }
  if (!isFinalClearancePreMobDone(a)) {
    return { ok: false, message: 'ต้องบันทึก Pre-Mob หรือกด «ไม่มี Pre-Mob» ก่อน' };
  }
  if (isFinalClearanceMobDone(a) && !opts?.editingExisting) {
    return { ok: false, message: 'บันทึก Mob แล้ว — ใช้ปุ่มแก้ไขหากต้องการเปลี่ยนวันที่' };
  }
  if (opts?.drugOk === false) {
    return {
      ok: false,
      message: opts.drugMessage || 'ผลตรวจสารเสพติดหมดอายุหรือยังไม่ครบ — ตรวจใหม่ก่อน mob',
    };
  }
  return { ok: true };
}

/** บันทึก Standby/Mob (ครั้งแรกหรือแก้ไข) — ใช้กับ Mob เป็นหลัก */
export function canSaveFinalClearanceStandby(
  a: Assignment,
  opts?: { editingExisting: boolean; drugOk?: boolean; drugMessage?: string; travelReady?: boolean },
): FinalClearanceGate {
  return canSaveFinalClearanceMob(a, opts);
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
    return { ok: false, message: 'ต้องบันทึกวัน Mob (ขั้นที่ 4) ก่อนเริ่มวันทำงาน' };
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

/** ย้อนขั้น 1 ได้เมื่อยังไม่บันทึก Standby/Mob */
export function canRevertFinalClearanceStep1(a: Assignment): FinalClearanceGate {
  if (isMobUnassigned(a)) {
    return { ok: false, message: 'รายการนี้ Unassign แล้ว' };
  }
  if (!isFinalClearanceStep1Done(a)) {
    return { ok: false, message: 'ยังไม่ได้ยืนยันขั้นที่ 1' };
  }
  if (isFinalClearanceStep2Done(a) || isFinalClearancePreMobDone(a)) {
    return {
      ok: false,
      message: 'แก้ขั้นพร้อมเดินทางไม่ได้เมื่อบันทึก Pre-Mob/Mob แล้ว',
    };
  }
  return { ok: true };
}
