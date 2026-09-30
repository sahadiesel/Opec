/** นโยบายวันทำงานมาตรฐานต่อเดือน / เวลาทำงานปกติ — เก็บใน payroll_policies kind=monthly_work_norm */

import { otHoursFromHmRange } from '@/lib/attendance/overtime-time';

/** ช่วงหักสายตามประกาศ — นาทีหลังเวลาเริ่มกะ (เช้าเทียบ workStart, บ่ายเทียบ เริ่มบ่าย) */
export type OfficeLatePenaltyBand = {
  fromAfterStartMinutes: number;
  toAfterStartMinutes: number;
  deductMinutes: number;
};

/** ค่าเริ่มต้นตามประกาศ HR (08:01–05 หัก 10 / 06–10 หัก 20 / 11–15 หัก 30) */
export const DEFAULT_OFFICE_LATE_PENALTY_BANDS: OfficeLatePenaltyBand[] = [
  { fromAfterStartMinutes: 1, toAfterStartMinutes: 5, deductMinutes: 10 },
  { fromAfterStartMinutes: 6, toAfterStartMinutes: 10, deductMinutes: 20 },
  { fromAfterStartMinutes: 11, toAfterStartMinutes: 15, deductMinutes: 30 },
];

export type MonthlyWorkNormPolicyConfig = {
  /** จำนวนวันทำงานมาตรฐานต่อเดือน (หารเงินเดือนเมื่อขาดงาน / ไม่ครบวัน) */
  standardWorkingDaysPerMonth: number;
  /** ชั่วโมงทำงานปกติต่อวัน (ไม่รวมพัก) */
  normalWorkingHoursPerDay: number;
  /** ชั่วโมงพักต่อวัน */
  breakHoursPerDay: number;
  /** เวลาเริ่มงาน HH:mm (24 ชม.) */
  workStartTime: string;
  /** เวลาเริ่มพัก HH:mm — ปกติ = เวลาเริ่ม + ครึ่งกะเช้า; ตั้งให้ชัดเจนเพื่อใช้คำนวณช่วงเช้า/บ่าย */
  breakStartTime?: string;
  /** จำนวนนาทีผ่อนผันก่อนถูกนับว่าสาย (เช่น 5 = หลัง 08:05 จึงเริ่มคิด) */
  lateGraceMinutes?: number;
  /**
   * ช่วงสายตามประกาศบริษัท — นับนาทีหลังเวลาเริ่มกะ (เช่น เริ่ม 08:00 → 1–5 = 08:01–08:05)
   * หักเป็น `deductMinutes` จากฐานเงินเดือนจริงของคนนั้น (เงินเดือน ÷ วัน ÷ นาทีทำงาน)
   * อาร์เรย์ว่าง = หักตามนาทีที่สายจริงหลังผ่อนผัน
   */
  latePenaltyBands?: OfficeLatePenaltyBand[];
  /** A — ตัวคูณทำงานในวันหยุดนักขัตฤกษ์/วันอาทิตย์ (เวลาทำงานปกติ) */
  officeHolidayNormalWorkMultiplier?: number;
  /** B — ตัวคูณ OT วันทำงานปกติ (ก่อน/หลังเวลางาน) */
  officeWeekdayOvertimeMultiplier?: number;
  /** C — ตัวคูณ OT ในวันหยุดนักขัตฤกษ์/วันอาทิตย์ */
  officeHolidayOvertimeMultiplier?: number;
  /** @deprecated ใช้ {@link officeWeekdayOvertimeMultiplier} — เก็บเพื่อ backward compat */
  officeOvertimeHourMultiplier?: number;
  /** @deprecated ใช้ {@link officeHolidayNormalWorkMultiplier} — เก็บเพื่อ backward compat */
  officeHolidayHourMultiplier?: number;
};

export const DEFAULT_MONTHLY_WORK_NORM: MonthlyWorkNormPolicyConfig = {
  standardWorkingDaysPerMonth: 26,
  normalWorkingHoursPerDay: 8,
  breakHoursPerDay: 1,
  workStartTime: '08:00',
  breakStartTime: '12:00',
  lateGraceMinutes: 0,
  latePenaltyBands: DEFAULT_OFFICE_LATE_PENALTY_BANDS,
  officeHolidayNormalWorkMultiplier: 1.0,
  officeWeekdayOvertimeMultiplier: 1.5,
  officeHolidayOvertimeMultiplier: 1.5,
  officeOvertimeHourMultiplier: 1.5,
  officeHolidayHourMultiplier: 1.0,
};

