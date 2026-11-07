'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  QUOTATION_CREDIT_COUNT_FROM_OPTIONS,
  formatQuotationPaymentTermLine,
  type QuotationPaymentDraft,
} from '@/lib/commercial/quotation-payment-term';
import type { QuotationCreditCountFrom, QuotationPaymentKind } from '@/lib/types';
import { cn } from '@/lib/utils';

export function QuotationPaymentTermFields({
  value,
  onChange,
  disabled,
}: {
  value: QuotationPaymentDraft;
  onChange: (next: QuotationPaymentDraft) => void;
  disabled?: boolean;
}) {
  const kind = value.paymentKind;
  const printed = formatQuotationPaymentTermLine(value, 'th');

  const setKind = (next: QuotationPaymentKind) => {
    if (next === 'cash') {
      onChange({ paymentKind: 'cash' });
      return;
    }
    onChange({
      paymentKind: 'credit',
      paymentCreditDays: value.paymentCreditDays,
      paymentCountFrom: value.paymentCountFrom,
      paymentCountFromCustom: value.paymentCountFromCustom,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setKind('cash')}
          className={cn(
            'h-10 rounded-md border px-4 text-sm font-medium',
            kind === 'cash' ? 'border-primary bg-primary text-primary-foreground' : 'bg-background',
            disabled && 'pointer-events-none opacity-60',
          )}
        >
          เงินสด (Cash)
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setKind('credit')}
          className={cn(
            'h-10 rounded-md border px-4 text-sm font-medium',
            kind === 'credit' ? 'border-primary bg-primary text-primary-foreground' : 'bg-background',
            disabled && 'pointer-events-none opacity-60',
          )}
        >
          เครดิต (Credit)
        </button>
      </div>

      {kind === 'credit' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>จำนวนวัน</Label>
            <Input
              type="number"
              min={1}
              step={1}
              disabled={disabled}
              value={value.paymentCreditDays ?? ''}
              placeholder="เช่น 30"
              onChange={(e) => {
                const raw = e.target.value;
                onChange({
                  ...value,
                  paymentKind: 'credit',
                  paymentCreditDays: raw === '' ? undefined : Number(raw),
                });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>นับจาก</Label>
            <Select
              disabled={disabled}
              value={value.paymentCountFrom || undefined}
              onValueChange={(v) =>
                onChange({
                  ...value,
                  paymentKind: 'credit',
                  paymentCountFrom: v as QuotationCreditCountFrom,
                  paymentCountFromCustom: v === 'custom' ? value.paymentCountFromCustom : undefined,
                })
              }
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="นับจาก..." />
              </SelectTrigger>
              <SelectContent>
                {QUOTATION_CREDIT_COUNT_FROM_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.th}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {value.paymentCountFrom === 'custom' ? (
            <div className="space-y-2 sm:col-span-2">
              <Label>ระบุว่านับจากอะไร</Label>
              <Input
                disabled={disabled}
                value={value.paymentCountFromCustom || ''}
                placeholder="เช่น วันที่ลูกค้าตรวจรับงาน"
                onChange={(e) =>
                  onChange({
                    ...value,
                    paymentKind: 'credit',
                    paymentCountFrom: 'custom',
                    paymentCountFromCustom: e.target.value,
                  })
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        {printed ? `พิมพ์ในเอกสาร: ${printed}` : 'ยังไม่ระบุการจ่ายเงิน — เอกสารจะไม่เพิ่มบรรทัดนี้'}
      </p>
    </div>
  );
}
