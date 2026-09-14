'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export type WorkerLineSummaryCardsProps = {
  isSupplementalBatch: boolean;
  grossAmount: number;
  pageIncomeTotal: number;
  priorPaidGrossTotal: number;
  priorPaidNetTotal: number;
  lineNetAmount: number;
  displayNetPay: number;
};

/** Top Gross / รวมรายได้ / Net cards — presentational only. */
export function WorkerLineSummaryCards({
  isSupplementalBatch,
  grossAmount,
  pageIncomeTotal,
  priorPaidGrossTotal,
  priorPaidNetTotal,
  lineNetAmount,
  displayNetPay,
}: WorkerLineSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase text-muted-foreground">
            {isSupplementalBatch ? 'Gross (ยอดตกเบิกในงวด)' : 'Gross (ยอดบันทึกในงวด)'}
          </CardTitle>
          <CardDescription className="text-[11px] leading-snug text-muted-foreground">
            {isSupplementalBatch
              ? 'เฉพาะรายได้ตกเบิกที่กำลังจ่าย — ไม่รวมเงินเดือนงวดปกติที่จ่ายแล้ว'
              : 'จากตอนสร้างงวด (เริ่มการประมวลผล) — เปิดหน้านี้ไม่คำนวณซ้ำ'}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-2xl font-black text-primary">
          ฿{grossAmount.toLocaleString()}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase text-muted-foreground">รวมรายได้ (ตรงสลิป)</CardTitle>
          <CardDescription className="text-[11px] text-muted-foreground">
            {isSupplementalBatch
              ? 'ยอดตกเบิกที่บันทึกในงวดนี้เท่านั้น (ไม่รวมเงินเดือนงวดปกติที่จ่ายแล้ว)'
              : priorPaidGrossTotal > 0.005
                ? 'Gross งวด + เบี้ยเลี้ยง + รายได้ตกเบิกที่จ่ายแล้วต้นเดือน'
                : 'Gross งวด + รายการเบี้ยเลี้ยงในฟอร์ม (preview ตอนแก้)'}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-2xl font-black text-primary">
          ฿{pageIncomeTotal.toLocaleString()}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase text-muted-foreground">Net (ยอดตรงสลิป)</CardTitle>
          <CardDescription className="text-[11px] leading-snug">
            {isSupplementalBatch
              ? `สุทธิการจ่ายตกเบิกครั้งนี้ · บันทึกในงวด ฿${lineNetAmount.toLocaleString()}`
              : priorPaidNetTotal > 0.005
                ? `หลังหักยอดที่ชำระไปแล้ว ฿${priorPaidNetTotal.toLocaleString()} · บันทึกในงวด ฿${lineNetAmount.toLocaleString()}`
                : `ตรงกับหน้า batch / สลิป · ฿${lineNetAmount.toLocaleString()}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-2xl font-black text-emerald-700 flex items-center gap-2 min-h-[2.5rem]">
          <>฿{displayNetPay.toLocaleString()}</>
        </CardContent>
      </Card>
    </div>
  );
}
