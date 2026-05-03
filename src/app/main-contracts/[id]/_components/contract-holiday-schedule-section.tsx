'use client';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarHolidayEditor } from './calendar-holiday-editor';
import type { WeeklyRestPattern, CalendarHolidayEntry } from '@/lib/contract-position-rate-extras';
import { WEEKLY_REST_OPTIONS } from '@/lib/contract-position-rate-extras';

interface ContractHolidayScheduleSectionProps {
  disabled: boolean;
  canViewCostFields: boolean;
  /** false = ซ่อนฝั่ง payroll — ปฏิทินค่าจ้างอยู่ที่ HR Settings */
  showPayrollSide?: boolean;
  sellWeeklyPattern: WeeklyRestPattern;
  setSellWeeklyPattern: (v: WeeklyRestPattern) => void;
  costWeeklyPattern: WeeklyRestPattern;
  setCostWeeklyPattern: (v: WeeklyRestPattern) => void;
  sellCalendarHolidays: CalendarHolidayEntry[];
  setSellCalendarHolidays: React.Dispatch<React.SetStateAction<CalendarHolidayEntry[]>>;
  costCalendarHolidays: CalendarHolidayEntry[];
  setCostCalendarHolidays: React.Dispatch<React.SetStateAction<CalendarHolidayEntry[]>>;
}

export function ContractHolidayScheduleSection({
  disabled,
  canViewCostFields,
  showPayrollSide = true,
  sellWeeklyPattern,
  setSellWeeklyPattern,
  costWeeklyPattern,
  setCostWeeklyPattern,
  sellCalendarHolidays,
  setSellCalendarHolidays,
  costCalendarHolidays,
  setCostCalendarHolidays,
}: ContractHolidayScheduleSectionProps) {
  return (
    <div className="space-y-4 rounded-lg border border-dashed border-primary/30 bg-muted/10 p-4">
      <div>
        <Label className="text-base font-semibold">วันหยุด / วันพิเศษ (ใช้ร่วมทุกตำแหน่งในสัญญานี้)</Label>
        <p className="text-xs text-muted-foreground mt-1">
          {showPayrollSide
            ? 'ใช้คู่กับกฎตัวคูณด้านบน — ฝั่งขายและฝั่งต้นทุนแยกกันได้'
            : 'ฝั่งวางบิลตั้งที่สัญญานี้ — ปฏิทินค่าจ้างลูกจ้างตั้งที่เมนู HR → ตั้งค่า'}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <h4 className="text-sm font-bold text-primary">ฝั่งขาย / วางบิล (Billing)</h4>
        <div className="grid gap-2">
          <Label>รูปแบบวันหยุดประจำสัปดาห์</Label>
          <Select
            disabled={disabled}
            value={sellWeeklyPattern}
            onValueChange={(v) => setSellWeeklyPattern(v as WeeklyRestPattern)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKLY_REST_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CalendarHolidayEditor
          title="วันหยุดเพิ่มเติม (เลือกจากปฏิทิน)"
          disabled={disabled}
          holidays={sellCalendarHolidays}
          setHolidays={setSellCalendarHolidays}
        />
      </div>

      {canViewCostFields && showPayrollSide ? (
        <div className="space-y-3 rounded-lg border border-amber-200/80 bg-amber-50/40 p-4">
          <h4 className="text-sm font-bold text-amber-900">ฝั่งต้นทุน / Payroll</h4>
          <div className="grid gap-2">
            <Label>รูปแบบวันหยุดประจำสัปดาห์</Label>
            <Select
              disabled={disabled}
              value={costWeeklyPattern}
              onValueChange={(v) => setCostWeeklyPattern(v as WeeklyRestPattern)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKLY_REST_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CalendarHolidayEditor
            title="วันหยุดเพิ่มเติม (เลือกจากปฏิทิน)"
            disabled={disabled}
            holidays={costCalendarHolidays}
            setHolidays={setCostCalendarHolidays}
          />
        </div>
      ) : null}
    </div>
  );
}
