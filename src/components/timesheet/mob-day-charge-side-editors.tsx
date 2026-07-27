'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MobDayChargeKind, MobDayChargeSpec } from '@/lib/types';
import {
  formatMobDayChargeSummary,
  mobDayChargeKindLabel,
} from '@/lib/ops/mob-day-charge';
import {
  formatBahtPreview,
  previewMobDayChargeBaht,
  type MobDayChargeBahtPreviewRates,
} from '@/lib/ops/mob-day-charge-baht-preview';

type Side = 'billing' | 'payroll';

export type MobDayChargeSideEditorsProps = {
  billing: MobDayChargeSpec;
  payroll: MobDayChargeSpec;
  onBillingChange: (next: MobDayChargeSpec) => void;
  onPayrollChange: (next: MobDayChargeSpec) => void;
  packageHours: 8 | 12;
  disabled?: boolean;
  /** เมื่อมีเรท — โชว์ประมาณการบาทใต้ชม. */
  previewRates?: MobDayChargeBahtPreviewRates | null;
  /** รวมตัวเลือก D1 (ใช้ตอนจบงาน / แก้วัน demob) */
  includeD1?: boolean;
  layout?: 'stack' | 'grid';
  compact?: boolean;
};

function applyKindChange(
  draft: MobDayChargeSpec,
  kind: MobDayChargeKind,
  pkgHrs: 8 | 12,
): MobDayChargeSpec {
  const hours = draft.hours && draft.hours > 0 ? draft.hours : pkgHrs;
  if (kind === 'M1' || kind === 'D1') {
    return {
      kind,
      hours,
      ...(draft.m1AmountOverride != null && draft.m1AmountOverride > 0
        ? { m1AmountOverride: draft.m1AmountOverride }
        : {}),
    };
  }
  return { kind, hours };
}

export function MobDayChargeSideEditors({
  billing,
  payroll,
  onBillingChange,
  onPayrollChange,
  packageHours,
  disabled,
  previewRates,
  includeD1 = false,
  layout = 'stack',
  compact = false,
}: MobDayChargeSideEditorsProps) {
  const sides: Side[] = ['billing', 'payroll'];
  const gridClass =
    layout === 'grid' ? 'grid grid-cols-1 gap-3 md:grid-cols-2' : 'space-y-3';

  return (
    <div className={gridClass}>
      {sides.map((side) => {
        const draft = side === 'billing' ? billing : payroll;
        const setDraft = side === 'billing' ? onBillingChange : onPayrollChange;
        const title = side === 'billing' ? 'วางบิลลูกค้า' : 'จ่ายลูกจ้าง';
        const preview =
          previewRates != null
            ? previewMobDayChargeBaht(draft, previewRates, side)
            : null;
        const tripLabel = draft.kind === 'D1' ? 'D1' : 'M1';

        return (
          <div
            key={side}
            className={`space-y-2 rounded-md border bg-muted/20 ${compact ? 'p-2.5' : 'p-3'}`}
          >
            <p className={`font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>{title}</p>
            <Select
              value={draft.kind}
              onValueChange={(v) =>
                setDraft(applyKindChange(draft, v as MobDayChargeKind, packageHours))
              }
              disabled={disabled}
            >
              <SelectTrigger className={compact ? 'h-9' : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STANDBY">{mobDayChargeKindLabel('STANDBY')}</SelectItem>
                <SelectItem value="WORKING">{mobDayChargeKindLabel('WORKING')}</SelectItem>
                <SelectItem value="M1">{mobDayChargeKindLabel('M1')}</SelectItem>
                {includeD1 ? (
                  <SelectItem value="D1">{mobDayChargeKindLabel('D1')}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>

            {draft.kind === 'M1' || draft.kind === 'D1' ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">ชม. (ฐาน {packageHours})</Label>
                  <Input
                    type="number"
                    min={0.5}
                    max={24}
                    step={0.5}
                    className="h-9"
                    value={draft.hours ?? packageHours}
                    disabled={disabled}
                    onChange={(e) =>
                      setDraft({
                        kind: draft.kind,
                        hours: Number(e.target.value) || 0,
                        ...(draft.m1AmountOverride != null && draft.m1AmountOverride > 0
                          ? { m1AmountOverride: draft.m1AmountOverride }
                          : {}),
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">เงิน {tripLabel} (บาท)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="ตามสัญญา"
                    className="h-9"
                    value={draft.m1AmountOverride ?? ''}
                    disabled={disabled}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) {
                        setDraft({ kind: draft.kind, hours: draft.hours ?? packageHours });
                        return;
                      }
                      setDraft({
                        kind: draft.kind,
                        hours: draft.hours ?? packageHours,
                        m1AmountOverride: Number(raw),
                      });
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-[11px]">จำนวนชั่วโมง</Label>
                <Input
                  type="number"
                  min={0.5}
                  max={24}
                  step={0.5}
                  className="h-9"
                  value={draft.hours ?? packageHours}
                  disabled={disabled}
                  onChange={(e) =>
                    setDraft({
                      kind: draft.kind,
                      hours: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              {formatMobDayChargeSummary(draft)}
            </p>
            {preview ? (
              <p className="text-[11px] font-medium text-foreground">
                ≈ {formatBahtPreview(preview.amount)} บาท
                <span className="ml-1 font-normal text-muted-foreground">· {preview.note}</span>
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
