'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import type { PositionRate, Position, ContractMobDemobLocation } from '@/lib/types';
import { legacySellRateMirror } from '@/lib/commercial/position-rate-sell';
import { hasSellPricing } from '@/lib/commercial/position-rate-matrix';
import { PositionRateFormFields } from './position-rate-form-fields';

interface ContractAddRateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newRate: Partial<PositionRate>;
  setNewRate: (rate: Partial<PositionRate>) => void;
  /** ตรวจตำแหน่งซ้ำในสัญญาเมื่อเลือกจาก dropdown */
  onAddPositionIdChange?: (positionId: string) => void;
  allPositions: Position[] | null;
  mobDemobLocations: ContractMobDemobLocation[];
  canEditSellSide: boolean;
  canEditCostSide: boolean;
  canViewCostFields: boolean;
  isSupplementalContract: boolean;
  canAddRates: boolean;
  onAddRate: () => void;
}

export function ContractAddRateDialog({
  open,
  onOpenChange,
  newRate,
  setNewRate,
  onAddPositionIdChange,
  allPositions,
  mobDemobLocations,
  canEditSellSide,
  canEditCostSide,
  canViewCostFields,
  isSupplementalContract,
  canAddRates,
  onAddRate,
}: ContractAddRateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2" disabled={!canAddRates}>
          <Plus className="h-4 w-4" /> เพิ่มอัตราราคา
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>กำหนดอัตราราคาใหม่</DialogTitle>
          <DialogDescription>
            วันหยุดทั้งสัญญากำหนดที่แท็บข้อมูลสัญญาหลัก — ที่นี่เฉพาะราคา ชม.ปกติ หน่วย และกฎ OT ต่อตำแหน่ง
          </DialogDescription>
        </DialogHeader>

        <PositionRateFormFields
          newRate={newRate}
          setNewRate={setNewRate}
          onAddPositionIdChange={onAddPositionIdChange}
          allPositions={allPositions}
          mobDemobLocations={mobDemobLocations}
          canEditSellSide={canEditSellSide}
          canEditCostSide={canEditCostSide}
          canViewCostFields={canViewCostFields}
          isSupplementalContract={isSupplementalContract}
          positionMode="add"
        />

        <DialogFooter className="sticky bottom-0 bg-background pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button
            onClick={onAddRate}
            disabled={
              !newRate.positionId ||
              (!canEditSellSide && !canEditCostSide) ||
              (canEditSellSide && !hasSellPricing(newRate))
            }
          >
            บันทึกอัตราราคา
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
