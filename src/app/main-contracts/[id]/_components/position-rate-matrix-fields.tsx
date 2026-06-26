'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  ContractMobDemobLocation,
  PositionRateMatrix,
  PositionRateOffshoreSide,
  PositionRateOnshoreSide,
} from '@/lib/types';
import { createEmptyPositionRateMatrix } from '@/lib/commercial/position-rate-matrix';

function parseRateInput(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function rateInputValue(v: number | undefined): string {
  return v != null && v > 0 ? String(v) : '';
}

interface SideFieldsProps {
  title: string;
  side: 'offshore' | 'onshore';
  bundleKey: 'sell' | 'cost';
  matrix: PositionRateMatrix;
  mobDemobLocations: ContractMobDemobLocation[];
  disabled?: boolean;
  onChange: (matrix: PositionRateMatrix) => void;
  onWorkingDaySellChange?: (onshore?: number, offshore?: number) => void;
}

function SideFields({
  title,
  side,
  bundleKey,
  matrix,
  mobDemobLocations,
  disabled,
  onChange,
  onWorkingDaySellChange,
}: SideFieldsProps) {
  const bundle = matrix[bundleKey] ?? {};
  const sideData = (side === 'offshore' ? bundle.offshore : bundle.onshore) ?? {};

  const patchSide = (patch: Partial<PositionRateOffshoreSide & PositionRateOnshoreSide>) => {
    const next: PositionRateMatrix = {
      ...matrix,
      [bundleKey]: {
        ...bundle,
        [side]: { ...sideData, ...patch },
      },
    };
    onChange(next);

    if (bundleKey === 'sell' && onWorkingDaySellChange && patch.workingDay !== undefined) {
      const onVal = side === 'onshore' ? patch.workingDay : next.sell?.onshore?.workingDay;
      const offVal = side === 'offshore' ? patch.workingDay : next.sell?.offshore?.workingDay;
      onWorkingDaySellChange(onVal, offVal);
    }
  };

  const patchMob = (locationKey: string, raw: string) => {
    const amount = parseRateInput(raw);
    const prev = (sideData as PositionRateOffshoreSide).mobDemobRoundTrip ?? {};
    const mobDemobRoundTrip = { ...prev };
    if (amount != null) mobDemobRoundTrip[locationKey] = amount;
    else delete mobDemobRoundTrip[locationKey];
    patchSide({ mobDemobRoundTrip } as Partial<PositionRateOffshoreSide>);
  };

  return (
    <div className="rounded-md border p-3 space-y-3 bg-background">
      <p className="text-sm font-semibold">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="grid gap-1">
          <Label className="text-xs">Working / วัน</Label>
          <Input
            type="number"
            min={0}
            step="any"
            disabled={disabled}
            value={rateInputValue(sideData.workingDay)}
            onChange={(e) => patchSide({ workingDay: parseRateInput(e.target.value) })}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Standby / วัน</Label>
          <Input
            type="number"
            min={0}
            step="any"
            disabled={disabled}
            value={rateInputValue(sideData.standbyDay)}
            onChange={(e) => patchSide({ standbyDay: parseRateInput(e.target.value) })}
          />
        </div>
        {side === 'offshore' ? (
          <>
            <div className="grid gap-1">
              <Label className="text-xs">OT / ชม.</Label>
              <Input
                type="number"
                min={0}
                step="any"
                disabled={disabled}
                value={rateInputValue((sideData as PositionRateOffshoreSide).otPerHour)}
                onChange={(e) => patchSide({ otPerHour: parseRateInput(e.target.value) } as Partial<PositionRateOffshoreSide>)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">M1 / เที่ยว</Label>
              <Input
                type="number"
                min={0}
                step="any"
                disabled={disabled}
                value={rateInputValue((sideData as PositionRateOffshoreSide).m1PerTrip)}
                onChange={(e) => patchSide({ m1PerTrip: parseRateInput(e.target.value) } as Partial<PositionRateOffshoreSide>)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">D1 / เที่ยว</Label>
              <Input
                type="number"
                min={0}
                step="any"
                disabled={disabled}
                value={rateInputValue((sideData as PositionRateOffshoreSide).d1PerTrip)}
                onChange={(e) => patchSide({ d1PerTrip: parseRateInput(e.target.value) } as Partial<PositionRateOffshoreSide>)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-1">
              <Label className="text-xs">OT ปกติ / ชม.</Label>
              <Input
                type="number"
                min={0}
                step="any"
                disabled={disabled}
                value={rateInputValue((sideData as PositionRateOnshoreSide).otNormalPerHour)}
                onChange={(e) =>
                  patchSide({ otNormalPerHour: parseRateInput(e.target.value) } as Partial<PositionRateOnshoreSide>)
                }
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">OT2 / ชม.</Label>
              <Input
                type="number"
                min={0}
                step="any"
                disabled={disabled}
                value={rateInputValue((sideData as PositionRateOnshoreSide).ot2PerHour)}
                onChange={(e) => patchSide({ ot2PerHour: parseRateInput(e.target.value) } as Partial<PositionRateOnshoreSide>)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">OT3 / ชม.</Label>
              <Input
                type="number"
                min={0}
                step="any"
                disabled={disabled}
                value={rateInputValue((sideData as PositionRateOnshoreSide).ot3PerHour)}
                onChange={(e) => patchSide({ ot3PerHour: parseRateInput(e.target.value) } as Partial<PositionRateOnshoreSide>)}
              />
            </div>
          </>
        )}
      </div>

      {side === 'offshore' && mobDemobLocations.length > 0 && (
        <div className="space-y-2 pt-1 border-t">
          <Label className="text-xs font-semibold">Mob/Demob (ต่อรอบ)</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {mobDemobLocations.map((loc) => (
              <div key={loc.key} className="grid gap-1">
                <Label className="text-[10px] text-muted-foreground truncate" title={loc.label}>
                  {loc.label}
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  disabled={disabled}
                  value={rateInputValue((sideData as PositionRateOffshoreSide).mobDemobRoundTrip?.[loc.key])}
                  onChange={(e) => patchMob(loc.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export interface PositionRateMatrixFieldsProps {
  rateMatrix: PositionRateMatrix | undefined;
  onChange: (matrix: PositionRateMatrix) => void;
  mobDemobLocations: ContractMobDemobLocation[];
  canEditSell: boolean;
  canEditCost: boolean;
  canViewCost: boolean;
  disabled?: boolean;
  onWorkingDaySellChange?: (onshore?: number, offshore?: number) => void;
}

export function PositionRateMatrixFields({
  rateMatrix,
  onChange,
  mobDemobLocations,
  canEditSell,
  canEditCost,
  canViewCost,
  disabled = false,
  onWorkingDaySellChange,
}: PositionRateMatrixFieldsProps) {
  const matrix = rateMatrix ?? createEmptyPositionRateMatrix();

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div>
        <Label className="text-sm font-semibold">Rate Sheet ขยาย (Mob / Standby / OT / M1-D1)</Label>
        <p className="text-xs text-muted-foreground mt-1">
          ราคารายการเพิ่มเติมตามตารางสัญญาลูกค้า — Working / วัน จะ sync กับราคาขาย Onshore/Offshore ด้านบนเมื่อบันทึก
        </p>
      </div>

      {canEditSell && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-green-700">ราคาขาย (Sell)</p>
          <SideFields
            title="Offshore"
            side="offshore"
            bundleKey="sell"
            matrix={matrix}
            mobDemobLocations={mobDemobLocations}
            disabled={disabled}
            onChange={onChange}
            onWorkingDaySellChange={onWorkingDaySellChange}
          />
          <SideFields
            title="Onshore"
            side="onshore"
            bundleKey="sell"
            matrix={matrix}
            mobDemobLocations={mobDemobLocations}
            disabled={disabled}
            onChange={onChange}
            onWorkingDaySellChange={onWorkingDaySellChange}
          />
        </div>
      )}

      {canViewCost && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-amber-800">ต้นทุนค่าแรง (Cost)</p>
          <SideFields
            title="Offshore"
            side="offshore"
            bundleKey="cost"
            matrix={matrix}
            mobDemobLocations={mobDemobLocations}
            disabled={disabled || !canEditCost}
            onChange={onChange}
          />
          <SideFields
            title="Onshore"
            side="onshore"
            bundleKey="cost"
            matrix={matrix}
            mobDemobLocations={mobDemobLocations}
            disabled={disabled || !canEditCost}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}