/** ชั่วโมง OT จากช่วงเวลา — หักช่วงพักตามนโยบายเวลางาน */
export function otHoursFromWorkNormHmRange(
  startHm: string,
  endHm: string,
  cfg: MonthlyWorkNormPolicyConfig,
): number | null {
  return otHoursFromHmRange(startHm, endHm, officeShiftMinuteBounds(cfg));
}

/** จำนวนนาทีต่อวันทำงานปกติ — ใช้หารรายวัน → นาที (ไม่รวมพัก) */
export function dailyWorkingMinutes(cfg: MonthlyWorkNormPolicyConfig): number {
  const m = Math.round((Number(cfg.normalWorkingHoursPerDay) || 0) * 60);
  return m > 0 ? m : 480;
}

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
  const breakStart =
    typeof raw.breakStartTime === 'string' && /^(\d{1,2}):(\d{2})$/.test(raw.breakStartTime.trim())
      ? raw.breakStartTime.trim()
      : d.breakStartTime;
  const lateRaw = Number(raw.lateGraceMinutes);
  const lateGrace =
    Number.isFinite(lateRaw) && lateRaw >= 0 ? Math.min(120, Math.round(lateRaw)) : 0;
  const latePenaltyBands = normalizeOfficeLatePenaltyBands(
    raw.latePenaltyBands,
    !Object.prototype.hasOwnProperty.call(raw, 'latePenaltyBands'),
  );
  const clampMult = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(10, Math.round(n * 100) / 100) : fallback;
  };
  const officeHolidayNormalWorkMultiplier = clampMult(
    raw.officeHolidayNormalWorkMultiplier ?? raw.officeHolidayHourMultiplier,
    d.officeHolidayNormalWorkMultiplier ?? 1,
  );
  const officeWeekdayOvertimeMultiplier = clampMult(
    raw.officeWeekdayOvertimeMultiplier ?? raw.officeOvertimeHourMultiplier,
    d.officeWeekdayOvertimeMultiplier ?? 1.5,
  );
  const officeHolidayOvertimeMultiplier = clampMult(
    raw.officeHolidayOvertimeMultiplier ?? raw.officeOvertimeHourMultiplier,
    d.officeHolidayOvertimeMultiplier ?? 1.5,
  );
  return {
    standardWorkingDaysPerMonth: days,
    normalWorkingHoursPerDay: workH,
    breakHoursPerDay: breakH,
    workStartTime: start,
    breakStartTime: breakStart,
    lateGraceMinutes: lateGrace,
    latePenaltyBands,
    officeHolidayNormalWorkMultiplier,
    officeWeekdayOvertimeMultiplier,
    officeHolidayOvertimeMultiplier,
    officeOvertimeHourMultiplier: officeWeekdayOvertimeMultiplier,
    officeHolidayHourMultiplier: officeHolidayNormalWorkMultiplier,
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
  if (cfg.breakStartTime && cfg.breakStartTime.trim()) {
    if (!TIME_RE.test(cfg.breakStartTime.trim())) {
      return 'เวลาเริ่มพักต้องเป็นรูปแบบ HH:mm (เช่น 12:00)';
    }
    const bm = TIME_RE.exec(cfg.breakStartTime.trim())!;
    const bH = Number(bm[1]);
    const bMi = Number(bm[2]);
    if (bH < 0 || bH > 23 || bMi < 0 || bMi > 59) {
      return 'เวลาเริ่มพักไม่ถูกต้อง';
    }
  }
  if (cfg.lateGraceMinutes !== undefined) {
    const lg = Number(cfg.lateGraceMinutes);
    if (!Number.isFinite(lg) || lg < 0 || lg > 120) {
      return 'เวลาผ่อนผันสาย (นาที) ต้องอยู่ระหว่าง 0–120';
    }
  }
  const bands = normalizeOfficeLatePenaltyBands(cfg.latePenaltyBands, false);
  if (cfg.latePenaltyBands !== undefined && Array.isArray(cfg.latePenaltyBands) && bands.length !== cfg.latePenaltyBands.length) {
    return 'ช่วงหักสายไม่ถูกต้อง — ตรวจสอบเวลาเริ่ม–สิ้นสุดและนาทีที่หัก';
  }
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.toAfterStartMinutes < b.fromAfterStartMinutes) {
      return 'ช่วงหักสาย: เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม';
    }
    if (b.deductMinutes < 1) {
      return 'นาทีที่หักในแต่ละช่วงต้องอย่างน้อย 1';
    }
    if (i > 0 && b.fromAfterStartMinutes <= bands[i - 1].toAfterStartMinutes) {
      return 'ช่วงหักสายซ้อนกัน — จัดช่วงไม่ให้ทับกัน';
    }
  }
  return null;
}

