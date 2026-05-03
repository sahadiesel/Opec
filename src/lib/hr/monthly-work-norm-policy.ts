/** นโยบายวันทำงานมาตรฐานต่อเดือน / เวลาทำงานปกติ — เก็บใน payroll_policies kind=monthly_work_norm */

export type MonthlyWorkNormPolicyConfig = {
  /** จำนวนวันทำงานมาตรฐานต่อเดือน (หารเงินเดือนเมื่อขาดงาน / ไม่ครบวัน) */
  standardWorkingDaysPerMonth: number;
  /** ชั่วโมงทำงานปกติต่อวัน (ไม่รวมพัก) */
  normalWorkingHoursPerDay: number;
  /** ชั่วโมงพักต่อวัน */
  breakHoursPerDay: number;
  /** เวลาเริ่มงาน HH:mm (24 ชม.) */
  workStartTime: string;
};

export const DEFAULT_MONTHLY_WORK_NORM: MonthlyWorkNormPolicyConfig = {
  standardWorkingDaysPerMonth: 26,
  normalWorkingHoursPerDay: 8,
  breakHoursPerDay: 1,
  workStartTime: '08:00',
};

function clampFinite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/** อ่านจาก policy.config */
export function monthlyWorkNormFromUnknownConfig(raw: Record<string, unknown> | undefined): MonthlyWorkNormPolicyConfig {
  const d = DEFAULT_MONTHLY_WORK_NORM;
  if (!raw || typeof raw !== 'object') return { ...d };
  const days = clampFinite(Number(raw.standardWorkingDaysPerMonth), d.standardWorkingDaysPerMonth);
  const workH = clampFinite(Number(raw.normalWorkingHoursPerDay), d.normalWorkingHoursPerDay);
  const breakH = clampFinite(Number(raw.breakHoursPerDay), d.breakHoursPerDay);
  const start =
    typeof raw.workStartTime === 'string' && /^(\d{1,2}):(\d{2})$/.test(raw.workStartTime.trim())
      ? raw.workStartTime.trim()
      : d.workStartTime;
  return {
    standardWorkingDaysPerMonth: days,
    normalWorkingHoursPerDay: workH,
    breakHoursPerDay: breakH,
    workStartTime: start,
  };
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** เวลาเลิก = เริ่ม + ชม.ทำงาน + ชม.พัก (แสดงช่วงต่อเนื่องจากเที่ยงคืน ถ้าข้ามวันมีข้อความ +N วัน) */
export function computeWorkDayEndDisplay(cfg: MonthlyWorkNormPolicyConfig): string {
  const m = TIME_RE.exec(cfg.workStartTime.trim());
  if (!m) return '—';
  let h = Number(m[1]);
  let min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min < 0 || min > 59 || h < 0 || h > 23) return '—';
  const startTotalMin = h * 60 + min;
  const addMin = Math.round((cfg.normalWorkingHoursPerDay + cfg.breakHoursPerDay) * 60);
  if (!Number.isFinite(addMin) || addMin < 0) return '—';
  const endTotalMin = startTotalMin + addMin;
  const wraps = Math.floor(endTotalMin / (24 * 60));
  const rem = endTotalMin % (24 * 60);
  const eh = Math.floor(rem / 60);
  const em = rem % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  const time = `${pad(eh)}:${pad(em)}`;
  if (wraps > 0) return `${time} (+${wraps} วัน)`;
  return time;
}

/** ข้อความ error ภาษาไทย หรือ null ถ้าผ่าน */
export function validateMonthlyWorkNormForSave(cfg: MonthlyWorkNormPolicyConfig): string | null {
  const days = Math.round(cfg.standardWorkingDaysPerMonth);
  if (!Number.isFinite(days) || days < 1 || days > 31) {
    return 'จำนวนวันทำงานต่อเดือนต้องอยู่ระหว่าง 1–31';
  }
  const wh = cfg.normalWorkingHoursPerDay;
  if (!Number.isFinite(wh) || wh <= 0 || wh > 24) {
    return 'ชั่วโมงทำงานปกติต่อวันต้องมากกว่า 0 และไม่เกิน 24';
  }
  const bh = cfg.breakHoursPerDay;
  if (!Number.isFinite(bh) || bh < 0 || bh > 24) {
    return 'ชั่วโมงพักต่อวันต้องอยู่ระหว่าง 0–24';
  }
  if (!TIME_RE.test(cfg.workStartTime.trim())) {
    return 'เวลาเริ่มงานต้องเป็นรูปแบบ HH:mm (เช่น 08:00)';
  }
  const [, hh, mm] = cfg.workStartTime.trim().match(TIME_RE)!;
  const h = Number(hh);
  const mi = Number(mm);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) {
    return 'เวลาเริ่มงานไม่ถูกต้อง';
  }
  return null;
}
