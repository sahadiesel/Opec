import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const officeBadge =
  'border-0 bg-indigo-600 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-600';
const workerBadge =
  'border-0 bg-amber-600 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-amber-600';

export type PayrollScopeProp = 'office' | 'worker' | 'both';

/**
 * HR-D3: ป้ายขอบเขตจ่ายเงิน — แยก Office (รายเดือน) กับ Worker (timesheet + batch) ให้ชัดทุกหน้า
 */
export function PayrollScopeTag({
  scope,
  className,
  showHint = true,
}: {
  scope: PayrollScopeProp;
  className?: string;
  /** บรรทัดอธิบายสั้นใต้ป้าย (ปิดได้ถ้าหน้าแคบ) */
  showHint?: boolean;
}) {
  if (scope === 'both') {
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={officeBadge}>Office Payroll</Badge>
          <Badge className={workerBadge}>Worker Payroll</Badge>
        </div>
        {showHint && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            ตั้งค่าร่วม — ใช้กับทั้งพนักงานออฟฟิศและลูกจ้าง
          </p>
        )}
      </div>
    );
  }

  const hint =
    scope === 'office'
      ? 'รายเดือน · ไม่ใช้ timesheet รายวัน'
      : 'Timesheet รายวัน · รอบจ่ายตาม period / wave';

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <Badge className={cn(scope === 'office' ? officeBadge : workerBadge, 'w-fit')}>
        {scope === 'office' ? 'Office Payroll' : 'Worker Payroll'}
      </Badge>
      {showHint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
    </div>
  );
}
