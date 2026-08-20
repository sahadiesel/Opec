'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** ตั้งค่าหัก ณ ที่จ่ายบน PR (งานจ้างเหมา / SERVICE) — คัดลอกไป PO ตอนสร้าง */
export function PurchaseRequestWhtCard({
  enabled,
  rateInput,
  onEnabledChange,
  onRateChange,
  readOnly,
}: {
  enabled: boolean;
  rateInput: string;
  onEnabledChange: (v: boolean) => void;
  onRateChange: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">หัก ณ ที่จ่าย (งานจ้างเหมา)</CardTitle>
        <CardDescription>
          ตั้งตอนทำ PR — เมื่อสร้าง PO ระบบจะคัดลอกอัตโนมัติ (แก้ทีหลังได้ที่ PO หากลืมตั้งตอน PR)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {readOnly ? (
          <p className="text-sm">
            {enabled && (Number(rateInput) || 0) > 0 ? (
              <>
                <span className="font-medium text-foreground">เปิดใช้</span>
                <span className="text-muted-foreground"> · อัตรา {rateInput}%</span>
              </>
            ) : (
              <span className="text-muted-foreground">ไม่หัก ณ ที่จ่ายตาม PR นี้</span>
            )}
          </p>
        ) : (
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
): {
  supplierWithholdingEnabled: boolean;
  supplierWithholdingRatePercent: number | null;
} {
  if (lineEntryMode !== 'SERVICE' || !enabled) {
    return { supplierWithholdingEnabled: false, supplierWithholdingRatePercent: null };
  }
  const rate = parsePrWhtRatePercent(rateInput);
  if (rate == null) {
    return { supplierWithholdingEnabled: false, supplierWithholdingRatePercent: null };
  }
  return { supplierWithholdingEnabled: true, supplierWithholdingRatePercent: rate };
}
