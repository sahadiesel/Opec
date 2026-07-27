import type {
  DailyTimesheet,
  JobMode,
  MobDayChargeKind,
  MobDayChargeSpec,
  RateConditionEventType,
} from '@/lib/types';
import {
  DEFAULT_NORMAL_WORK_HOURS_OFFSHORE,
  DEFAULT_NORMAL_WORK_HOURS_ONSHORE,
} from '@/lib/commercial/position-rate-sell';

export type MobStep2Choice = 'PRE_MOB' | 'MOB';

/** ฐานชม.แพ็กตามโหมดงาน — Offshore 12 · Onshore 8 (อ้างอิงราคาในสัญญา) */
export function defaultPackageHoursForWorkMode(
  workMode: JobMode | string | null | undefined,
): 8 | 12 {
  const m = String(workMode || '').toUpperCase();
  if (m === 'ONSHORE' || m === 'ON') return DEFAULT_NORMAL_WORK_HOURS_ONSHORE;
  return DEFAULT_NORMAL_WORK_HOURS_OFFSHORE;
}

/**
 * ค่ามาตรฐาน: Pre-Mob = SB 8 ชม.
 * Mob = M1 พร้อมชม.อ้างอิงแพ็ก (OFF 12 / ON 8) — โชว์บนรายวันและใช้สัดส่วนเมื่อคิด SB
 */
export function defaultMobDayCharges(
  choice: MobStep2Choice,
  workMode?: JobMode | string | null,
): {
  billing: MobDayChargeSpec;
  payroll: MobDayChargeSpec;
} {
  if (choice === 'PRE_MOB') {
    return {
      billing: { kind: 'STANDBY', hours: 8 },
      payroll: { kind: 'STANDBY', hours: 8 },
    };
  }
  const packageHours = defaultPackageHoursForWorkMode(workMode);
  return {
    billing: { kind: 'M1', hours: packageHours },
    payroll: { kind: 'M1', hours: packageHours },
  };
}

/** ค่ามาตรฐานตอนจบงานเป็น D1 — วางบิล/จ่าย = D1 ตามชม.แพ็ก */
export function defaultDemobDayCharges(workMode?: JobMode | string | null): {
  billing: MobDayChargeSpec;
  payroll: MobDayChargeSpec;
} {
  const packageHours = defaultPackageHoursForWorkMode(workMode);
  return {
    billing: { kind: 'D1', hours: packageHours },
    payroll: { kind: 'D1', hours: packageHours },
  };
}

export function mobStep2ChoiceLabel(choice: MobStep2Choice | string | undefined | null): string {
  if (choice === 'PRE_MOB') return 'Pre-Mob';
  if (choice === 'MOB') return 'Mob';
  return '—';
}

export function mobDayChargeKindLabel(kind: MobDayChargeKind | string | undefined | null): string {
  if (kind === 'STANDBY') return 'Standby (SB)';
  if (kind === 'WORKING') return 'Working (W)';
  if (kind === 'M1') return 'Mob / M1';
  if (kind === 'D1') return 'Demob / D1';
  return '—';
}

export function normalizeMobDayChargeSpec(
  raw: MobDayChargeSpec | null | undefined,
  packageHoursDefault: 8 | 12 = DEFAULT_NORMAL_WORK_HOURS_OFFSHORE,
): MobDayChargeSpec {
  const kind: MobDayChargeKind =
    raw?.kind === 'WORKING' ||
    raw?.kind === 'M1' ||
    raw?.kind === 'D1' ||
    raw?.kind === 'STANDBY'
      ? raw.kind
      : 'STANDBY';
  const hoursRaw = Number(raw?.hours);
  const hours =
    Number.isFinite(hoursRaw) && hoursRaw > 0
      ? Math.min(24, hoursRaw)
      : packageHoursDefault;

  if (kind === 'M1' || kind === 'D1') {
    const override = Number(raw?.m1AmountOverride);
    return {
      kind,
      hours,
      ...(Number.isFinite(override) && override > 0
        ? { m1AmountOverride: Math.round(override * 100) / 100 }
        : {}),
    };
  }
  return { kind, hours };
}

