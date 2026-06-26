'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ContractMobDemobLocation } from '@/lib/types';
import {
  DEFAULT_MOB_DEMOB_LOCATIONS,
  sanitizeMobDemobLocations,
} from '@/lib/commercial/position-rate-matrix';
import { Plus, Trash2 } from 'lucide-react';

export interface ContractMobDemobLocationsSectionProps {
  locations: ContractMobDemobLocation[];
  onChange: (locations: ContractMobDemobLocation[]) => void;
  disabled?: boolean;
  showSaveButton?: boolean;
  onSave?: () => void;
  saveLabel?: string;
}

export function ContractMobDemobLocationsSection({
  locations,
  onChange,
  disabled = false,
  showSaveButton = false,
  onSave,
  saveLabel = 'บันทึกจุด Mob/Demob',
}: ContractMobDemobLocationsSectionProps) {
  const sorted = [...locations].sort((a, b) => a.displayOrder - b.displayOrder);

  const updateRow = (index: number, patch: Partial<ContractMobDemobLocation>) => {
    const next = sorted.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(sanitizeMobDemobLocations(next) ?? next);
  };

  const removeRow = (index: number) => {
    const next = sorted.filter((_, i) => i !== index).map((row, i) => ({ ...row, displayOrder: i + 1 }));
    onChange(next);
  };

  const addRow = () => {
    const nextOrder = sorted.length > 0 ? Math.max(...sorted.map((r) => r.displayOrder)) + 1 : 1;
    onChange([
      ...sorted,
      { key: `location_${nextOrder}`, label: 'Mob/Demob @ …', displayOrder: nextOrder },
    ]);
  };

  const applyDefaultSet = () => {
    onChange(DEFAULT_MOB_DEMOB_LOCATIONS.map((loc) => ({ ...loc })));
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/10 p-4">
      <div>
        <Label className="text-base font-semibold">จุด Mob/Demob (คอลัมน์ Rate Sheet)</Label>
        <p className="text-xs text-muted-foreground mt-1">
          กำหนดจุดขึ้น-ลงเรือ/ฐานที่ใช้ในตารางราคาต่อตำแหน่ง — แต่ละสัญญาอาจมีชุดจุดต่างกัน
        </p>
      </div>

      <div className="space-y-2">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีจุด Mob/Demob — ใช้ชุดมาตรฐานหรือเพิ่มเอง</p>
        ) : (
          sorted.map((loc, index) => (
            <div key={`${loc.key}-${index}`} className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr_auto] gap-2 items-end">
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Key (อ้างอิงในระบบ)</Label>
                <Input
                  disabled={disabled}
                  value={loc.key}
                  onChange={(e) => updateRow(index, { key: e.target.value })}
                  placeholder="songkhla"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">ชื่อแสดงในตาราง</Label>
                <Input
                  disabled={disabled}
                  value={loc.label}
                  onChange={(e) => updateRow(index, { label: e.target.value })}
                  placeholder="Mob/Demob @ Songkhla"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                onClick={() => removeRow(index)}
                aria-label="ลบจุด"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addRow} className="gap-1">
          <Plus className="h-4 w-4" /> เพิ่มจุด
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={applyDefaultSet}>
          ใช้ชุดมาตรฐาน Thai Nippon (3 จุด)
        </Button>
        {showSaveButton && onSave && (
          <Button type="button" size="sm" disabled={disabled} onClick={onSave}>
            {saveLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
