'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import { formatPriorPeriodAllowancePayslipLabel } from '@/lib/payroll/prior-period-allowance';
import type { PriorPaidPayrollSlipRef } from '@/lib/payroll/payslip-model';
import type { PayrollBatch, PayrollBatchLine } from '@/lib/types';

export type WorkerLinePriorPaidReferenceProps = {
  isSupplementalBatch: boolean;
  normalBatch: PayrollBatch | null;
  normalLine: PayrollBatchLine | null;
  /** From displaySlip?.normalPaymentDateLabel when available */
  normalPaymentDateLabel?: string | null;
  priorPaidRefs: readonly PriorPaidPayrollSlipRef[];
};

/**
 * Supplemental “อ้างอิง — งวดปกติที่จ่ายแล้ว” card and/or
 * NORMAL priorPaidRefs “รายได้ตกเบิก / งวดที่จ่ายแล้วต้นเดือน” card.
 * Presentational only — same labels and display mapping as the page.
 */
export function WorkerLinePriorPaidReference({
  isSupplementalBatch,
  normalBatch,
  normalLine,
  normalPaymentDateLabel,
  priorPaidRefs,
}: WorkerLinePriorPaidReferenceProps) {
  return (
    <>
      {isSupplementalBatch && normalBatch && normalLine ? (
        <Card className="border-slate-200 bg-slate-50/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-slate-900">อ้างอิง — งวดปกติที่จ่ายแล้ว</CardTitle>
            <CardDescription className="text-slate-700">
              ข้อมูลประกอบเท่านั้น — ไม่รวมใน Gross / รายการหัก / Net ของการจ่ายตกเบิกครั้งนี้
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="font-mono text-muted-foreground">{normalBatch.id}</span>
              <span>
                จ่ายแล้ว{' '}
                {normalPaymentDateLabel ||
                  (normalLine.financePaidAt
                    ? new Date(normalLine.financePaidAt).toLocaleDateString('th-TH')
                    : '—')}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
              <span>
                Gross งวดปกติ ฿{Number(normalLine.grossAmount || 0).toLocaleString()}
              </span>
              <span>Net ที่จ่ายแล้ว ฿{Number(normalLine.netAmount || 0).toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {priorPaidRefs.length > 0 && !isSupplementalBatch && (
        <Card className="border-sky-200 bg-sky-50/40">
          <CardHeader>
            <CardTitle className="text-base text-sky-950">
              รายได้ตกเบิก / งวดที่จ่ายแล้วต้นเดือน
            </CardTitle>
            <CardDescription className="text-sky-900/80">
              รวมตกเบิกเดือนก่อนที่จ่ายในเดือนนี้ และงวดปกติที่จ่ายไปแล้ว — เป็นรายรับของเดือนเดียวกัน · สลิปรอบนี้หักสุทธิงวดนั้นออก
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {priorPaidRefs.map((ref) => {
              const retro = (ref.line.hrLineAdjustments?.priorPeriodAllowanceItems ?? []).filter(
                (it) => Number(it.amount) > 0,
              );
              const days = ref.line.dailyRowSnapshots ?? [];
              const byId = ref.line.timesheetGrossById ?? {};
              const dayEntries =
                days.length > 0
                  ? days.map((d) => ({
                      date: d.date,
                      eventType: d.eventType,
                      amount: Number(d.amount) || 0,
                    }))
                  : Object.entries(byId).map(([id, amount]) => ({
                      date: id,
                      eventType: 'timesheet',
                      amount: Number(amount) || 0,
                    }));
              return (
                <div key={ref.batch.id} className="rounded-md border border-sky-200 bg-white p-3 space-y-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="font-mono text-muted-foreground">{ref.batch.id}</span>
                    <span>
                      Gross ฿{Number(ref.line.grossAmount || 0).toLocaleString()} · Net ฿
                      {Number(ref.line.netAmount || 0).toLocaleString()}
                    </span>
                  </div>
                  {retro.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-sky-900 mb-1">OT / รายได้ย้อนหลังในงวดนั้น</p>
                      <ul className="text-sm space-y-1">
                        {retro.map((it, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>{formatPriorPeriodAllowancePayslipLabel(it)}</span>
                            <span className="tabular-nums font-medium">
                              ฿{Number(it.amount).toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {dayEntries.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-sky-900 mb-1">รายวันที่จ่ายในงวดนั้น</p>
                      <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
                        {dayEntries.map((d, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>
                              {/^\d{4}-\d{2}-\d{2}$/.test(d.date)
                                ? formatYmdLocalThaiBE(d.date)
                                : d.date}{' '}
                              · {d.eventType}
                            </span>
                            <span className="tabular-nums">฿{d.amount.toLocaleString()}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {retro.length === 0 && dayEntries.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      ไม่มีรายละเอียดรายวัน/ตกเบิกใน snapshot งวดนี้ — ยังหักสุทธิ ฿
                      {Number(ref.line.netAmount || 0).toLocaleString()} จากสลิปรอบหลัง
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </>
  );
}
