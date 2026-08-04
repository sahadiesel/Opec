'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type {
  ContractMobDemobLocation,
  PositionRateMatrix,
  PositionRateOffshoreSide,
  PositionRateOnshoreSide,
} from '@/lib/types';
import { createEmptyPositionRateMatrix, autoCalculateMatrixFields } from '@/lib/commercial/position-rate-matrix';

function SideFields({
  title,
  side,
  bundleKey,
  matrix,
  mobDemobLocations,
  disabled,
  onChange,
  normalWorkHoursOnshore,
  normalWorkHoursOffshore,
}: SideFieldsProps) {
  const bundle = matrix[bundleKey] ?? {};
  const sideData = (side === 'offshore' ? bundle.offshore : bundle.onshore) ?? {};

  const [m1Mult, setM1Mult] = useState<number | 'custom'>(0.5);
  const [d1Mult, setD1Mult] = useState<number | 'custom'>(0.5);
  const [localRaw, setLocalRaw] = useState<Record<string, string>>({});

  useEffect(() => {
    if (side !== 'offshore') return;
    const wd = sideData.workingDay;
    if (wd == null || !(wd > 0)) return;

    const m1 = (sideData as PositionRateOffshoreSide).m1PerTrip;
    const d1 = (sideData as PositionRateOffshoreSide).d1PerTrip;

    if (m1 != null && m1 > 0) {
      const ratio = m1 / wd;
      if (Math.abs(ratio - 0.5) < 0.01) setM1Mult(0.5);
      else if (Math.abs(ratio - 1.0) < 0.01) setM1Mult(1.0);
      else setM1Mult('custom');
    } else {
      setM1Mult(0.5);
    }

    if (d1 != null && d1 > 0) {
      const ratio = d1 / wd;
      if (Math.abs(ratio - 0.5) < 0.01) setD1Mult(0.5);
      else if (Math.abs(ratio - 1.0) < 0.01) setD1Mult(1.0);
      else setD1Mult('custom');
    } else {
      setD1Mult(0.5);
    }
  }, [side, sideData.workingDay, (sideData as PositionRateOffshoreSide).m1PerTrip, (sideData as PositionRateOffshoreSide).d1PerTrip]);

  // UI shows 0.5x when empty, but that used to be display-only — write the baht amount
  // so Save persists M1/D1. Skip when user chose "คีย์".
  useEffect(() => {
    if (side !== 'offshore') return;
    const wd = sideData.workingDay;
    if (wd == null || !(wd > 0)) return;

    const m1 = (sideData as PositionRateOffshoreSide).m1PerTrip;
    const d1 = (sideData as PositionRateOffshoreSide).d1PerTrip;
    const patch: Partial<PositionRateOffshoreSide> = {};
    if (!(m1 != null && m1 > 0) && m1Mult !== 'custom') {
      const mult = typeof m1Mult === 'number' ? m1Mult : 0.5;
      patch.m1PerTrip = Math.round(wd * mult * 100) / 100;
    }
    if (!(d1 != null && d1 > 0) && d1Mult !== 'custom') {
      const mult = typeof d1Mult === 'number' ? d1Mult : 0.5;
      patch.d1PerTrip = Math.round(wd * mult * 100) / 100;
    }
    if (Object.keys(patch).length === 0) return;

    onChange({
      ...matrix,
      [bundleKey]: {
        ...bundle,
        [side]: { ...sideData, ...patch },
      },
    });
    setLocalRaw((prev) => ({
      ...prev,
      ...(patch.m1PerTrip != null ? { m1PerTrip: String(patch.m1PerTrip) } : {}),
      ...(patch.d1PerTrip != null ? { d1PerTrip: String(patch.d1PerTrip) } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync empty M1/D1 to multiplier × Working
  }, [side, sideData.workingDay, (sideData as PositionRateOffshoreSide).m1PerTrip, (sideData as PositionRateOffshoreSide).d1PerTrip, m1Mult, d1Mult]);

  const patchSide = (patch: Partial<PositionRateOffshoreSide & PositionRateOnshoreSide>) => {
    let updatedFields = { ...patch };
    if (patch.workingDay !== undefined) {
      const workingDay = patch.workingDay;
      const normalHours = side === 'offshore' ? normalWorkHoursOffshore : normalWorkHoursOnshore;
      const m1Multiplier = side === 'offshore' && m1Mult !== 'custom' ? m1Mult : undefined;
      const d1Multiplier = side === 'offshore' && d1Mult !== 'custom' ? d1Mult : undefined;
      
      const computed = autoCalculateMatrixFields(side, workingDay, normalHours, sideData, m1Multiplier, d1Multiplier);
      updatedFields = { ...computed };
    }

    const next: PositionRateMatrix = {
      ...matrix,
      [bundleKey]: {
        ...bundle,
        [side]: { ...sideData, ...updatedFields },
      },
    };
    onChange(next);
  };

  const handleInput = (field: string, raw: string) => {
    setLocalRaw((prev) => ({ ...prev, [field]: raw }));
    const n = parseFloat(raw);
    const val = Number.isFinite(n) && n >= 0 ? n : undefined;
    patchSide({ [field]: val } as any);
  };

  const patchMob = (locationKey: string, raw: string) => {
    const fieldKey = `mob_${locationKey}`;
    setLocalRaw((prev) => ({ ...prev, [fieldKey]: raw }));
    const n = parseFloat(raw);
    const amount = Number.isFinite(n) && n >= 0 ? n : undefined;
    const prev = (sideData as PositionRateOffshoreSide).mobDemobRoundTrip ?? {};
    const mobDemobRoundTrip = { ...prev };
    if (amount != null) mobDemobRoundTrip[locationKey] = amount;
    else delete mobDemobRoundTrip[locationKey];
    patchSide({ mobDemobRoundTrip } as Partial<PositionRateOffshoreSide>);
  };

  const getValue = (field: string, numValue: number | undefined) => {
    const raw = localRaw[field];
    if (raw !== undefined) {
      const parsed = parseFloat(raw);
      if ((Number.isNaN(parsed) && numValue == null) || parsed === numValue) {
        return raw;
      }
    }
    return numValue != null && numValue >= 0 ? String(numValue) : '';
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
            value={getValue('workingDay', sideData.workingDay)}
            onChange={(e) => handleInput('workingDay', e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Standby / วัน</Label>
          <Input
            type="number"
            min={0}
            step="any"
            disabled={disabled}
            value={getValue('standbyDay', sideData.standbyDay)}
            onChange={(e) => handleInput('standbyDay', e.target.value)}
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
                value={getValue('otPerHour', (sideData as PositionRateOffshoreSide).otPerHour)}
                onChange={(e) => handleInput('otPerHour', e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">M1 / เที่ยว</Label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  disabled={disabled || m1Mult !== 'custom'}
                  className="w-2/3 font-mono"
                  value={getValue('m1PerTrip', (sideData as PositionRateOffshoreSide).m1PerTrip)}
                  onChange={(e) => handleInput('m1PerTrip', e.target.value)}
                />
                <Select
                  disabled={disabled}
                  value={String(m1Mult)}
                  onValueChange={(v) => {
                    const nextM1Mult = v === 'custom' ? 'custom' : Number(v);
                    setM1Mult(nextM1Mult);
                    if (nextM1Mult !== 'custom') {
                      const wd = sideData.workingDay;
                      if (wd && wd >= 0) {
                        const m1Val = Math.round((wd * nextM1Mult) * 100) / 100;
                        patchSide({ m1PerTrip: m1Val } as Partial<PositionRateOffshoreSide>);
                        setLocalRaw((prev) => ({ ...prev, m1PerTrip: String(m1Val) }));
                      }
                    }
                  }}
                >
                  <SelectTrigger className="w-1/3 text-xs px-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.5">0.5x</SelectItem>
                    <SelectItem value="1">1.0x</SelectItem>
                    <SelectItem value="custom">คีย์</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">D1 / เที่ยว</Label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  disabled={disabled || d1Mult !== 'custom'}
                  className="w-2/3 font-mono"
                  value={getValue('d1PerTrip', (sideData as PositionRateOffshoreSide).d1PerTrip)}
                  onChange={(e) => handleInput('d1PerTrip', e.target.value)}
                />
                <Select
                  disabled={disabled}
                  value={String(d1Mult)}
                  onValueChange={(v) => {
                    const nextD1Mult = v === 'custom' ? 'custom' : Number(v);
                    setD1Mult(nextD1Mult);
                    if (nextD1Mult !== 'custom') {
                      const wd = sideData.workingDay;
                      if (wd && wd >= 0) {
                        const d1Val = Math.round((wd * nextD1Mult) * 100) / 100;
                        patchSide({ d1PerTrip: d1Val } as Partial<PositionRateOffshoreSide>);
                        setLocalRaw((prev) => ({ ...prev, d1PerTrip: String(d1Val) }));
                      }
                    }
                  }}
                >
                  <SelectTrigger className="w-1/3 text-xs px-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.5">0.5x</SelectItem>
                    <SelectItem value="1">1.0x</SelectItem>
                    <SelectItem value="custom">คีย์</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                value={getValue('otNormalPerHour', (sideData as PositionRateOnshoreSide).otNormalPerHour)}
                onChange={(e) => handleInput('otNormalPerHour', e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">OT2 / ชม.</Label>
              <Input
                type="number"
                min={0}
                step="any"
                disabled={disabled}
                value={getValue('ot2PerHour', (sideData as PositionRateOnshoreSide).ot2PerHour)}
                onChange={(e) => handleInput('ot2PerHour', e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">OT3 / ชม.</Label>
              <Input
                type="number"
                min={0}
                step="any"
                disabled={disabled}
                value={getValue('ot3PerHour', (sideData as PositionRateOnshoreSide).ot3PerHour)}
                onChange={(e) => handleInput('ot3PerHour', e.target.value)}
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
                  value={getValue(`mob_${loc.key}`, (sideData as PositionRateOffshoreSide).mobDemobRoundTrip?.[loc.key])}
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
  normalWorkHoursOnshore: number;
  normalWorkHoursOffshore: number;
}

export function PositionRateMatrixFields({
  rateMatrix,
  onChange,
  mobDemobLocations,
  canEditSell,
  canEditCost,
  canViewCost,
  disabled = false,
  normalWorkHoursOnshore,
  normalWorkHoursOffshore,
}: PositionRateMatrixFieldsProps) {
  const matrix = rateMatrix ?? createEmptyPositionRateMatrix();

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div>
        <Label className="text-sm font-semibold">Rate Sheet ขยาย (Mob / Standby / OT / M1-D1)</Label>
        <p className="text-xs text-muted-foreground mt-1">
          ราคารายการเพิ่มเติมตามตารางสัญญา — Working / SB / M1 / D1 อ้างอิงชม.แพ็กที่ตั้งไว้ด้านบน
          (มาตรฐาน <strong>Offshore = 12 ชม.</strong> · <strong>Onshore = 8 ชม.</strong>)
          — ใช้เป็นฐานสัดส่วนเมื่อแก้ชม.วัน M1/D1 หรือ SB
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
            normalWorkHoursOnshore={normalWorkHoursOnshore}
            normalWorkHoursOffshore={normalWorkHoursOffshore}
          />
          <SideFields
            title="Onshore"
            side="onshore"
            bundleKey="sell"
            matrix={matrix}
            mobDemobLocations={mobDemobLocations}
            disabled={disabled}
            onChange={onChange}
            normalWorkHoursOnshore={normalWorkHoursOnshore}
            normalWorkHoursOffshore={normalWorkHoursOffshore}
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
            normalWorkHoursOnshore={normalWorkHoursOnshore}
            normalWorkHoursOffshore={normalWorkHoursOffshore}
          />
          <SideFields
            title="Onshore"
            side="onshore"
            bundleKey="cost"
            matrix={matrix}
            mobDemobLocations={mobDemobLocations}
            disabled={disabled || !canEditCost}
            onChange={onChange}
            normalWorkHoursOnshore={normalWorkHoursOnshore}
            normalWorkHoursOffshore={normalWorkHoursOffshore}
          />
        </div>
      )}
    </div>
  );
}
