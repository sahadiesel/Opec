import type { EmploymentTenure } from '@/lib/hr/employment-tenure';
import { isActiveOfficeStaffStatus } from '@/lib/hr/office-staff-active';
import { isActiveWorkerForSelection } from '@/lib/hr/worker-active';
import { thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import { normalizeStaffDateYmd } from '@/lib/payroll/office-staff-date-ymd';
import type { OfficeStaff, Worker } from '@/lib/types';

function latestEmploymentEndYmd(input: {
  employmentEndDate?: unknown;
  employmentTenures?: EmploymentTenure[] | null;
}): string | null {
  const tenures = (input.employmentTenures ?? []).filter((t) => t && String(t.startDate || '').trim());
  if (tenures.length > 0) {
    return normalizeStaffDateYmd(tenures[tenures.length - 1]?.endDate);
  }
  return normalizeStaffDateYmd(input.employmentEndDate);
}

/** รอบล่าสุดสิ้นสุดไปแล้ว — วันที่สิ้นสุดเองยังนับว่าอยู่ในรอบ */
export function employmentCycleHasEnded(
  input: { employmentEndDate?: unknown; employmentTenures?: EmploymentTenure[] | null },
  todayYmd = thailandTodayYmd(),
): boolean {
  const end = latestEmploymentEndYmd(input);
  if (!end) return false;
  return end < todayYmd;
}

/** ลูกจ้างที่ยังเพิ่มหรือแก้เอกสาร การตรวจ และใบเซอร์ได้ */
export function isWorkerRegistryOperable(
  worker: Pick<
    Worker,
    | 'workerStatus'
    | 'readinessManualHold'
    | 'readinessManualHoldReason'
    | 'employmentEndDate'
    | 'employmentTenures'
  >,
): boolean {
  if (!isActiveWorkerForSelection(worker)) return false;
  if (worker.readinessManualHold && worker.readinessManualHoldReason === 'RESIGNED') return false;
  if (employmentCycleHasEnded(worker)) return false;
  return true;
}

/** พนักงานออฟฟิศที่ยังแก้ข้อมูลปฏิบัติการได้ — วันเริ่มงานและวันสิ้นสุดยังแก้ได้เสมอ */
export function isOfficeStaffRegistryOperable(
  staff: Pick<OfficeStaff, 'status' | 'employmentEndDate' | 'employmentTenures'>,
): boolean {
  if (!isActiveOfficeStaffStatus(staff.status)) return false;
  if (employmentCycleHasEnded(staff)) return false;
  return true;
}
