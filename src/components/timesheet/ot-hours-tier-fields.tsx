'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  parseTimesheetOtTier,
  TIMESHEET_OT_TIER_OPTIONS,
  type TimesheetOtTier,
} from '@/lib/timesheet/ot-tier';

type OtHoursAndTierFieldsProps = {
  hoursId: string;
  hours: number;
  onHoursChange: (hours: number) => void;
  tier: TimesheetOtTier;
  onTierChange: (tier: TimesheetOtTier) => void;
  disabled?: boolean;
};

/** ช่องชั่วโมง OT + เลือก OT1.5 / OT2 / OT3 — เก็บลงใบงานเพื่อดึงอัตราสัญญาตอนคิดเงิน */
export function OtHoursAndTierFields({
  hoursId,
  hours,
  onHoursChange,
  tier,
  onTierChange,
  disabled,
}: OtHoursAndTierFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        id={hoursId}
        type="number"
        min={0}
        max={24}
        step={0.5}
        value={hours}
        onChange={(e) => onHoursChange(Number(e.target.value))}
        disabled={disabled}
      />
      <Select
        value={tier}
        onValueChange={(v) => onTierChange(parseTimesheetOtTier(v))}
        disabled={disabled}
      >
        <SelectTrigger className="h-10" aria-label="อัตรา OT">
          <SelectValue placeholder="เลือกอัตรา OT" />
        </SelectTrigger>
        <SelectContent>
          {TIMESHEET_OT_TIER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
