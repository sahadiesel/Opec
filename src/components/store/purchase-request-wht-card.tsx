'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { VendorBillWhtPresetCategory } from '@/lib/types';
import {
  SUPPLIER_WHT_CATEGORY_OPTIONS,
  isSupplierWithholdingCategory,
  supplierWhtCategoryDefaultRate,
  supplierWhtCategoryLabel,
  type SupplierWithholdingCategory,
} from '@/lib/ops/supplier-wht-category';

/** ตั้งค่าหัก ณ ที่จ่ายบน PR — ประเภท + % คัดลอกไป PO; บัญชียังแก้ได้ตอนทำจ่าย */
export function PurchaseRequestWhtCard({
  enabled,
  category,
  rateInput,
  onEnabledChange,
  onCategoryChange,
  onRateChange,
  readOnly,
}: {
  enabled: boolean;
  category: SupplierWithholdingCategory;
  rateInput: string;
  onEnabledChange: (v: boolean) => void;
  onCategoryChange: (v: SupplierWithholdingCategory) => void;
  onRateChange: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">หัก ณ ที่จ่าย</CardTitle>
        <CardDescription>
          เลือกประเภท (จ้างเหมา / งานบริการ / ค่าเช่า) และอัตรา % ตอนทำ PR — คัดลอกไป PO อัตโนมัติ ·
          ถ้าตั้งผิด ฝ่ายบัญชีแก้ได้ตอนทำจ่ายใบวางบิล เพื่อให้ใบหัก ณ ที่จ่ายตรงกับสรรพากร
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {readOnly ? (
          <p className="text-sm">
            {enabled && (Number(rateInput) || 0) > 0 ? (
              <>
                <span className="font-medium text-foreground">เปิดใช้</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {supplierWhtCategoryLabel(category)} · อัตรา {rateInput}%
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">ไม่หัก ณ ที่จ่ายตาม PR นี้</span>
            )}
          </p>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Switch id="pr-wht-enabled" checked={enabled} onCheckedChange={onEnabledChange} />
                <Label htmlFor="pr-wht-enabled" className="cursor-pointer">
                  ใช้การคำนวณหัก ณ ที่จ่ายตามยอด (คัดลอกไป PO)
                </Label>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pr-wht-rate">อัตรา (%)</Label>
                <Input
                  id="pr-wht-rate"
                  className="w-24"
                  inputMode="decimal"
                  disabled={!enabled}
                  value={rateInput}
                  onChange={(e) => onRateChange(e.target.value)}
                />
              </div>
            </div>
            {enabled ? (
              <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <p className="text-xs font-semibold text-muted-foreground">ประเภทเงินได้</p>
                <RadioGroup
                  value={category}
                  onValueChange={(v) => {
                    if (!isSupplierWithholdingCategory(v)) return;
                    onCategoryChange(v);
                    onRateChange(String(supplierWhtCategoryDefaultRate(v)));
                  }}
                  className="gap-2"
                  disabled={!enabled}
                >
                  {SUPPLIER_WHT_CATEGORY_OPTIONS.map((opt) => (
                    <label
                      key={opt.id}
                      className="flex cursor-pointer items-start gap-3 rounded-md border border-muted bg-background px-3 py-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem value={opt.id} id={`pr-wht-cat-${opt.id}`} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-tight">{opt.title}</span>
                        <span className="text-xs text-muted-foreground">{opt.detail}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function parsePrWhtRatePercent(rateInput: string): number | null {
  const r = parseFloat(String(rateInput).replace(',', '.'));
  if (!Number.isFinite(r) || r <= 0 || r > 100) return null;
  return r;
}

export function prWhtPersistFields(
  lineEntryMode: string,
  enabled: boolean,
  rateInput: string,
  category: SupplierWithholdingCategory,
): {
  supplierWithholdingEnabled: boolean;
  supplierWithholdingRatePercent: number | null;
  supplierWithholdingCategory: VendorBillWhtPresetCategory | null;
} {
  if (lineEntryMode !== 'SERVICE' || !enabled) {
    return {
      supplierWithholdingEnabled: false,
      supplierWithholdingRatePercent: null,
      supplierWithholdingCategory: null,
    };
  }
  const rate = parsePrWhtRatePercent(rateInput);
  if (rate == null) {
    return {
      supplierWithholdingEnabled: false,
      supplierWithholdingRatePercent: null,
      supplierWithholdingCategory: null,
    };
  }
  return {
    supplierWithholdingEnabled: true,
    supplierWithholdingRatePercent: rate,
    supplierWithholdingCategory: category,
  };
}
