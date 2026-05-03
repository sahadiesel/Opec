import { redirect } from 'next/navigation';

export default async function AccountingWorkerPayrollDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/payroll/batches/${encodeURIComponent(id)}`);
}
