import type { EmploymentTenure } from '@/lib/hr/employment-tenure';
import { employmentCycleHasEnded } from '@/lib/hr/registry-operable';
import { thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import { normalizeStaffDateYmd } from '@/lib/payroll/office-staff-date-ymd';

export type WorkerEmploymentContractStatus = {
  startYmd: string | null;
  endYmd: string | null;
  /** วันนี้ยังอยู่ในช่วงเริ่ม–สิ้นสุด (ไม่มีวันสิ้นสุด = ยังอยู่ในสัญญา) */
  inContract: boolean;
  /** มีวันสิ้นสุดแล้วและเลยวันนั้นไปแล้ว */
  pastEndDate: boolean;
  /** ยังไม่ถึงวันเริ่มงาน */
  beforeStart: boolean;
};

function latestEmploymentBounds(input: {
  startDate?: unknown;
  employmentEndDate?: unknown;
  employmentTenures?: EmploymentTenure[] | null;
}): { startYmd: string | null; endYmd: string | null } {
  const tenures = (input.employmentTenures ?? []).filter((t) => t && String(t.startDate || '').trim());
  if (tenures.length > 0) {
    const latest = tenures[tenures.length - 1];
    return {
      startYmd: normalizeStaffDateYmd(latest?.startDate),
      endYmd: normalizeStaffDateYmd(latest?.endDate),
    };
  }
  return {
    startYmd: normalizeStaffDateYmd(input.startDate),
    endYmd: normalizeStaffDateYmd(input.employmentEndDate),
  };
}

/** สถานะสัญญาจ้างของลูกจ้าง — ใช้แสดงพร้อมทำงานด้านสัญญา + เตือนเลยกำหนด */
export function workerEmploymentContractStatus(
  worker: {
    startDate?: unknown;
    employmentEndDate?: unknown;
    employmentTenures?: EmploymentTenure[] | null;
  },
  todayYmd = thailandTodayYmd(),
): WorkerEmploymentContractStatus {
  const { startYmd, endYmd } = latestEmploymentBounds(worker);
  const pastEndDate = employmentCycleHasEnded(worker, todayYmd);
  const beforeStart = Boolean(startYmd && startYmd > todayYmd);
  const inContract = !pastEndDate && !beforeStart;
  return { startYmd, endYmd, inContract, pastEndDate, beforeStart };
}
