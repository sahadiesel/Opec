'use client';

import type { PayslipViewModel } from '@/lib/payroll/payslip-model';

const PAYSLIP_STYLES = `
.payslip-root { font-family: "Sarabun", "Segoe UI", system-ui, sans-serif; color: #111827; font-size: 13px; line-height: 1.45; max-width: min(100%, 52rem); margin: 0 auto; background: #fff; }
.payslip-root * { box-sizing: border-box; }
.payslip-head { border-bottom: 3px solid #0f766e; padding-bottom: 14px; margin-bottom: 18px; }
.payslip-header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.payslip-header-solo { display: block; }
.payslip-header-solo .payslip-header-brand { width: 100%; padding-left: 0; }
.payslip-logo-box { flex: 0 0 auto; width: 1in; height: 1in; border: none; background: transparent; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.payslip-logo-box img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.payslip-header-brand { flex: 1; min-width: 0; text-align: right; padding-left: 8px; }
.payslip-brand-th { font-size: 20px; font-weight: 800; color: #0f766e; letter-spacing: -0.02em; }
.payslip-brand-en { font-size: 12px; color: #64748b; margin-top: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
.payslip-title { font-size: 18px; font-weight: 800; margin: 10px 0 4px; color: #111; }
.payslip-sub { font-size: 11px; color: #64748b; margin: 0; }
.payslip-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin-bottom: 18px; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
.payslip-meta dt { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin: 0 0 2px; }
.payslip-meta dd { margin: 0; font-weight: 600; color: #0f172a; font-size: 13px; }
.payslip-meta dd.mono { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 500; }
.payslip-section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #0f766e; margin: 0 0 8px; padding-bottom: 4px; border-bottom: 1px solid #ccfbf1; }
.payslip-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
.payslip-table th, .payslip-table td { padding: 8px 10px; text-align: left; vertical-align: top; }
.payslip-table thead th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; }
.payslip-table tbody td { border-bottom: 1px solid #f1f5f9; }
.payslip-table tbody tr:last-child td { border-bottom: none; }
.payslip-table td.amt { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.payslip-table td.lbl { color: #334155; }
.payslip-total-row td { padding-top: 10px; padding-bottom: 10px; font-weight: 800; background: #ecfdf5; color: #0f766e; border-top: 2px solid #99f6e4; border-bottom: none; }
.payslip-net { margin-top: 16px; padding: 14px 16px; border-radius: 10px; background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 1px solid #6ee7b7; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.payslip-net-label { font-size: 15px; font-weight: 800; color: #065f46; }
.payslip-net-amt { font-size: 22px; font-weight: 900; color: #047857; font-variant-numeric: tabular-nums; }
.payslip-foot { margin-top: 16px; padding: 10px 12px; font-size: 10px; color: #64748b; border: 1px dashed #cbd5e1; border-radius: 6px; line-height: 1.5; }
.payslip-foot strong { color: #334155; }
.payslip-disclaimer { margin-top: 12px; text-align: center; font-size: 9px; color: #94a3b8; }
@media print {
  .payslip-root { max-width: none; padding: 0; }
  @page { margin: 12mm; size: A4 portrait; }
}
`;

