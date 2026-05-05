'use client';

import { use } from 'react';
import { PayrollBatchDetailView } from '@/components/payroll/payroll-batch-detail-view';

/** หน้าทำจ่ายลูกจ้างในมุมบัญชี — เลือกบัญชีตัดจ่าย + cashbook (แยกจากโฟลว์ HR `/payroll/batches`) */
export default function AccountingWorkerPayrollPayoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PayrollBatchDetailView id={id} shell="accounting" />;
}
