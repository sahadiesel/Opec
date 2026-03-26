'use client';

import type { PayslipViewModel } from '@/lib/payroll/payslip-model';

function money(n: number) {
  return `฿${Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PayslipDocument({ model, className }: { model: PayslipViewModel; className?: string }) {
  return (
    <div
      className={`rounded-lg border border-border bg-card p-6 text-sm shadow-sm print:border print:shadow-none print:bg-white ${className ?? ''}`}
    >
      <div className="border-b border-border pb-3 text-center">
        <h2 className="text-lg font-bold tracking-tight text-primary">สลิปเงินเดือน / Payslip</h2>
        <p className="text-muted-foreground text-xs mt-1">{model.payrollTypeLabel}</p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">ชื่อ</div>
          <div className="font-semibold text-base">{model.employeeName}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">งวด (Period)</div>
          <div>{model.periodLabel}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">เลขที่ Batch / Run</div>
          <div className="font-mono text-xs">{model.documentRef}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">วันที่จ่าย (Payment date)</div>
          <div>{model.paymentDateLabel}</div>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-xs font-bold uppercase text-muted-foreground mb-2">รายได้</div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border/60">
            <tr>
              <td className="py-1.5 text-muted-foreground">ฐาน (Base)</td>
              <td className="py-1.5 text-right tabular-nums font-medium">{money(model.income.base)}</td>
            </tr>
            <tr>
              <td className="py-1.5 text-muted-foreground">OT</td>
              <td className="py-1.5 text-right tabular-nums font-medium">{money(model.income.overtime)}</td>
            </tr>
            <tr>
              <td className="py-1.5 text-muted-foreground">เบี้ยเลี้ยง / Allowance</td>
              <td className="py-1.5 text-right tabular-nums font-medium">{money(model.income.allowance)}</td>
            </tr>
            {(model.income.bonus > 0 || model.income.otherIncome > 0) && (
              <>
                <tr>
                  <td className="py-1.5 text-muted-foreground">โบนัส / Bonus</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{money(model.income.bonus)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-muted-foreground">รายได้อื่น</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{money(model.income.otherIncome)}</td>
                </tr>
              </>
            )}
            <tr className="font-bold text-primary">
              <td className="py-2">รวมรายได้ (Gross)</td>
              <td className="py-2 text-right tabular-nums">{money(model.income.gross)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <div className="text-xs font-bold uppercase text-muted-foreground mb-2">รายการหัก</div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border/60">
            <tr>
              <td className="py-1.5 text-muted-foreground">ประกันสังคม (SSO)</td>
              <td className="py-1.5 text-right tabular-nums text-red-700 dark:text-red-400">
                −{money(model.deductions.socialSecurity)}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-muted-foreground">ภาษี (Tax / PIT)</td>
              <td className="py-1.5 text-right tabular-nums text-red-700 dark:text-red-400">
                −{money(model.deductions.tax)}
              </td>
            </tr>
            {model.deductions.otherLines.map((row) => (
              <tr key={row.label}>
                <td className="py-1.5 text-muted-foreground capitalize">{row.label.replace(/_/g, ' ')}</td>
                <td className="py-1.5 text-right tabular-nums text-red-700 dark:text-red-400">
                  −{money(row.amount)}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2">รวมหัก</td>
              <td className="py-2 text-right tabular-nums text-red-700 dark:text-red-400">
                −{money(model.deductions.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-md bg-primary/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-bold text-primary">รับสุทธิ (Net pay)</span>
          <span className="text-xl font-black tabular-nums text-primary">{money(model.netPay)}</span>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-dashed border-border/80 p-3 text-xs text-muted-foreground leading-relaxed">
        <div className="font-semibold text-foreground mb-1">Policy / engine ที่ใช้ตอน generate</div>
        <p>{model.policyVersionLabel}</p>
      </div>

      <p className="mt-4 text-center text-[10px] text-muted-foreground print:text-gray-500">
        เอกสารนี้อ้างอิง snapshot บน Payroll Line — ไม่คำนวณย้อนหลังจากการตั้งค่าปัจจุบัน
      </p>
    </div>
  );
}