/** แปลง HH:mm → จำนวนนาทีนับจากเที่ยงคืน (หรือ null ถ้าผิด) */
function parseHmm(s: string | undefined | null): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = TIME_RE.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function fmtHmm(totalMin: number): string {
  const wraps = Math.floor(totalMin / (24 * 60));
  const rem = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(rem / 60);
  const mi = rem % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  const time = `${pad(h)}:${pad(mi)}`;
  return wraps > 0 ? `${time} (+${wraps} วัน)` : time;
}

function clampBandInt(n: unknown, min: number, max: number): number | null {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < min || v > max) return null;
  return v;
}

/** อ่านช่วงหักสาย — ถ้าไม่มีฟิลด์ใน config ใช้ค่าตามประกาศ; อาร์เรย์ว่าง = ไม่ใช้ช่วง */
export function normalizeOfficeLatePenaltyBands(
  raw: unknown,
  missingMeansDefault = true,
): OfficeLatePenaltyBand[] {
  if (raw === undefined || raw === null) {
    return missingMeansDefault ? DEFAULT_OFFICE_LATE_PENALTY_BANDS.map((b) => ({ ...b })) : [];
  }
  if (!Array.isArray(raw)) {
    return missingMeansDefault ? DEFAULT_OFFICE_LATE_PENALTY_BANDS.map((b) => ({ ...b })) : [];
  }
  const out: OfficeLatePenaltyBand[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const fromAfterStartMinutes = clampBandInt(r.fromAfterStartMinutes, 0, 12 * 60);
    const toAfterStartMinutes = clampBandInt(r.toAfterStartMinutes, 0, 12 * 60);
    const deductMinutes = clampBandInt(r.deductMinutes, 1, 8 * 60);
    if (fromAfterStartMinutes === null || toAfterStartMinutes === null || deductMinutes === null) continue;
    if (toAfterStartMinutes < fromAfterStartMinutes) continue;
    out.push({ fromAfterStartMinutes, toAfterStartMinutes, deductMinutes });
  }
  return out.sort((a, b) => a.fromAfterStartMinutes - b.fromAfterStartMinutes);
}

/** นาทีหักสายจากนาทีหลังเริ่มกะ — ช่วงประกาศทับนาทีจริง; นอกช่วงสุดท้ายใช้นาทีที่สายจริง */
export function latePenaltyMinutesFromMinutesAfterStart(
  minutesAfterShiftStart: number,
  cfg: Pick<MonthlyWorkNormPolicyConfig, 'lateGraceMinutes' | 'latePenaltyBands'>,
): number {
  const m = Math.max(0, Math.round(Number(minutesAfterShiftStart) || 0));
  const grace = Math.max(0, Math.round(cfg.lateGraceMinutes ?? 0));
  if (m <= grace) return 0;
  const bands = normalizeOfficeLatePenaltyBands(cfg.latePenaltyBands, false);
  if (!bands.length) return Math.max(0, m - grace);
  const hit = bands.find((b) => m >= b.fromAfterStartMinutes && m <= b.toAfterStartMinutes);
  if (hit) return hit.deductMinutes;
  return m;
}

