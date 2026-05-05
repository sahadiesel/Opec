import type { PayrollBatchStatus } from '@/lib/types';
import type { User } from '@/lib/types';
import { normalizeCurrentUserPermissions } from '@/lib/permissions';
import { isSimpleInternalEligible } from '@/lib/simple-tier-model';

const BLOCKED_BATCH: PayrollBatchStatus[] = ['DRAFT'];

/** พรีวิว/พิมพ์ใบหัก ณ ที่จ่ายลูกจ้าง — ไม่รวมงวดยังไม่ generate */
export function canPreviewWorkerPayrollWht(user: User | null | undefined, batchStatus: PayrollBatchStatus): boolean {
  if (!user) return false;
  const u = normalizeCurrentUserPermissions(user);
  if (!u || !isSimpleInternalEligible(u)) return false;
  return !BLOCKED_BATCH.includes(batchStatus);
}
