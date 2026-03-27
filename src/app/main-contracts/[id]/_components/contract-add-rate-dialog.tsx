'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import type { PositionRate, Position, MainContract } from '@/lib/types';

type RatePolicy = NonNullable<MainContract['rateMultiplierPolicy']>;

interface ContractAddRateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newRate: Partial<PositionRate>;
  setNewRate: (rate: Partial<PositionRate>) => void;
  sellSpecialDaysText: string;
  setSellSpecialDaysText: (text: string) => void;
  costSpecialDaysText: string;
  setCostSpecialDaysText: (text: string) => void;
  allPositions: Position[] | null;
  effectiveRatePolicy: RatePolicy;
  canEditSellSide: boolean;
  canEditCostSide: boolean;
  canViewCostFields: boolean;
  isSupplementalContract: boolean;
  contractStatusActive: boolean;
  onAddRate: () => void;
}

export function ContractAddRateDialog({
  open,
  onOpenChange,
  newRate,
  setNewRate,
  sellSpecialDaysText,
  setSellSpecialDaysText,
  costSpecialDaysText,
  setCostSpecialDaysText,
  allPositions,
  effectiveRatePolicy,
  canEditSellSide,
  canEditCostSide,
  canViewCostFields,
  isSupplementalContract,
  contractStatusActive,
  onAddRate,
}: ContractAddRateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2" disabled={contractStatusActive}>
          <Plus className="h-4 w-4" /> เพิ่มอัตราราคา
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>กำหนดอัตราราคาใหม่</DialogTitle>
          <DialogDescription>เลือกตำแหน่งและระบุราคาตามเงื่อนไขสัญญา</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>ตำแหน่งงาน (Position)</Label>
            <Select onValueChange={v => setNewRate({...newRate, positionId: v})} value={newRate.positionId}>
              <SelectTrigger><SelectValue placeholder="เลือกตำแหน่ง..." /></SelectTrigger>
              <SelectContent>
                {allPositions?.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.positionName || p.positionNameTh}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>ราคาขาย (Sell Rate)</Label>
              <Input
                type="number"
                disabled={!canEditSellSide || isSupplementalContract}
                value={newRate.sellRate}
                onChange={e => setNewRate({...newRate, sellRate: parseFloat(e.target.value)})}
              />
            </div>
            {canViewCostFields && (
              <div className="grid gap-2">
                <Label>ต้นทุนอ้างอิง (Cost Baseline)</Label>
                <Input
                  type="number"
                  disabled={!canEditCostSide || isSupplementalContract}
                  value={newRate.costBaseline}
                  onChange={e => setNewRate({...newRate, costBaseline: parseFloat(e.target.value)})}
                />
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label>ชั่วโมงงานปกติ/วัน (Normal Hours)</Label>
            <Select disabled={isSupplementalContract} onValueChange={v => setNewRate({...newRate, normalWorkHours: Number(v) as 8 | 12})} value={String(newRate.normalWorkHours || 8)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="8">8 ชั่วโมง</SelectItem>
                <SelectItem value="12">12 ชั่วโมง</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>หน่วยการคิดเงิน</Label>
              <Select onValueChange={v => setNewRate({...newRate, billingUnit: v as any})} value={newRate.billingUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily (รายวัน)</SelectItem>
                  <SelectItem value="monthly">Monthly (รายเดือน)</SelectItem>
                  <SelectItem value="hourly">Hourly (รายชั่วโมง)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>กฎการคิดโอที (OT Rule)</Label>
              <Input value={newRate.overtimeRule} onChange={e => setNewRate({...newRate, overtimeRule: e.target.value})} />
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-2">
            <p className="font-semibold text-foreground">กฎตัวคูณ OT/วันหยุด ของสัญญาฉบับนี้จะถูกใช้กับเรทตำแหน่งอัตโนมัติ</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-muted-foreground">
              <div>
                <p>ฝั่งขาย: OT {Number(effectiveRatePolicy.sell.otAfterShift ?? 1.5)}x, วันหยุด {Number(effectiveRatePolicy.sell.holiday ?? 1)}x, นขต. {Number(effectiveRatePolicy.sell.publicHoliday ?? 1)}x, อาทิตย์ {Number(effectiveRatePolicy.sell.sunday ?? 1)}x, OT อาทิตย์ {Number(effectiveRatePolicy.sell.sundayOt ?? 1.5)}x</p>
              </div>
              {canViewCostFields && (
                <div>
                  <p>ฝั่งต้นทุน: OT {Number(effectiveRatePolicy.cost.otAfterShift ?? 1.5)}x, วันหยุด {Number(effectiveRatePolicy.cost.holiday ?? 1)}x, นขต. {Number(effectiveRatePolicy.cost.publicHoliday ?? 1)}x, อาทิตย์ {Number(effectiveRatePolicy.cost.sunday ?? 1)}x, OT อาทิตย์ {Number(effectiveRatePolicy.cost.sundayOt ?? 1.5)}x</p>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>วันพิเศษฝั่งขาย (คั่นด้วย , หรือขึ้นบรรทัด)</Label>
              <Textarea
                disabled={!canEditSellSide || isSupplementalContract}
                value={sellSpecialDaysText}
                onChange={e => setSellSpecialDaysText(e.target.value)}
                placeholder="เช่น Sunday Off, Songkran Day 1"
              />
            </div>
            {canViewCostFields && (
              <div className="grid gap-2">
                <Label>วันพิเศษฝั่งต้นทุน</Label>
                <Textarea
                  disabled={!canEditCostSide || isSupplementalContract}
                  value={costSpecialDaysText}
                  onChange={e => setCostSpecialDaysText(e.target.value)}
                  placeholder="เช่น Sunday OT, Travel Day"
                />
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label>หมายเหตุ</Label>
            <Input value={newRate.notes || ''} onChange={e => setNewRate({...newRate, notes: e.target.value})} />
          </div>
        </div>
        <DialogFooter className="sticky bottom-0 bg-background pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button
            onClick={onAddRate}
            disabled={
              !newRate.positionId
              || (!canEditSellSide && !canEditCostSide)
              || (canEditSellSide && !newRate.sellRate)
              || (canEditCostSide && !newRate.costBaseline)
            }
          >
            บันทึกอัตราราคา
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
