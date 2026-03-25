'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { Calendar as CalendarIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatDateThaiBE } from '@/lib/date-thai';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type DatePickerThaiBEProps = {
  /** เวลาเป็น ms ตาม Date (เก็บเที่ยงวัน local ลดปัญหา timezone) */
  value: number | null | undefined;
  onChange: (timestampMs: number) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  /** แสดงปุ่มล้างค่า (ส่ง onClear) */
  allowClear?: boolean;
  onClear?: () => void;
};

/**
 * เลือกวันที่แบบไทย: ปุ่มแสดง dd/mm/yyyy พ.ศ. + ปฏิทินภาษาไทย หัวเดือนเป็นพ.ศ.
 * ใช้แทน &lt;input type="date" /&gt; ที่เบราว์เซอร์บังคับรูปแบบ US/EN
 */
export function DatePickerThaiBE({
  value,
  onChange,
  disabled,
  id,
  className,
  placeholder = 'เลือกวันที่',
  allowClear,
  onClear,
}: DatePickerThaiBEProps) {
  const [open, setOpen] = React.useState(false);
  const date =
    value != null && Number.isFinite(value) && value > 0 ? new Date(value) : undefined;

  /** ช่วงนำทางในปฏิทิน (ค.ศ. ภายใน) — ปีใน dropdown แสดงเป็นพ.ศ. ผ่าน formatYearDropdown */
  const navBounds = React.useMemo(() => {
    const y = new Date().getFullYear();
    return {
      startMonth: new Date(y - 100, 0, 1),
      endMonth: new Date(y + 50, 11, 31),
    };
  }, []);

  const setNoon = (d: Date) => {
    const x = new Date(d);
    x.setHours(12, 0, 0, 0);
    return x.getTime();
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-10 w-full justify-start text-left font-normal',
            !date && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{date ? formatDateThaiBE(date) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[100] w-fit min-w-[288px] max-w-[min(100vw-1rem,20rem)] p-0"
        align="start"
        sideOffset={8}
      >
        <Calendar
          mode="single"
          locale={th}
          weekStartsOn={0}
          selected={date}
          defaultMonth={date}
          captionLayout="dropdown"
          reverseYears
          startMonth={navBounds.startMonth}
          endMonth={navBounds.endMonth}
          onSelect={(d) => {
            if (d) {
              onChange(setNoon(d));
              setOpen(false);
            }
          }}
          formatters={{
            formatCaption: (month) => {
              const monthName = format(month, 'MMMM', { locale: th });
              const beYear = month.getFullYear() + 543;
              return `${monthName} พ.ศ. ${beYear}`;
            },
            formatYearDropdown: (yearDate) => String(yearDate.getFullYear() + 543),
          }}
          labels={{
            labelNext: () => 'เดือนถัดไป',
            labelPrevious: () => 'เดือนก่อน',
            labelYearDropdown: () => 'เลือกปี (พ.ศ.)',
            labelMonthDropdown: () => 'เลือกเดือน',
          }}
          autoFocus
        />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-2 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              onChange(setNoon(new Date()));
              setOpen(false);
            }}
          >
            วันนี้
          </Button>
          {allowClear && onClear && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              ล้าง
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
