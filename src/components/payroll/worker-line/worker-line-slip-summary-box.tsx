'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  allowanceItemsTotal,
  deductionDisplayRows,
  lineDeductionsTotal,
} from '@/lib/payroll/payslip-deduction-display';
import type { PayslipViewModel } from '@/lib/payroll/payslip-model';
import type { PayrollBatchLine } from '@/lib/types';

export type WorkerLineSlipSummaryBoxProps = {
  isSupplementalBatch: boolean;
  line: PayrollBatchLine;
  displaySlip: PayslipViewModel | null | undefined;
  pageIncomeTotal: number;
  priorPaidGrossTotal: number;
  previewNet: number | null | undefined;
  canSaveAdjustments: boolean;
  saving: boolean;
  onSave: () => void;
};

/** Amber sticky “รวมรายได้ (ตรงสลิป)” summary + save — presentational only. */
export function WorkerLineSlipSummaryBox({
  isSupplementalBatch,
  line,
  displaySlip,
  pageIncomeTotal,
  priorPaidGrossTotal,
  previewNet,
  canSaveAdjustments,
  saving,
  onSave,
}: WorkerLineSlipSummaryBoxProps) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/50 p-4 text-sm space-y-3">
      <div className="flex justify-between gap-4 font-medium">
        <span>รวมรายได้ (ตรงสลิป)</span>
        <span className="font-mono tabular-nums text-primary">
          ฿{(displaySlip?.grossTotal ?? pageIncomeTotal).toLocaleString()}
        </span>
      </div>
      {(allowanceItemsTotal(line) > 0.005 ||
        (!isSupplementalBatch && priorPaidGrossTotal > 0.005)) && (
        <div className="space-y-1 text-[11px] text-muted-foreground border-t border-amber-200/60 pt-2">
          {allowanceItemsTotal(line) > 0.005 ? (
            <div className="flex justify-between gap-4">
              <span>ในนั้น · เบี้ยเลี้ยง / รายได้พิเศษ</span>
              <span className="font-mono tabular-nums">
                ฿{allowanceItemsTotal(line).toLocaleString()}
              </span>
            </div>
          ) : null}
          {!isSupplementalBatch && priorPaidGrossTotal > 0.005 ? (
            <div className="flex justify-between gap-4">
              <span>ในนั้น · รายได้ตกเบิกที่จ่ายแล้ว</span>
              <span className="font-mono tabular-nums">
                ฿{priorPaidGrossTotal.toLocaleString()}
              </span>
            </div>
          ) : null}
        </div>
      )}
      <div className="space-y-1.5 border-t border-amber-200/80 pt-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          รายการหัก (ตรงสลิป)
        </p>
        {(displaySlip?.deductionLines?.length
          ? displaySlip.deductionLines
          : deductionDisplayRows(line, { isSupplemental: isSupplementalBatch }).map((r) => ({
              label: r.label,
              amount: r.amount,
            }))
        ).map((row, i) => (
          <div key={`${row.label}-${i}`} className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-mono tabular-nums">−฿{row.amount.toLocaleString()}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between gap-4 border-t border-amber-200/80 pt-3 font-medium">
        <span>
          {isSupplementalBatch ? 'หักรวม (ของการจ่ายตกเบิกครั้งนี้)' : 'หักรวม (รวมหักยอดที่ชำระไปแล้ว)'}
        </span>
        <span className="font-mono tabular-nums">
          ฿
          {(
            displaySlip?.deductionsTotal ??
            lineDeductionsTotal(line)
          ).toLocaleString()}
        </span>
      </div>
      <div className="flex justify-between gap-4 border-t border-amber-200/80 pt-3 font-black text-emerald-800">
        <span>{isSupplementalBatch ? 'รับสุทธิการตกเบิก (ตรงสลิป)' : 'รับสุทธิ (ตรงสลิป)'}</span>
        <span className="font-mono tabular-nums">
          ฿{(displaySlip?.netPay ?? previewNet ?? line.netAmount).toLocaleString()}
        </span>
      </div>
      {displaySlip ? (
        <p className="text-[11px] text-muted-foreground leading-snug pt-1">
          ตรวจเลข: รายได้ ฿{displaySlip.grossTotal.toLocaleString()} − หัก ฿
          {displaySlip.deductionsTotal.toLocaleString()} = สุทธิ ฿
          {displaySlip.netPay.toLocaleString()}
          {isSupplementalBatch
            ? ' · ยอดตกเบิกครั้งนี้เท่านั้น (ไม่ปนเงินเดือนงวดปกติที่จ่ายแล้ว)'
            : displaySlip.deductionLines.some((d) => d.label.includes('หักยอดที่ชำระไปแล้ว'))
              ? ' (หักรวมรวมยอดที่บัญชีจ่ายไปแล้วในงวดก่อนของเดือนเดียวกัน)'
              : ''}
        </p>
      ) : null}
      <Button
        type="button"
        className="w-full"
        disabled={!canSaveAdjustments || saving}
        onClick={onSave}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        บันทึกการปรับยอด
      </Button>
    </div>
  );
}
