import type { Assignment, POLine, PositionRate, Wave } from '@/lib/types';
import { WAVE_TIMESHEET_DEPLOYMENT_STATUSES } from '@/lib/constants/timesheet-wave';

/** ชั่วโมงทำงานต่อวันตามมาตรฐานสัญญาที่ใช้ใน Wave Board (ลงเวลาเท่านั้น — OT คิดแยกใน payroll / billing) */
export const DEFAULT_CONTRACT_DAILY_HOURS = 12;

/**
 * ดึงชั่วโมงปกติต่อวันจากบรรทัด PO (สแนปจากสัญญา) แล้วค่อยจากอัตราตามสัญญา (position_rates)
 * ลำดับ: Wave.poLineId → PO line อื่นที่มี snapshot → position_rates ที่ active
 */
export function resolveContractDailyHoursForWaveBoard(
  wave: Wave | undefined,
  poLines: POLine[] | undefined,
  positionRates: PositionRate[] | undefined,
): number {
  const fallback = DEFAULT_CONTRACT_DAILY_HOURS;

  const fromLineSnapshot = (line: POLine | undefined): number | undefined => {
    const h = line?.normalWorkHoursSnapshot;
    return h === 8 || h === 12 ? h : undefined;
  };

  const fromRate = (r: PositionRate | undefined): number | undefined => {
    const h = r?.normalWorkHours;
    return h === 8 || h === 12 ? h : undefined;
  };

  if (wave?.poLineId) {
    const match = poLines?.find((l) => l.id === wave.poLineId);
    const h = fromLineSnapshot(match);
    if (h != null) return h;
  }

  for (const line of poLines ?? []) {
    const h = fromLineSnapshot(line);
    if (h != null) return h;
  }

  for (const r of positionRates ?? []) {
    if (r.active === false) continue;
    const h = fromRate(r);
    if (h != null) return h;
  }

  return fallback;
}

/**
 * รอบเดือนของ Wave จากช่วง startDate–endDate (เช่น Feb หรือ Feb–Mar)
 * ใช้บนศูนย์ลงเวลาและ dropdown Wave Board
 */
export function waveRoundMonthLabel(w: Wave): string {
  const s = (w.startDate || '').slice(0, 10);
  const e = (w.endDate || '').slice(0, 10);
  if (!s) return '—';
  const start = new Date(`${s}T12:00:00`);
  const end = e ? new Date(`${e}T12:00:00`) : start;
  const opt: Intl.DateTimeFormatOptions = { month: 'short' };
  const sm = start.toLocaleDateString('en-US', opt);
  const em = end.toLocaleDateString('en-US', opt);
  if (sm === em) return sm;
  return `${sm}–${em}`;
}

/** ตรงกับ Wave Board: พร้อมลงเวลาเมื่อ mobilization ผ่าน readiness และ deployment อยู่ในชุดที่เปิดบอร์ดได้ */
export function assignmentReadyForWaveTimesheet(a: Pick<Assignment, 'readinessStatus' | 'deploymentStatus'>): boolean {
  if ((a.readinessStatus ?? 'incomplete') !== 'ready') return false;
  return WAVE_TIMESHEET_DEPLOYMENT_STATUSES.includes(a.deploymentStatus);
}
