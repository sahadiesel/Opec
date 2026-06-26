'use client';

import { useEffect, useMemo, useState } from 'react';
import { deleteField } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { PositionRate, Position, MainContract, ContractMobDemobLocation } from '@/lib/types';
import type { OvertimeRuleKey } from '@/lib/contract-position-rate-extras';
import { OVERTIME_RULE_OPTIONS, parseOvertimeRuleKeyFromSnapshot } from '@/lib/contract-position-rate-extras';
import {
  effectiveNormalWorkHoursOffshore,
  effectiveNormalWorkHoursOnshore,
  effectiveSellOnshore,
  effectiveSellOffshore,
  legacySellRateMirror,
  normalizeNormalWorkHoursFields,
} from '@/lib/commercial/position-rate-sell';
import { PositionRateFormFields } from './position-rate-form-fields';
import { preparePositionRateMatrixPayload, sanitizePositionRateMatrix, hasSellPricing } from '@/lib/commercial/position-rate-matrix';

type RatePolicy = NonNullable<MainContract['rateMultiplierPolicy']>;

interface ContractEditRateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rate: PositionRate | null;
  allPositions: Position[] | null;
  mobDemobLocations: ContractMobDemobLocation[];
  effectiveRatePolicy: RatePolicy;
  canEditSellSide: boolean;
  canEditCostSide: boolean;
  canViewCostFields: boolean;
  isSupplementalContract: boolean;
  onSave: (rateId: string, payload: Record<string, unknown>) => void;
}

function rateToFormState(rate: PositionRate): Partial<PositionRate> {
  const otKey = rate.overtimeRuleKey ?? parseOvertimeRuleKeyFromSnapshot(rate.overtimeRule);
  const opt = OVERTIME_RULE_OPTIONS.find((o) => o.key === otKey);

  return {
    positionId: rate.positionId,
    sellRate: rate.sellRate,
    sellRateOnshore: effectiveSellOnshore(rate),
    sellRateOffshore: effectiveSellOffshore(rate),
    billingUnit: rate.billingUnit,
    normalWorkHoursOnshore: effectiveNormalWorkHoursOnshore(rate),
    normalWorkHoursOffshore: effectiveNormalWorkHoursOffshore(rate),
    normalWorkHours: rate.normalWorkHours,
    overtimeRuleKey: otKey,
    overtimeRule: opt ? `${opt.label} — ${opt.description}` : rate.overtimeRule,
    notes: rate.notes || '',
    active: rate.active,
    rateMatrix: rate.rateMatrix,
  };
}

export function ContractEditRateDialog({
  open,
  onOpenChange,
  rate,
  allPositions,
  mobDemobLocations,
  effectiveRatePolicy,
  canEditSellSide,
  canEditCostSide,
  canViewCostFields,
  isSupplementalContract,
  onSave,
}: ContractEditRateDialogProps) {
  const [form, setForm] = useState<Partial<PositionRate>>({});

  useEffect(() => {
    if (!open || !rate) return;
    setForm(rateToFormState(rate));
  }, [open, rate?.id, rate]);

  const positionDisplayName = useMemo(() => {
    if (!rate) return '';
    const p = allPositions?.find((x) => x.id === rate.positionId);
    return (p?.positionName || p?.positionNameTh) || rate.positionId;
  }, [rate, allPositions]);

  const handleSave = () => {
    if (!rate) return;
    const otKey = (form.overtimeRuleKey || parseOvertimeRuleKeyFromSnapshot(rate.overtimeRule)) as OvertimeRuleKey;
    const otOpt = OVERTIME_RULE_OPTIONS.find((o) => o.key === otKey);

    const policySell = effectiveRatePolicy.sell || {};
    const policyCost = effectiveRatePolicy.cost || {};

    const payload: Record<string, unknown> = {
      positionId: rate.positionId,
      costBaseline: deleteField(),
      billingUnit: form.billingUnit || rate.billingUnit,
      ...normalizeNormalWorkHoursFields(form),
      overtimeRuleKey: otKey,
      overtimeRule: form.overtimeRule?.trim() || (otOpt ? `${otOpt.label} — ${otOpt.description}` : otKey),
      sellOtRules: {
        afterShift: Number(policySell.otAfterShift ?? 1.5),
        holiday: Number(policySell.holiday ?? 1),
        publicHoliday: Number(policySell.publicHoliday ?? 1),
        sunday: Number(policySell.sunday ?? 1),
        sundayOt: Number(policySell.sundayOt ?? 1.5),
      },
      costOtRules: {
        afterShift: Number(policyCost.otAfterShift ?? 1.5),
        holiday: Number(policyCost.holiday ?? 1),
        publicHoliday: Number(policyCost.publicHoliday ?? 1),
        sunday: Number(policyCost.sunday ?? 1),
        sundayOt: Number(policyCost.sundayOt ?? 1.5),
      },
      notes: form.notes ?? rate.notes ?? '',
      active: form.active ?? rate.active,
      updatedAt: Date.now(),
    };

    const sanitizedMatrix = sanitizePositionRateMatrix(form.rateMatrix);
    if (sanitizedMatrix) payload.rateMatrix = sanitizedMatrix;
    else payload.rateMatrix = deleteField();

    if (canEditSellSide) {
      const synced = preparePositionRateMatrixPayload(
        { ...rate, ...form, rateMatrix: sanitizedMatrix },
        { syncLegacySell: true },
      );
      const onV =
        synced.sellRateOnshore ??
        (Number.isFinite(Number(form.sellRateOnshore)) && Number(form.sellRateOnshore) > 0
          ? Number(form.sellRateOnshore)
          : undefined);
      const offV =
        synced.sellRateOffshore ??
        (Number.isFinite(Number(form.sellRateOffshore)) && Number(form.sellRateOffshore) > 0
          ? Number(form.sellRateOffshore)
          : undefined);
      payload.sellRateOnshore = onV != null ? onV : deleteField();
      payload.sellRateOffshore = offV != null ? offV : deleteField();
      payload.sellRate = legacySellRateMirror({
        sellRate: rate.sellRate,
        sellRateOnshore: onV,
        sellRateOffshore: offV,
      });
    } else {
      payload.sellRate = rate.sellRate;
    }

    onSave(rate.id, payload);
    onOpenChange(false);
  };

  const saveDisabled =
    !rate ||
    (!canEditSellSide && !canEditCostSide) ||
    (canEditSellSide && !hasSellPricing(form));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>แก้ไขอัตราราคาตำแหน่ง</DialogTitle>
          <DialogDescription>
            วันหยุดสัญญากำหนดที่แท็บข้อมูลสัญญาหลัก — แก้ที่นี่เฉพาะราคา ชม.ปกติ หน่วย และกฎ OT
          </DialogDescription>
        </DialogHeader>

        {rate && (
          <PositionRateFormFields
            newRate={form}
            setNewRate={setForm}
            allPositions={allPositions}
            mobDemobLocations={mobDemobLocations}
            canEditSellSide={canEditSellSide}
            canEditCostSide={canEditCostSide}
            canViewCostFields={canViewCostFields}
            isSupplementalContract={isSupplementalContract}
            positionMode="edit"
            positionDisplayName={positionDisplayName}
          />
        )}

        <DialogFooter className="sticky bottom-0 bg-background pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={saveDisabled}>
            บันทึกการแก้ไข
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