export function hmmAddMinutes(hmm: string, addMinutes: number): string {
  const start = parseHmm(hmm);
  if (start === null) return '—';
  const total = start + Math.round(addMinutes);
  const rem = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(rem / 60);
  const mi = rem % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function minutesAfterWorkStartFromHmm(workStartHmm: string, clockHmm: string): number | null {
  const start = parseHmm(workStartHmm);
  const clock = parseHmm(clockHmm);
  if (start === null || clock === null) return null;
  let d = clock - start;
  if (d < 0) d += 24 * 60;
  return d;
}

/** จุดเวลาเป็นหน่วยนาทีจากเที่ยงคืน — ใช้คำนวณ payroll / สาย / ขาดงาน */
export type OfficeShiftMinuteBounds = {
  workStartMin: number;
  /** จบช่วงเช้า (= เริ่มพัก) — สายเข้าหลังจุดนี้ถือขาดครึ่งวัน */
  morningEndMin: number;
  /** จบพัก (= เริ่มบ่าย) */
  afternoonStartMin: number;
  /** เลิกงาน — สายเข้าหลังจุดนี้ถือขาดทั้งวัน */
  afternoonEndMin: number;
  /** เริ่มนับสายช่วงเช้า */
  morningLateCutoffMin: number;
  /** เริ่มนับสายช่วงบ่าย */
  afternoonLateCutoffMin: number;
};

export function officeShiftMinuteBounds(cfg: MonthlyWorkNormPolicyConfig): OfficeShiftMinuteBounds | null {
  const startMin = parseHmm(cfg.workStartTime);
  if (startMin === null) return null;
  const workMin = Math.max(0, Math.round(cfg.normalWorkingHoursPerDay * 60));
  const breakMin = Math.max(0, Math.round(cfg.breakHoursPerDay * 60));
  const explicitBreakStart = parseHmm(cfg.breakStartTime);
  const morningEndMin =
    explicitBreakStart !== null ? explicitBreakStart : startMin + Math.round(workMin / 2);
  const breakEndMin = morningEndMin + breakMin;
  const morningWorked = Math.max(0, morningEndMin - startMin);
  const afternoonWorked = Math.max(0, workMin - morningWorked);
  const afternoonEndMin = breakEndMin + afternoonWorked;
  const grace = Math.max(0, Math.round(cfg.lateGraceMinutes ?? 0));
  return {
    workStartMin: startMin,
    morningEndMin,
    afternoonStartMin: breakEndMin,
    afternoonEndMin,
    morningLateCutoffMin: startMin + grace,
    afternoonLateCutoffMin: breakEndMin + grace,
  };
}

/**
 * ผลจากเวลาเข้างานที่ใช้แล้ว (รวมแก้ไขเวลาที่อนุมัติ) — นาทีจากเที่ยงคืน วันเดียวกับปฏิทินทำงาน
 *
 * - เข้าหลังจบช่วงเช้า → ขาดครึ่งวัน + นาทีสายช่วงบ่าย (ถ้ามี)
 * - เข้าหลังเลิกงาน → ขาดทั้งวัน
 * - อยู่ในช่วงเช้า/บ่ายแต่เกินนาทีผ่อนผัน → นับนาทีสายตามช่วง
 *
 * หมายเหตุ: ไม่มีเวลาเข้า (null) ให้ผู้เรียกตัดสินเรื่องขาดงาน/ไม่สแกน — ฟังก์ชันนี้คืน 0
 */
export type OfficeScanInEvaluation = {
  absenceDayFraction: number;
  lateMinutes: number;
};

/** ช่วงที่พนักงานต้องมาทำงานจริง (หลังหักลาครึ่งวัน) */
export type OfficePayrollWorkingHalf = 'FULL' | 'MORNING' | 'AFTERNOON';

export function evaluateOfficeScanInForPayroll(
  effectiveInMinutesFromMidnight: number | null,
  cfg: MonthlyWorkNormPolicyConfig,
): OfficeScanInEvaluation {
  return evaluateOfficeScanInForPayrollHalf(effectiveInMinutesFromMidnight, cfg, 'FULL');
}

/**
 * ประเมินสาย/ขาดจากเวลาเข้า — รองรับลาครึ่งวัน (ทำงานเฉพาะเช้าหรือบ่าย)
 */
export function evaluateOfficeScanInForPayrollHalf(
  effectiveInMinutesFromMidnight: number | null,
  cfg: MonthlyWorkNormPolicyConfig,
  workingHalf: OfficePayrollWorkingHalf,
): OfficeScanInEvaluation {
  if (effectiveInMinutesFromMidnight === null) return { absenceDayFraction: 0, lateMinutes: 0 };
  const b = officeShiftMinuteBounds(cfg);
  if (!b) return { absenceDayFraction: 0, lateMinutes: 0 };
  const t = effectiveInMinutesFromMidnight;

  if (workingHalf === 'AFTERNOON') {
    if (t > b.afternoonEndMin) return { absenceDayFraction: 0.5, lateMinutes: 0 };
    if (t < b.afternoonStartMin) return { absenceDayFraction: 0, lateMinutes: 0 };
    return {
      absenceDayFraction: 0,
      lateMinutes: latePenaltyMinutesFromMinutesAfterStart(t - b.afternoonStartMin, cfg),
    };
  }

  if (workingHalf === 'MORNING') {
    if (t > b.morningEndMin) return { absenceDayFraction: 0.5, lateMinutes: 0 };
    return {
      absenceDayFraction: 0,
      lateMinutes: latePenaltyMinutesFromMinutesAfterStart(t - b.workStartMin, cfg),
    };
  }

  if (t > b.afternoonEndMin) {
    return { absenceDayFraction: 1, lateMinutes: 0 };
  }
  if (t > b.morningEndMin) {
    return {
      absenceDayFraction: 0.5,
      lateMinutes: latePenaltyMinutesFromMinutesAfterStart(t - b.afternoonStartMin, cfg),
    };
  }
  return {
    absenceDayFraction: 0,
    lateMinutes: latePenaltyMinutesFromMinutesAfterStart(t - b.workStartMin, cfg),
  };
}

/**
 * คำนวณช่วงทำงานเป็นข้อความ — ใช้ `breakStartTime` ถ้ากำหนด ไม่งั้นเดาจาก
 * ครึ่งกะเช้า (workStart + half normalWorkingHoursPerDay)
 * คืนค่า morningStart, morningEnd (= breakStart), breakEnd (= afternoonStart),
 * afternoonEnd (= เลิกงาน)
 */
export interface ShiftWindowsLabels {
  morningStart: string;
  morningEnd: string;
  breakEnd: string;
  afternoonEnd: string;
  /** เวลาเริ่มคิดสายช่วงเช้า (= เริ่มงาน + ผ่อนผัน) */
  morningLateCutoff: string;
  /** เวลาเริ่มคิดสายช่วงบ่าย (= เริ่มบ่าย + ผ่อนผัน) */
  afternoonLateCutoff: string;
}

export function computeShiftWindowsLabels(cfg: MonthlyWorkNormPolicyConfig): ShiftWindowsLabels | null {
  const b = officeShiftMinuteBounds(cfg);
  if (!b) return null;
  return {
    morningStart: fmtHmm(b.workStartMin),
    morningEnd: fmtHmm(b.morningEndMin),
    breakEnd: fmtHmm(b.afternoonStartMin),
    afternoonEnd: fmtHmm(b.afternoonEndMin),
    morningLateCutoff: fmtHmm(b.morningLateCutoffMin),
    afternoonLateCutoff: fmtHmm(b.afternoonLateCutoffMin),
  };
}

/** ฐานหักรายวัน/รายนาที สำหรับใช้ในสลิปเงินเดือน */
export interface AbsenceLatePayrollRates {
  /** เงินเดือน ÷ standardWorkingDaysPerMonth */
  perDay: number;
  /** perDay ÷ dailyWorkingMinutes (ปกติ 480 ถ้าทำงาน 8 ชม.) */
  perMinute: number;
  dailyMinutes: number;
}

export function absenceLatePayrollRates(
  monthlySalary: number,
  cfg: MonthlyWorkNormPolicyConfig,
): AbsenceLatePayrollRates {
  const days = Math.max(1, Math.round(cfg.standardWorkingDaysPerMonth) || 26);
  const dailyMinutes = dailyWorkingMinutes(cfg);
  const salary = Math.max(0, Number(monthlySalary) || 0);
  const perDay = salary / days;
  const perMinute = perDay / dailyMinutes;
  return { perDay, perMinute, dailyMinutes };
}
