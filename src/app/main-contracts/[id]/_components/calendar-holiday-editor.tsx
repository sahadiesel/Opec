'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import type { CalendarHolidayEntry } from '@/lib/contract-position-rate-extras';

export function CalendarHolidayEditor({
  title,
  disabled,
  holidays,
  setHolidays,
}: {
  title: string;
  disabled?: boolean;
  holidays: CalendarHolidayEntry[];
  setHolidays: React.Dispatch<React.SetStateAction<CalendarHolidayEntry[]>>;
}) {
  const [pickTs, setPickTs] = useState<number | null>(null);
  const [rowLabel, setRowLabel] = useState('');

  const addRow = () => {
    if (disabled || pickTs == null || !rowLabel.trim()) return;
    const date = format(new Date(pickTs), 'yyyy-MM-dd');
    setHolidays((prev) => [...prev, { date, label: rowLabel.trim() }]);
    setPickTs(null);
    setRowLabel('');
  };

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1">
          <Label className="text-[10px] text-muted-foreground">เลือกวันที่จากปฏิทิน</Label>
          <DatePickerThaiBE
            value={pickTs ?? undefined}
            onChange={(ms) => setPickTs(ms)}
            disabled={disabled}
            placeholder="เลือกวันที่"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[10px] text-muted-foreground">ชื่อวันหยุด / เหตุการณ์</Label>
          <Input
            disabled={disabled}
            value={rowLabel}
            onChange={(e) => setRowLabel(e.target.value)}
            placeholder="เช่น วันขึ้นปีใหม่"
          />
        </div>
        <Button type="button" variant="secondary" size="sm" className="h-9" disabled={disabled} onClick={addRow}>
          <Plus className="h-4 w-4 mr-1" /> เพิ่ม
        </Button>
      </div>
      {holidays.length > 0 && (
        <ul className="space-y-1 text-xs border-t pt-2">
          {holidays.map((h, i) => (
            <li key={`${h.date}-${i}`} className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1">
              <span>
                <span className="font-mono text-primary">{formatYmdLocalThaiBE(h.date, h.date)}</span>
                <span className="text-muted-foreground"> — {h.label}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-destructive"
                disabled={disabled}
                onClick={() => setHolidays((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
