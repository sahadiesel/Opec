'use client';

import { use } from 'react';
import { PayrollBatchDetailView } from '@/components/payroll/payroll-batch-detail-view';

export default function PayrollBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PayrollBatchDetailView id={id} shell="hr" />;
}
