import type {
  DailyTimesheet,
  MobDayChargeKind,
  MobDayChargeSpec,
  RateConditionEventType,
} from '@/lib/types';

export type MobStep2Choice = 'PRE_MOB' | 'MOB';

/** ค่ามาตรฐานตามที่ลูกค้าใช้บ่อย: Pre-Mob = SB 8 ชม. · Mob = M1 */
export function defaultMobDayCharges(choice: MobStep2Choice): {
  billing: MobDayChargeSpec;
  payroll: MobDayChargeSpec;
} {
  if (choice === 'PRE_MOB') {
    return {
      billing: { kind: 'STANDBY', hours: 8 },
      payroll: { kind: 'STANDBY', hours: 8 },
    };
  }
  return {
    billing: { kind: 'M1' },
    payroll: { kind: 'M1' },
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
  return '—';
}

export function normalizeMobDayChargeSpec(raw: MobDayChargeSpec | null | undefined): MobDayChargeSpec {
  const kind: MobDayChargeKind =
    raw?.kind === 'WORKING' || raw?.kind === 'M1' || raw?.kind === 'STANDBY' ? raw.kind : 'STANDBY';
  if (kind === 'M1') {
    const override = Number(raw?.m1AmountOverride);
    return {
      kind: 'M1',
      ...(Number.isFinite(override) && override > 0 ? { m1AmountOverride: Math.round(override * 100) / 100 } : {}),
    };
  }
  const hours = Number(raw?.hours);
  const h = Number.isFinite(hours) && hours > 0 ? Math.min(24, hours) : 8;
  return { kind, hours: h };
}

export function mobDayChargeKindToEventType(kind: MobDayChargeKind): RateConditionEventType {
  if (kind === 'WORKING') return 'work_day';
  if (kind === 'M1') return 'mobilization_day';
  return 'standby_day';
}

/** รหัสบนกระดาน — SB / W / MO */
export function mobDayChargeStatusCode(kind: MobDayChargeKind | string | undefined | null): 'SB' | 'W' | 'MO' | null {
  if (kind === 'STANDBY') return 'SB';
  if (kind === 'WORKING') return 'W';
  if (kind === 'M1') return 'MO';
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
  if (n.kind === 'M1') {
    if (n.m1AmountOverride != null && n.m1AmountOverride > 0) {
      return `M1 · ${n.m1AmountOverride.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
    }
    return 'M1 (ตามตารางสัญญา)';
  }
  return `${n.kind === 'WORKING' ? 'W' : 'SB'} ${n.hours ?? 8} ชม.`;
}

/** อ่านค่าคิดเงินฝั่งวางบิลจาก timesheet (fallback = eventType หลัก) */
export function resolveTimesheetBillingCharge(
  ts: Pick<
    DailyTimesheet,
    'eventType' | 'normalHours' | 'mobBillingChargeKind' | 'mobBillingChargeHours' | 'mobBillingM1AmountOverride'
  >,
): MobDayChargeSpec {
  if (ts.mobBillingChargeKind) {
    return normalizeMobDayChargeSpec({
      kind: ts.mobBillingChargeKind,
      hours: ts.mobBillingChargeHours,
      m1AmountOverride: ts.mobBillingM1AmountOverride,
    });
  }
  if (ts.eventType === 'mobilization_day') return { kind: 'M1' };
  if (ts.eventType === 'work_day') {
    const h = Number(ts.normalHours);
    return { kind: 'WORKING', hours: Number.isFinite(h) && h > 0 ? h : 8 };
  }
  if (ts.eventType === 'standby_day') {
    const h = Number(ts.normalHours);
    return { kind: 'STANDBY', hours: Number.isFinite(h) && h > 0 ? h : 8 };
  }
  return { kind: 'STANDBY', hours: 8 };
}

/** อ่านค่าคิดเงินฝั่ง payroll จาก timesheet */
export function resolveTimesheetPayrollCharge(
  ts: Pick<
    DailyTimesheet,
    'eventType' | 'normalHours' | 'mobPayrollChargeKind' | 'mobPayrollChargeHours' | 'mobPayrollM1AmountOverride'
  >,
): MobDayChargeSpec {
  if (ts.mobPayrollChargeKind) {
    return normalizeMobDayChargeSpec({
      kind: ts.mobPayrollChargeKind,
      hours: ts.mobPayrollChargeHours,
      m1AmountOverride: ts.mobPayrollM1AmountOverride,
    });
  }
  if (ts.eventType === 'mobilization_day') return { kind: 'M1' };
  if (ts.eventType === 'work_day') {
    const h = Number(ts.normalHours);
    return { kind: 'WORKING', hours: Number.isFinite(h) && h > 0 ? h : 8 };
  }
  if (ts.eventType === 'standby_day') {
    const h = Number(ts.normalHours);
    return { kind: 'STANDBY', hours: Number.isFinite(h) && h > 0 ? h : 8 };
  }
  return { kind: 'STANDBY', hours: 8 };
}

/** แปลง charge → ฟิลด์ที่เขียนลง daily_timesheets */
export function buildTimesheetFieldsFromMobCharges(
  billing: MobDayChargeSpec,
  payroll: MobDayChargeSpec,
): Partial<DailyTimesheet> & {
  eventType: RateConditionEventType;
  normalHours: number;
} {
  const b = normalizeMobDayChargeSpec(billing);
  const p = normalizeMobDayChargeSpec(payroll);
  const eventType = mobDayChargeKindToEventType(b.kind);
  const normalHours =
    b.kind === 'M1' ? 0 : Math.max(0, Math.min(24, Number(b.hours ?? 8)));

  const fields: Partial<DailyTimesheet> & {
    eventType: RateConditionEventType;
    normalHours: number;
  } = {
    eventType,
    normalHours,
    mobBillingChargeKind: b.kind,
    mobPayrollChargeKind: p.kind,
  };

  if (b.kind === 'STANDBY') {
    fields.standbyUnits = 1;
    fields.mobUnits = 0;
  } else if (b.kind === 'WORKING') {
    fields.standbyUnits = 0;
    fields.mobUnits = 0;
  } else {
    fields.standbyUnits = 0;
    fields.mobUnits = 1;
  }

  if (b.kind !== 'M1') fields.mobBillingChargeHours = b.hours ?? 8;
  if (b.kind === 'M1' && b.m1AmountOverride != null && b.m1AmountOverride > 0) {
    fields.mobBillingM1AmountOverride = b.m1AmountOverride;
  }

  if (p.kind !== 'M1') fields.mobPayrollChargeHours = p.hours ?? 8;
  if (p.kind === 'M1' && p.m1AmountOverride != null && p.m1AmountOverride > 0) {
    fields.mobPayrollM1AmountOverride = p.m1AmountOverride;
  }

  return fields;
}
