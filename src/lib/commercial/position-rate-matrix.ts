import type {
  ContractMobDemobLocation,
  JobMode,
  MainContract,
  Position,
  PositionRate,
  PositionRateMatrix,
  PositionRateMatrixCategory,
  PositionRateOffshoreSide,
  PositionRateOnshoreSide,
  PositionRateWorkModeBundle,
} from '@/lib/types';
import { legacySellRateMirror, effectiveSellOnshore, effectiveSellOffshore } from '@/lib/commercial/position-rate-sell';

/** Default mob/demob columns (Thai Nippon rate sheet). */
export const DEFAULT_MOB_DEMOB_LOCATIONS: ContractMobDemobLocation[] = [
  { key: 'songkhla', label: 'Mob/Demob @ Songkhla', displayOrder: 1 },
  { key: 'tns_bangpakong', label: 'Mob/Demob @ TNS Bangpakong Yard', displayOrder: 2 },
  { key: 'sattahip_utapao', label: 'Mob/Demob @ Sattahip / U-Tapao', displayOrder: 3 },
];

function parsePositive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function sanitizeMobDemobRoundTrip(
  record: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!record) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(record)) {
    const key = k.trim();
    const n = parsePositive(v);
    if (key && n != null) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeOffshoreSide(side: PositionRateOffshoreSide | undefined): PositionRateOffshoreSide | undefined {
  if (!side) return undefined;
  const out: PositionRateOffshoreSide = {};
  const workingDay = parsePositive(side.workingDay);
  const standbyDay = parsePositive(side.standbyDay);
  const otPerHour = parsePositive(side.otPerHour);
  const m1PerTrip = parsePositive(side.m1PerTrip);
  const d1PerTrip = parsePositive(side.d1PerTrip);
  const mobDemobRoundTrip = sanitizeMobDemobRoundTrip(side.mobDemobRoundTrip);
  if (workingDay != null) out.workingDay = workingDay;
  if (standbyDay != null) out.standbyDay = standbyDay;
  if (otPerHour != null) out.otPerHour = otPerHour;
  if (m1PerTrip != null) out.m1PerTrip = m1PerTrip;
  if (d1PerTrip != null) out.d1PerTrip = d1PerTrip;
  if (mobDemobRoundTrip) out.mobDemobRoundTrip = mobDemobRoundTrip;
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeOnshoreSide(side: PositionRateOnshoreSide | undefined): PositionRateOnshoreSide | undefined {
  if (!side) return undefined;
  const out: PositionRateOnshoreSide = {};
  const workingDay = parsePositive(side.workingDay);
  const standbyDay = parsePositive(side.standbyDay);
  const otNormalPerHour = parsePositive(side.otNormalPerHour);
  const ot2PerHour = parsePositive(side.ot2PerHour);
  const ot3PerHour = parsePositive(side.ot3PerHour);
  if (workingDay != null) out.workingDay = workingDay;
  if (standbyDay != null) out.standbyDay = standbyDay;
  if (otNormalPerHour != null) out.otNormalPerHour = otNormalPerHour;
  if (ot2PerHour != null) out.ot2PerHour = ot2PerHour;
  if (ot3PerHour != null) out.ot3PerHour = ot3PerHour;
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeWorkModeBundle(bundle: PositionRateWorkModeBundle | undefined): PositionRateWorkModeBundle | undefined {
  if (!bundle) return undefined;
  const offshore = sanitizeOffshoreSide(bundle.offshore);
  const onshore = sanitizeOnshoreSide(bundle.onshore);
  if (!offshore && !onshore) return undefined;
  return { ...(offshore ? { offshore } : {}), ...(onshore ? { onshore } : {}) };
}

/** Strip empty / invalid values from a rate matrix before Firestore write. */
export function sanitizePositionRateMatrix(matrix: PositionRateMatrix | undefined | null): PositionRateMatrix | undefined {
  if (!matrix) return undefined;
  const sell = sanitizeWorkModeBundle(matrix.sell);
  const cost = sanitizeWorkModeBundle(matrix.cost);
  if (!sell && !cost) return undefined;
  return { ...(sell ? { sell } : {}), ...(cost ? { cost } : {}) };
}

export function createEmptyPositionRateMatrix(): PositionRateMatrix {
  return {
    sell: { offshore: {}, onshore: {} },
    cost: { offshore: {}, onshore: {} },
  };
}

export function hasRateMatrixContent(matrix: PositionRateMatrix | undefined | null): boolean {
  return sanitizePositionRateMatrix(matrix) != null;
}

/** Normalize mob/demob location keys and sort by displayOrder. */
export function sanitizeMobDemobLocations(
  locations: ContractMobDemobLocation[] | undefined | null,
): ContractMobDemobLocation[] | undefined {
  if (!locations?.length) return undefined;
  const out = locations
    .map((loc, i) => ({
      key: (loc.key || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, ''),
      label: (loc.label || '').trim(),
      displayOrder: Number.isFinite(Number(loc.displayOrder)) ? Number(loc.displayOrder) : i + 1,
    }))
    .filter((loc) => loc.key && loc.label);
  if (out.length === 0) return undefined;
  return [...out].sort((a, b) => a.displayOrder - b.displayOrder);
}

export function getEffectiveMobDemobLocations(
  contract: Pick<MainContract, 'mobDemobLocations'> | null | undefined,
): ContractMobDemobLocation[] {
  const sanitized = sanitizeMobDemobLocations(contract?.mobDemobLocations);
  return sanitized && sanitized.length > 0 ? sanitized : DEFAULT_MOB_DEMOB_LOCATIONS;
}

/** Sync legacy sellRateOnshore/Offshore from matrix working-day fields when present. */
export function syncLegacySellRatesFromMatrix(rate: Partial<PositionRate>): Partial<PositionRate> {
  const matrix = rate.rateMatrix;
  const onFromMatrix = parsePositive(matrix?.sell?.onshore?.workingDay);
  const offFromMatrix = parsePositive(matrix?.sell?.offshore?.workingDay);
  const sellRateOnshore = onFromMatrix ?? rate.sellRateOnshore;
  const sellRateOffshore = offFromMatrix ?? rate.sellRateOffshore;
  return {
    ...rate,
    ...(onFromMatrix != null ? { sellRateOnshore: onFromMatrix } : {}),
    ...(offFromMatrix != null ? { sellRateOffshore: offFromMatrix } : {}),
    sellRate: legacySellRateMirror({
      sellRate: rate.sellRate,
      sellRateOnshore,
      sellRateOffshore,
    }),
  };
}

/** Prepare position rate payload fields for Firestore (matrix + legacy sell sync). */
export function preparePositionRateMatrixPayload(
  rate: Partial<PositionRate>,
  options?: { syncLegacySell?: boolean },
): { rateMatrix?: PositionRateMatrix; sellRate?: number; sellRateOnshore?: number; sellRateOffshore?: number } {
  const sanitized = sanitizePositionRateMatrix(rate.rateMatrix);
  const synced = options?.syncLegacySell !== false ? syncLegacySellRatesFromMatrix({ ...rate, rateMatrix: sanitized }) : rate;
  return {
    ...(sanitized ? { rateMatrix: sanitized } : {}),
    ...(synced.sellRate != null ? { sellRate: synced.sellRate } : {}),
    ...(synced.sellRateOnshore != null ? { sellRateOnshore: synced.sellRateOnshore } : {}),
    ...(synced.sellRateOffshore != null ? { sellRateOffshore: synced.sellRateOffshore } : {}),
  };
}

export function resolveMatrixSellRate(
  rate: Pick<PositionRate, 'rateMatrix' | 'sellRateOnshore' | 'sellRateOffshore' | 'sellRate'>,
  category: PositionRateMatrixCategory,
  options?: { mobLocationKey?: string; workMode?: JobMode },
): number | null {
  const matrix = rate.rateMatrix?.sell;
  const mobKey = (options?.mobLocationKey || '').trim();

  switch (category) {
    case 'offshore_working_day':
      return parsePositive(matrix?.offshore?.workingDay) ?? null;
    case 'offshore_standby_day':
      return parsePositive(matrix?.offshore?.standbyDay) ?? null;
    case 'offshore_ot_per_hour':
      return parsePositive(matrix?.offshore?.otPerHour) ?? null;
    case 'offshore_m1_per_trip':
      return parsePositive(matrix?.offshore?.m1PerTrip) ?? null;
    case 'offshore_d1_per_trip':
      return parsePositive(matrix?.offshore?.d1PerTrip) ?? null;
    case 'offshore_mob_demob_round_trip':
      if (!mobKey) return null;
      return parsePositive(matrix?.offshore?.mobDemobRoundTrip?.[mobKey]) ?? null;
    case 'onshore_working_day':
      return parsePositive(matrix?.onshore?.workingDay) ?? null;
    case 'onshore_standby_day':
      return parsePositive(matrix?.onshore?.standbyDay) ?? null;
    case 'onshore_ot_normal_per_hour':
      return parsePositive(matrix?.onshore?.otNormalPerHour) ?? null;
    case 'onshore_ot2_per_hour':
      return parsePositive(matrix?.onshore?.ot2PerHour) ?? null;
    case 'onshore_ot3_per_hour':
      return parsePositive(matrix?.onshore?.ot3PerHour) ?? null;
    default:
      return null;
  }
}

export function hasSellPricing(rate: Partial<PositionRate>): boolean {
  if (legacySellRateMirror(rate) > 0) return true;
  return (
    parsePositive(rate.rateMatrix?.sell?.onshore?.workingDay) != null ||
    parsePositive(rate.rateMatrix?.sell?.offshore?.workingDay) != null
  );
}

export function resolveMatrixCostRate(
  rate: Pick<PositionRate, 'rateMatrix'>,
  category: PositionRateMatrixCategory,
  options?: { mobLocationKey?: string },
): number | null {
  const matrix = rate.rateMatrix?.cost;
  const mobKey = (options?.mobLocationKey || '').trim();

  switch (category) {
    case 'offshore_working_day':
      return parsePositive(matrix?.offshore?.workingDay) ?? null;
    case 'offshore_standby_day':
      return parsePositive(matrix?.offshore?.standbyDay) ?? null;
    case 'offshore_ot_per_hour':
      return parsePositive(matrix?.offshore?.otPerHour) ?? null;
    case 'offshore_m1_per_trip':
      return parsePositive(matrix?.offshore?.m1PerTrip) ?? null;
    case 'offshore_d1_per_trip':
      return parsePositive(matrix?.offshore?.d1PerTrip) ?? null;
    case 'offshore_mob_demob_round_trip':
      if (!mobKey) return null;
      return parsePositive(matrix?.offshore?.mobDemobRoundTrip?.[mobKey]) ?? null;
    case 'onshore_working_day':
      return parsePositive(matrix?.onshore?.workingDay) ?? null;
    case 'onshore_standby_day':
      return parsePositive(matrix?.onshore?.standbyDay) ?? null;
    case 'onshore_ot_normal_per_hour':
      return parsePositive(matrix?.onshore?.otNormalPerHour) ?? null;
    case 'onshore_ot2_per_hour':
      return parsePositive(matrix?.onshore?.ot2PerHour) ?? null;
    case 'onshore_ot3_per_hour':
      return parsePositive(matrix?.onshore?.ot3PerHour) ?? null;
    default:
      return null;
  }
}

/** Column definition for rate sheet spreadsheet / Excel. */
export type RateSheetSide = 'sell' | 'cost';

export interface RateSheetColumnDef {
  id: string;
  label: string;
  shortLabel: string;
  group: 'offshore' | 'onshore';
  category: PositionRateMatrixCategory;
  mobKey?: string;
  excelKey: string;
}

export function buildRateSheetColumns(
  mobLocations: ContractMobDemobLocation[],
  options?: { includeOffshore?: boolean; includeOnshore?: boolean; includeMob?: boolean },
): RateSheetColumnDef[] {
  const includeOffshore = options?.includeOffshore !== false;
  const includeOnshore = options?.includeOnshore !== false;
  const includeMob = options?.includeMob !== false;
  const cols: RateSheetColumnDef[] = [];

  if (includeOffshore) {
    cols.push(
      { id: 'off_work', label: 'Offshore Working (12 Hr.)', shortLabel: 'OFF Work', group: 'offshore', category: 'offshore_working_day', excelKey: 'offshore_working_day' },
      { id: 'off_sb', label: 'Offshore Standby (per Day)', shortLabel: 'OFF SB', group: 'offshore', category: 'offshore_standby_day', excelKey: 'offshore_standby_day' },
      { id: 'off_ot', label: 'Offshore OT (per Hr.)', shortLabel: 'OFF OT/hr', group: 'offshore', category: 'offshore_ot_per_hour', excelKey: 'offshore_ot_per_hour' },
      { id: 'off_m1', label: 'M1 (per trip)', shortLabel: 'M1', group: 'offshore', category: 'offshore_m1_per_trip', excelKey: 'offshore_m1_per_trip' },
      { id: 'off_d1', label: 'D1 (per trip)', shortLabel: 'D1', group: 'offshore', category: 'offshore_d1_per_trip', excelKey: 'offshore_d1_per_trip' },
    );
    if (includeMob) {
      for (const loc of mobLocations) {
        cols.push({
          id: `mob_${loc.key}`,
          label: loc.label,
          shortLabel: loc.label.replace(/^Mob\/Demob\s*@\s*/i, '').slice(0, 14),
          group: 'offshore',
          category: 'offshore_mob_demob_round_trip',
          mobKey: loc.key,
          excelKey: `mob_demob_${loc.key}`,
        });
      }
    }
  }

  if (includeOnshore) {
    cols.push(
      { id: 'on_work', label: 'Onshore Working (8 Hr.)', shortLabel: 'ON Work', group: 'onshore', category: 'onshore_working_day', excelKey: 'onshore_working_day' },
      { id: 'on_sb', label: 'Onshore Standby (per Day)', shortLabel: 'ON SB', group: 'onshore', category: 'onshore_standby_day', excelKey: 'onshore_standby_day' },
      { id: 'on_ot1', label: 'Onshore OT normal (per Hr.)', shortLabel: 'ON OT', group: 'onshore', category: 'onshore_ot_normal_per_hour', excelKey: 'onshore_ot_normal_per_hour' },
      { id: 'on_ot2', label: 'Onshore OT2 (per Hr.)', shortLabel: 'ON OT2', group: 'onshore', category: 'onshore_ot2_per_hour', excelKey: 'onshore_ot2_per_hour' },
      { id: 'on_ot3', label: 'Onshore OT3 (per Hr.)', shortLabel: 'ON OT3', group: 'onshore', category: 'onshore_ot3_per_hour', excelKey: 'onshore_ot3_per_hour' },
    );
  }

  return cols;
}

export function readRateSheetCell(
  rate: PositionRate,
  side: RateSheetSide,
  col: RateSheetColumnDef,
  context?: {
    contract?: Pick<MainContract, 'laborCostBaselinesByPositionId'>;
    position?: Position | null;
  },
): number | undefined {
  const fromMatrix =
    side === 'sell'
      ? resolveMatrixSellRate(rate, col.category, { mobLocationKey: col.mobKey })
      : resolveMatrixCostRate(rate, col.category, { mobLocationKey: col.mobKey });
  if (fromMatrix != null) return fromMatrix;

  if (side === 'sell') {
    if (col.category === 'onshore_working_day') {
      const v = effectiveSellOnshore(rate);
      return v > 0 ? v : undefined;
    }
    if (col.category === 'offshore_working_day') {
      const v = effectiveSellOffshore(rate);
      return v > 0 ? v : undefined;
    }
  }

  if (side === 'cost' && context?.position) {
    const pid = rate.positionId;
    if (col.category === 'onshore_working_day') {
      const raw = context.contract?.laborCostBaselinesByPositionId?.[pid]?.onshore;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    if (col.category === 'offshore_working_day') {
      const raw = context.contract?.laborCostBaselinesByPositionId?.[pid]?.offshore;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
  }

  return undefined;
}

export function patchRateSheetCell(
  matrix: PositionRateMatrix | undefined,
  side: RateSheetSide,
  col: RateSheetColumnDef,
  value: number | undefined,
): PositionRateMatrix | undefined {
  const base = matrix ?? createEmptyPositionRateMatrix();
  const bundleKey = side;
  const bundle = { ...(base[bundleKey] ?? {}) };
  const modeKey = col.group;
  const modeSide = { ...(bundle[modeKey] ?? {}) };

  const applyScalar = (field: string) => {
    if (value != null && value > 0) (modeSide as Record<string, number>)[field] = value;
    else delete (modeSide as Record<string, unknown>)[field];
  };

  switch (col.category) {
    case 'offshore_working_day':
      applyScalar('workingDay');
      break;
    case 'offshore_standby_day':
      applyScalar('standbyDay');
      break;
    case 'offshore_ot_per_hour':
      applyScalar('otPerHour');
      break;
    case 'offshore_m1_per_trip':
      applyScalar('m1PerTrip');
      break;
    case 'offshore_d1_per_trip':
      applyScalar('d1PerTrip');
      break;
    case 'offshore_mob_demob_round_trip': {
      const key = col.mobKey || '';
      if (!key) break;
      const mob = { ...((modeSide as PositionRateOffshoreSide).mobDemobRoundTrip ?? {}) };
      if (value != null && value > 0) mob[key] = value;
      else delete mob[key];
      if (Object.keys(mob).length > 0) (modeSide as PositionRateOffshoreSide).mobDemobRoundTrip = mob;
      else delete (modeSide as PositionRateOffshoreSide).mobDemobRoundTrip;
      break;
    }
    case 'onshore_working_day':
      applyScalar('workingDay');
      break;
    case 'onshore_standby_day':
      applyScalar('standbyDay');
      break;
    case 'onshore_ot_normal_per_hour':
      applyScalar('otNormalPerHour');
      break;
    case 'onshore_ot2_per_hour':
      applyScalar('ot2PerHour');
      break;
    case 'onshore_ot3_per_hour':
      applyScalar('ot3PerHour');
      break;
    default:
      break;
  }

  bundle[modeKey] = modeSide;
  return sanitizePositionRateMatrix({ ...base, [bundleKey]: bundle });
}

export function parseRateSheetNumber(raw: string): number | undefined {
  const t = raw.trim();
  if (!t || /^no\s*quote$/i.test(t) || t === '—' || t === '-') return undefined;
  const n = parseFloat(t.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function autoCalculateMatrixFields(
  side: 'onshore' | 'offshore',
  workingDay: number | undefined,
  normalHours: number, // 8 or 12
  currentSideData: any = {},
  m1Multiplier?: number,
  d1Multiplier?: number,
): any {
  if (workingDay === undefined || workingDay === null || isNaN(workingDay)) {
    return {
      ...currentSideData,
      workingDay: undefined,
    };
  }

  // 1. Calculate Standby / วัน (50% of Working Day rate)
  const standbyDay = Math.round((workingDay * 0.5) * 100) / 100;

  // 2. Calculate Hourly Rate (R) and OT Rates
  let hourlyRate = 0;
  if (side === 'offshore') {
    const divisor = normalHours === 12 ? 14 : 8;
    hourlyRate = workingDay / divisor;
    
    const otPerHour = Math.round((hourlyRate * 1.5) * 100) / 100;

    // M1 / D1: explicit multiplier wins; else keep existing >0; else default 0.5× Working
    // (matches the Rate Sheet UI which shows 0.5x when the field is empty)
    const existingM1 = Number(currentSideData.m1PerTrip);
    const existingD1 = Number(currentSideData.d1PerTrip);
    const m1PerTrip =
      m1Multiplier != null
        ? Math.round(workingDay * m1Multiplier * 100) / 100
        : Number.isFinite(existingM1) && existingM1 > 0
          ? existingM1
          : Math.round(workingDay * 0.5 * 100) / 100;
    const d1PerTrip =
      d1Multiplier != null
        ? Math.round(workingDay * d1Multiplier * 100) / 100
        : Number.isFinite(existingD1) && existingD1 > 0
          ? existingD1
          : Math.round(workingDay * 0.5 * 100) / 100;

    return {
      ...currentSideData,
      workingDay,
      standbyDay,
      otPerHour,
      m1PerTrip,
      d1PerTrip,
    };
  } else {
    const divisor = normalHours === 12 ? 14 : 8;
    hourlyRate = workingDay / divisor;

    const otNormalPerHour = Math.round((hourlyRate * 1.5) * 100) / 100;
    const ot2PerHour = Math.round((hourlyRate * 2.0) * 100) / 100;
    const ot3PerHour = Math.round((hourlyRate * 3.0) * 100) / 100;

    return {
      ...currentSideData,
      workingDay,
      standbyDay,
      otNormalPerHour,
      ot2PerHour,
      ot3PerHour,
    };
  }
}
