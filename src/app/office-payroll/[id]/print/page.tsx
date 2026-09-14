'use client';

import { use } from 'react';
import { PayrollPrintAllShell } from '@/components/payroll/payroll-print-all-shell';

export default function OfficePayrollPrintAllPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <PayrollPrintAllShell
      runId={id}
      permissionModule="office_payroll"
      runsCollection="office_payroll_runs"
      backHref={`/office-payroll/${id}`}
      pageTitle="พิมพ์สลิปทั้งงวด Office"
    />
  );
}