function money(n: number) {
  return `฿${Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PayslipDocument({ model, className }: { model: PayslipViewModel; className?: string }) {
  return (
    <div className={`payslip-root rounded-lg border border-border bg-card p-5 shadow-sm print:border-0 print:shadow-none print:bg-white ${className ?? ''}`}>
      <style dangerouslySetInnerHTML={{ __html: PAYSLIP_STYLES }} />

      <header className="payslip-head">
        <div className={model.companyLogoUrl ? 'payslip-header-row' : 'payslip-header-solo'}>
          {model.companyLogoUrl ? (
            <div className="payslip-logo-box" aria-label="Company logo">
              <img src={model.companyLogoUrl} alt="" />
            </div>
          ) : null}
          <div className="payslip-header-brand">
            <div className="payslip-brand-th">{model.companyNameTh}</div>
            <div className="payslip-brand-en">{model.companyNameEn}</div>
            <h1 className="payslip-title">สลิปเงินเดือน / Payslip</h1>
            <p className="payslip-sub">{model.payrollTypeLabel}</p>
          </div>
        </div>
      </header>

      <dl className="payslip-meta">
        <div>
          <dt>ชื่อพนักงาน / Employee</dt>
          <dd>{model.employeeName}</dd>
        </div>
        <div>
          <dt>งวด / Period</dt>
          <dd>{model.periodLabel}</dd>
        </div>
        <div>
          <dt>เลขที่อ้างอิง / Reference</dt>
          <dd className="mono">{model.documentRef}</dd>
        </div>
        {model.paymentDateLabel ? (
          <div>
            <dt>วันที่จ่าย / Payment date</dt>
            <dd>{model.paymentDateLabel}</dd>
          </div>
        ) : null}
      </dl>

      <section>
        <h2 className="payslip-section-title">รายได้ / Earnings</h2>
        <table className="payslip-table">
          <thead>
            <tr>
              <th scope="col">รายการ</th>
              <th scope="col" style={{ width: '32%', textAlign: 'right' }}>
                จำนวน (บาท)
              </th>
            </tr>
          </thead>
          <tbody>
            {model.incomeLines.map((row, i) => (
              <tr key={`${row.label}-${i}`}>
                <td className="lbl">{row.label}</td>
                <td className="amt">{money(row.amount)}</td>
              </tr>
            ))}
            <tr className="payslip-total-row">
              <td>รวมรายได้ (Gross)</td>
              <td className="amt">{money(model.grossTotal)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {model.leaveSummaryLines && model.leaveSummaryLines.length > 0 ? (
        <section style={{ marginTop: 18 }}>
          <h2 className="payslip-section-title">สรุปการลา / Leave summary</h2>
          <table className="payslip-table">
            <thead>
              <tr>
                <th scope="col">รายการ</th>
                <th scope="col" style={{ width: '32%' }}>
                  หมายเหตุ
                </th>
              </tr>
            </thead>
            <tbody>
              {model.leaveSummaryLines.map((row, i) => (
                <tr key={`${row.label}-${i}`}>
                  <td className="lbl">{row.label}</td>
                  <td className="lbl" style={{ fontSize: 12, color: '#64748b' }}>
                    {row.detail || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section style={{ marginTop: 18 }}>
        <h2 className="payslip-section-title">รายการหัก / Deductions</h2>
        <table className="payslip-table">
          <thead>
            <tr>
              <th scope="col">รายการ</th>
              <th scope="col" style={{ width: '32%', textAlign: 'right' }}>
                จำนวน (บาท)
              </th>
            </tr>
          </thead>
          <tbody>
            {model.deductionLines.map((row, i) => (
              <tr key={`${row.label}-${i}`}>
                <td className="lbl">{row.label}</td>
                <td className="amt" style={{ color: '#b91c1c' }}>
                  −{money(row.amount)}
                </td>
              </tr>
            ))}
            <tr className="payslip-total-row">
              <td>รวมหัก</td>
              <td className="amt" style={{ color: '#b91c1c' }}>
                −{money(model.deductionsTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="payslip-net">
        <span className="payslip-net-label">รับสุทธิ (Net pay)</span>
        <span className="payslip-net-amt">{money(model.netPay)}</span>
      </div>

      {model.roundingNote ? (
        <p className="payslip-disclaimer" style={{ color: '#b45309' }}>
          หมายเหตุ: ยอดรับสุทธิอ้างอิงจาก snapshot บน Payroll Line อาจต่างจากผลลบแบบง่ายเล็กน้อยจากการปัดเศษหรือการปรับยอด
        </p>
      ) : null}

      <div className="payslip-foot">
        <strong>Policy / engine ที่ใช้ตอน generate</strong>
        <div style={{ marginTop: 4 }}>{model.policyVersionLabel}</div>
      </div>

      <p className="payslip-disclaimer">
        เอกสารนี้อ้างอิง snapshot บน Payroll Line — ไม่คำนวณย้อนหลังจากการตั้งค่าปัจจุบัน
      </p>
    </div>
  );
}
