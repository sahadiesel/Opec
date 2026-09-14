'use client';

import { use } from 'react';
import { PayrollPrintAllShell } from '@/components/payroll/payroll-print-all-shell';

/** Executive slip header — passed as prop only; office keeps the payslip-model default. */
const EXECUTIVE_PAYROLL_TYPE_LABEL = 'ผู้บริหาร / Executive Payroll (รายเดือน)';

export default function ExecutivePayrollPrintAllPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <PayrollPrintAllShell
      runId={id}
      permissionModule="executive_payroll"
      runsCollection="executive_payroll_runs"
      backHref={`/accounting/executive-payroll/${id}`}
      pageTitle="พิมพ์สลิปทั้งงวด — เงินเดือนผู้บริหาร"
      linesSummaryExtra=" (รูปแบบเดียวกับพนักงานออฟฟิศ)"
      payrollTypeLabelOverride={EXECUTIVE_PAYROLL_TYPE_LABEL}
    />
  );
}
