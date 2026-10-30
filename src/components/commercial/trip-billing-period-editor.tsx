'use client';

import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { Loader2, Pencil } from 'lucide-react';

export function TripBillingPeriodEditor(props: {
  startMs: number | null;
  endMs: number | null;
  onStart: (ms: number) => void;
  onEnd: (ms: number) => void;
  displayStartYmd?: string;
  displayEndYmd?: string;
  suggestedStart?: string;
  suggestedEnd?: string;
  lastD1?: string;
  editing?: boolean;
  canEdit?: boolean;
  saving?: boolean;
  disabled?: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  onResetSuggested?: () => void;
}) {
  const viewStart = props.displayStartYmd || '';
  const viewEnd = props.displayEndYmd || '';
  const showActions = Boolean(props.onEdit || props.onSave);

  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label>งวด Trip</Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            ค่าเริ่มต้นตาม M1 ถึง D1 จาก timesheet — ดึง Premob (SB 8 ชม.) ด้วยการเลื่อนวันเริ่มต้นก่อน M1
          </p>
        </div>
        {showActions ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {props.editing ? (
              <>
                {props.onResetSuggested && props.suggestedStart && props.suggestedEnd ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-[11px]"
                    disabled={props.disabled || props.saving}
                    onClick={props.onResetSuggested}
                  >
                    ใช้ M1–D1
                  </Button>
                ) : null}
                {props.onCancel ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={props.saving}
                    onClick={props.onCancel}
                  >
                    ยกเลิก
                  </Button>
                ) : null}
                {props.onSave ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    disabled={props.disabled || props.saving}
                    onClick={props.onSave}
                  >
                    {props.saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    บันทึก
                  </Button>
                ) : null}
              </>
            ) : props.canEdit && props.onEdit ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1"
                disabled={props.disabled}
                onClick={props.onEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
                แก้ไข
              </Button>
            ) : null}
          </div>
        ) : props.onResetSuggested && props.suggestedStart && props.suggestedEnd ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 text-[11px]"
            disabled={props.disabled}
            onClick={props.onResetSuggested}
          >
            ใช้ M1–D1
          </Button>
        ) : null}
      </div>
      {props.editing ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>วันเริ่มต้น</Label>
            <DatePickerThaiBE value={props.startMs} onChange={props.onStart} disabled={props.disabled || props.saving} />
          </div>
          <div>
            <Label>วันสิ้นสุด</Label>
            <DatePickerThaiBE value={props.endMs} onChange={props.onEnd} disabled={props.disabled || props.saving} />
          </div>
        </div>
      ) : (
        <div className="text-sm font-medium">
          {viewStart && viewEnd
            ? `${formatStoredDateThaiBE(viewStart)} — ${formatStoredDateThaiBE(viewEnd)}`
            : 'ยังไม่มีช่วงวันที่จาก timesheet'}
        </div>
      )}
      {(props.suggestedStart || props.lastD1) && (
        <p className="text-[11px] text-muted-foreground">
          {props.suggestedStart && props.suggestedEnd
            ? `ค่าเริ่มต้นจาก timesheet ${formatStoredDateThaiBE(props.suggestedStart)} – ${formatStoredDateThaiBE(props.suggestedEnd)}`
            : null}
          {props.lastD1 ? ` · D1 ${formatStoredDateThaiBE(props.lastD1)}` : null}
        </p>
      )}
    </div>
  );
}
