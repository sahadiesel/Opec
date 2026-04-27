'use client';

import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PositionRate, Position } from '@/lib/types';
import type { OvertimeRuleKey } from '@/lib/contract-position-rate-extras';
import { OVERTIME_RULE_OPTIONS } from '@/lib/contract-position-rate-extras';
import { sortPositionsByDisplayName } from '@/lib/position-display';

export interface PositionRateFormFieldsProps {
  newRate: Partial<PositionRate>;
  setNewRate: (rate: Partial<PositionRate>) => void;
  /** โหมดเพิ่ม: เรียกแทนการ set positionId ตรงๆ เพื่อตรวจซ้ำในสัญญา */
  onAddPositionIdChange?: (positionId: string) => void;
  allPositions: Position[] | null;
  canEditSellSide: boolean;
  canEditCostSide: boolean;
  canViewCostFields: boolean;
  isSupplementalContract: boolean;
  positionMode: 'add' | 'edit';
  positionDisplayName?: string;
}

export function PositionRateFormFields({
  newRate,
  setNewRate,
  onAddPositionIdChange,
  allPositions,
  canEditSellSide,
  canEditCostSide: _canEditCostSide,
  canViewCostFields,
  isSupplementalContract,
  positionMode,
  positionDisplayName,
}: PositionRateFormFieldsProps) {
  const otKey = (newRate.overtimeRuleKey || 'MULT_1_5') as OvertimeRuleKey;

  const positionsForSelect = useMemo(
    () => sortPositionsByDisplayName(allPositions ?? []),
    [allPositions]
  );

  return (
    <div className="grid gap-5 py-2">
      <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-3">
        วันหยุดและวันพิเศษกำหนดที่แท็บ &quot;ข้อมูลสัญญาหลัก&quot; (ใช้ร่วมทุกตำแหน่ง) — รายการนี้เฉพาะราคา/OT ต่อตำแหน่ง
        {canViewCostFields && (
          <span className="block mt-1 text-amber-800">
            ฐานต้นทุนค่าแรง OPEC จ่าย: กำหนดที่เมนู <strong>ตำแหน่งงาน (Positions)</strong> ไม่อยู่ในสัญญา
          </span>
        )}
      </p>

      <div className="grid gap-2">
        <Label>ตำแหน่งงาน (Position)</Label>
        {positionMode === 'edit' ? (
          <p className="text-sm font-medium rounded-md border bg-muted/40 px-3 py-2">{positionDisplayName || '—'}</p>
        ) : (
          <Select
            onValueChange={(v) =>
              onAddPositionIdChange ? onAddPositionIdChange(v) : setNewRate({ ...newRate, positionId: v })
            }
            value={newRate.positionId}
          >
            <SelectTrigger>
              <SelectValue placeholder="เลือกตำแหน่ง..." />
            </SelectTrigger>
            <SelectContent>
              {positionsForSelect.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.positionName || p.positionNameTh}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>ราคาขาย (Sell Rate)</Label>
          <Input
            type="number"
            disabled={!canEditSellSide || isSupplementalContract}
            value={newRate.sellRate}
            onChange={(e) => setNewRate({ ...newRate, sellRate: parseFloat(e.target.value) })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>ชั่วโมงงานปกติ/วัน (Normal Hours)</Label>
          <Select
            disabled={isSupplementalContract}
            onValueChange={(v) => setNewRate({ ...newRate, normalWorkHours: Number(v) as 8 | 12 })}
            value={String(newRate.normalWorkHours || 8)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="8">8 ชั่วโมง</SelectItem>
              <SelectItem value="12">12 ชั่วโมง</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>หน่วยการคิดเงิน</Label>
          <Select onValueChange={(v) => setNewRate({ ...newRate, billingUnit: v as PositionRate['billingUnit'] })} value={newRate.billingUnit}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily (รายวัน)</SelectItem>
              <SelectItem value="monthly">Monthly (รายเดือน)</SelectItem>
              <SelectItem value="hourly">Hourly (รายชั่วโมง)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>กฎการคิด OT (อัตราต่อชั่วโมงหลังชั่วโมงปกติ)</Label>
        <Select
          disabled={isSupplementalContract}
          value={otKey}
          onValueChange={(v) => {
            const key = v as OvertimeRuleKey;
            const opt = OVERTIME_RULE_OPTIONS.find((o) => o.key === key);
            setNewRate({
              ...newRate,
              overtimeRuleKey: key,
              overtimeRule: opt ? `${opt.label} — ${opt.description}` : key,
            });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OVERTIME_RULE_OPTIONS.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                <span className="font-medium">{o.label}</span>
                <span className="text-muted-foreground"> — {o.description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>หมายเหตุ</Label>
        <Input value={newRate.notes || ''} onChange={(e) => setNewRate({ ...newRate, notes: e.target.value })} />
      </div>
    </div>
  );
}
