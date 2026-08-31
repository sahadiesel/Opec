import { Badge } from '@/components/ui/badge';
import type { OfficeAttendanceGridLine } from '@/lib/attendance/office-attendance-grid-day-cell';
import { cn } from '@/lib/utils';

export function AttendanceGridLineCell({
  line,
  showCorrectedBadge,
}: {
  line: OfficeAttendanceGridLine;
  showCorrectedBadge?: boolean;
}) {
  if (!line.label && line.tone === 'off') {
    return <span className="text-muted-foreground/30 select-none">&nbsp;</span>;
  }
  const text = line.label || '—';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1',
        line.tone === 'time' && 'font-mono',
        line.tone === 'leave' && 'font-semibold text-blue-700',
        line.tone === 'absent' && 'font-bold text-red-700',
        line.tone === 'waiting' && 'font-semibold text-amber-700',
        line.tone === 'late' && 'font-semibold text-amber-700',
        line.tone === 'off' && 'text-muted-foreground',
      )}
    >
      {text}
      {showCorrectedBadge ? (
        <Badge variant="secondary" className="h-4 px-1 text-[8px] leading-none">
          หลังแก้
        </Badge>
      ) : null}
    </span>
  );
}
