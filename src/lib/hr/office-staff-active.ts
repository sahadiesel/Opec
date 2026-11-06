import {
  isEmploymentEndReason,
  officeStatusForEmploymentTenure,
  type EmploymentEndReason,
  type EmploymentTenure,
} from '@/lib/hr/employment-tenure';
import { thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import { normalizeStaffDateYmd } from '@/lib/payroll/office-staff-date-ymd';

export type OfficeStaffEmploymentStatus = 'ACTIVE' | 'INACTIVE' | 'RESIGNED';

type OfficeStaffStatusFields = {
  status?: string | null;
  employmentEndDate?: unknown;
  employmentEndReason?: string | null;
  employmentTenures?: EmploymentTenure[] | null;
};

function latestEmploymentCycle(staff: OfficeStaffStatusFields): {
  endDate: string;
  endReason: EmploymentEndReason | '';
} {
  const tenures = (staff.employmentTenures ?? []).filter((t) => t && String(t.startDate || '').trim());
  if (tenures.length > 0) {
    const latest = tenures[tenures.length - 1];
    const endReasonRaw = latest?.endReason;
    return {
      endDate: normalizeStaffDateYmd(latest?.endDate) || '',
      endReason: isEmploymentEndReason(endReasonRaw) ? endReasonRaw : '',
    };
  }
  const endReasonRaw = staff.employmentEndReason;
  return {
    endDate: normalizeStaffDateYmd(staff.employmentEndDate) || '',
    endReason: isEmploymentEndReason(endReasonRaw) ? endReasonRaw : '',
  };
}

/** สถานะที่เก็บในเอกสาร — รองรับ ACTIVE / active */
export function isActiveOfficeStaffStatus(status?: string | null): boolean {
  return (status ?? '').trim().toUpperCase() === 'ACTIVE';
}

function storedOfficeStatus(status?: string | null): OfficeStaffEmploymentStatus | undefined {
  const st = (status ?? '').trim().toUpperCase();
  if (st === 'ACTIVE' || st === 'INACTIVE' || st === 'RESIGNED') return st;
  return undefined;
}

/** สถานะที่ใช้แสดง/คัดกรอง — ยังไม่ถึงวันสิ้นสุด = ACTIVE แม้เอกสารยังเป็น INACTIVE */
export function effectiveOfficeStaffStatus(
  staff: OfficeStaffStatusFields,
  todayYmd = thailandTodayYmd(),
): OfficeStaffEmploymentStatus {
  const cycle = latestEmploymentCycle(staff);
  const stored = storedOfficeStatus(staff.status);
  const reason: EmploymentEndReason | '' =
    cycle.endReason || (stored === 'RESIGNED' ? 'RESIGNED' : '');
  return officeStatusForEmploymentTenure(cycle.endDate, reason, stored, todayYmd);
}

export function isEffectivelyActiveOfficeStaff(
  staff: OfficeStaffStatusFields,
  todayYmd?: string,
): boolean {
  return effectiveOfficeStaffStatus(staff, todayYmd) === 'ACTIVE';
}

export function filterActiveOfficeStaffForSelection<T extends OfficeStaffStatusFields>(
  list: T[] | null | undefined,
): T[] {
  return (list ?? []).filter((s) => isEffectivelyActiveOfficeStaff(s));
}