export function mobDayChargeKindToEventType(kind: MobDayChargeKind): RateConditionEventType {
  if (kind === 'WORKING') return 'work_day';
  if (kind === 'M1') return 'mobilization_day';
  if (kind === 'D1') return 'demobilization_day';
  return 'standby_day';
}

/** รหัสบนกระดาน — SB / W / MO / D1 */
export function mobDayChargeStatusCode(
  kind: MobDayChargeKind | string | undefined | null,
): 'SB' | 'W' | 'MO' | 'D1' | null {
  if (kind === 'STANDBY') return 'SB';
  if (kind === 'WORKING') return 'W';
  if (kind === 'M1') return 'MO';
  if (kind === 'D1') return 'D1';
  return null;
}

/** ทางเลือก Pre-Mob/Mob → eventType เดิมบน assignment (SB / MO) */
export function mobStep2ChoiceToLegacyEventType(
  choice: MobStep2Choice,
): 'standby_day' | 'mobilization_day' {
  return choice === 'MOB' ? 'mobilization_day' : 'standby_day';
}

export function formatMobDayChargeSummary(spec: MobDayChargeSpec | null | undefined): string {
  const n = normalizeMobDayChargeSpec(spec);
  if (n.kind === 'M1' || n.kind === 'D1') {
    const hrs = n.hours ?? DEFAULT_NORMAL_WORK_HOURS_OFFSHORE;
    const label = n.kind === 'D1' ? 'D1' : 'M1';
    if (n.m1AmountOverride != null && n.m1AmountOverride > 0) {
      return `${label} · ${hrs} ชม. · ${n.m1AmountOverride.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
    }
    return `${label} · ${hrs} ชม. (ตามตารางสัญญา)`;
  }
  return `${n.kind === 'WORKING' ? 'W' : 'SB'} ${n.hours ?? 8} ชม.`;
}

/** อ่านค่าคิดเงินฝั่งวางบิลจาก timesheet (fallback = eventType หลัก) */
export function resolveTimesheetBillingCharge(
  ts: Pick<
    DailyTimesheet,
    | 'eventType'
    | 'normalHours'
    | 'workMode'
    | 'mobBillingChargeKind'
    | 'mobBillingChargeHours'
    | 'mobBillingM1AmountOverride'
  >,
): MobDayChargeSpec {
  const pkg = defaultPackageHoursForWorkMode(ts.workMode);
  if (ts.mobBillingChargeKind) {
    return normalizeMobDayChargeSpec(
      {
        kind: ts.mobBillingChargeKind,
        hours: ts.mobBillingChargeHours ?? ts.normalHours,
        m1AmountOverride: ts.mobBillingM1AmountOverride,
      },
      pkg,
    );
  }
  if (ts.eventType === 'mobilization_day') {
    const h = Number(ts.normalHours);
    return { kind: 'M1', hours: Number.isFinite(h) && h > 0 ? h : pkg };
  }
  if (ts.eventType === 'demobilization_day') {
    const h = Number(ts.normalHours);
    return { kind: 'D1', hours: Number.isFinite(h) && h > 0 ? h : pkg };
  }
  if (ts.eventType === 'work_day') {
    const h = Number(ts.normalHours);
    return { kind: 'WORKING', hours: Number.isFinite(h) && h > 0 ? h : pkg };
  }
  if (ts.eventType === 'standby_day') {
    const h = Number(ts.normalHours);
    return { kind: 'STANDBY', hours: Number.isFinite(h) && h > 0 ? h : pkg };
  }
  return { kind: 'STANDBY', hours: pkg };
}

/** อ่านค่าคิดเงินฝั่ง payroll จาก timesheet */
export function resolveTimesheetPayrollCharge(
  ts: Pick<
    DailyTimesheet,
    | 'eventType'
    | 'normalHours'
    | 'workMode'
    | 'mobPayrollChargeKind'
    | 'mobPayrollChargeHours'
    | 'mobPayrollM1AmountOverride'
  >,
): MobDayChargeSpec {
  const pkg = defaultPackageHoursForWorkMode(ts.workMode);
  if (ts.mobPayrollChargeKind) {
    return normalizeMobDayChargeSpec(
      {
        kind: ts.mobPayrollChargeKind,
        hours: ts.mobPayrollChargeHours ?? ts.normalHours,
        m1AmountOverride: ts.mobPayrollM1AmountOverride,
      },
      pkg,
    );
  }
  if (ts.eventType === 'mobilization_day') {
    const h = Number(ts.normalHours);
    return { kind: 'M1', hours: Number.isFinite(h) && h > 0 ? h : pkg };
  }
  if (ts.eventType === 'demobilization_day') {
    const h = Number(ts.normalHours);
    return { kind: 'D1', hours: Number.isFinite(h) && h > 0 ? h : pkg };
  }
  if (ts.eventType === 'work_day') {
    const h = Number(ts.normalHours);
    return { kind: 'WORKING', hours: Number.isFinite(h) && h > 0 ? h : pkg };
  }
  if (ts.eventType === 'standby_day') {
    const h = Number(ts.normalHours);
    return { kind: 'STANDBY', hours: Number.isFinite(h) && h > 0 ? h : pkg };
  }
  return { kind: 'STANDBY', hours: pkg };
}

/**
 * แปลง charge → ฟิลด์ที่เขียนลง daily_timesheets
 * M1/D1 เก็บชม.อ้างอิงแพ็ก (ไม่เป็น 0) — ใช้โชว์รายวันและสัดส่วน SB
 */
export function buildTimesheetFieldsFromMobCharges(
  billing: MobDayChargeSpec,
  payroll: MobDayChargeSpec,
  packageHoursDefault: 8 | 12 = DEFAULT_NORMAL_WORK_HOURS_OFFSHORE,
): Partial<DailyTimesheet> & {
  eventType: RateConditionEventType;
  normalHours: number;
} {
  const b = normalizeMobDayChargeSpec(billing, packageHoursDefault);
  const p = normalizeMobDayChargeSpec(payroll, packageHoursDefault);
  const eventType = mobDayChargeKindToEventType(b.kind);
  /** ชม.หลักบนใบ — ใช้ฝั่งจ่ายเมื่อเป็น SB/W (อาจคนละชม.กับบิล) */
  const normalHoursSource =
    p.kind === 'STANDBY' || p.kind === 'WORKING'
      ? p
      : b.kind === 'STANDBY' || b.kind === 'WORKING'
        ? b
        : p.hours != null
          ? p
          : b;
  const normalHours = Math.max(
    0,
    Math.min(24, Number(normalHoursSource.hours ?? packageHoursDefault)),
  );

  const fields: Partial<DailyTimesheet> & {
    eventType: RateConditionEventType;
    normalHours: number;
  } = {
    eventType,
    normalHours,
    mobBillingChargeKind: b.kind,
    mobPayrollChargeKind: p.kind,
    mobBillingChargeHours: b.hours ?? packageHoursDefault,
    mobPayrollChargeHours: p.hours ?? packageHoursDefault,
  };

  if (b.kind === 'STANDBY') {
    fields.standbyUnits = 1;
    fields.mobUnits = 0;
    fields.demobUnits = 0;
  } else if (b.kind === 'WORKING') {
    fields.standbyUnits = 0;
    fields.mobUnits = 0;
    fields.demobUnits = 0;
  } else if (b.kind === 'D1') {
    fields.standbyUnits = 0;
    fields.mobUnits = 0;
    fields.demobUnits = 1;
  } else {
    fields.standbyUnits = 0;
    fields.mobUnits = 1;
    fields.demobUnits = 0;
  }

  if ((b.kind === 'M1' || b.kind === 'D1') && b.m1AmountOverride != null && b.m1AmountOverride > 0) {
    fields.mobBillingM1AmountOverride = b.m1AmountOverride;
  }

  if ((p.kind === 'M1' || p.kind === 'D1') && p.m1AmountOverride != null && p.m1AmountOverride > 0) {
    fields.mobPayrollM1AmountOverride = p.m1AmountOverride;
  }

  return fields;
}
