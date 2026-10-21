import { Badge } from '@/components/ui/badge';
import { attendanceDayTypeTags } from '@/lib/attendance/office-attendance-day-kind';
import type { WeeklyRestPatternForCalendar } from '@/lib/attendance/bangkok-calendar';

export function AttendanceDayKindCell({
  ymd,
  weeklyRestPattern,
  calendarHolidayLabel,
}: {
  ymd: string;
  weeklyRestPattern: WeeklyRestPatternForCalendar;
  calendarHolidayLabel: string | null;
}) {
  const tags = attendanceDayTypeTags(ymd, weeklyRestPattern, calendarHolidayLabel);
  if (tags.length === 0) return <span className="text-muted-foreground text-xs">วันทำงาน</span>;
  return (
    <div className="flex flex-wrap gap-1 justify-center">
      {tags.map((t) => (
        <Badge key={t} variant="outline" className="text-[10px] font-normal">
          {t}
        </Badge>
      ))}
    </div>
  );
}
