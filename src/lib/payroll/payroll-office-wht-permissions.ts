import type { PayrollRunStatus, User } from '@/lib/types';
import { normalizeCurrentUserPermissions } from '@/lib/permissions';
import { isSimpleInternalEligible } from '@/lib/simple-tier-model';

/** ยังไม่มีบรรทัดคำนวณ — ไม่เปิดพิมพ์ใบหัก */
const BLOCKED_OFFICE_RUN: PayrollRunStatus[] = ['DRAFT'];

/** พรีวิว/พิมพ์ใบหัก ณ ที่จ่ายพนักงานออฟฟิศ — หลังมีการคำนวณแล้วเท่านั้น */
export function canPreviewOfficePayrollWht(user: User | null | undefined, runStatus: PayrollRunStatus): boolean {
  if (!user) return false;
  const u = normalizeCurrentUserPermissions(user);
  if (!u || !isSimpleInternalEligible(u)) return false;
  return !BLOCKED_OFFICE_RUN.includes(runStatus);
}
