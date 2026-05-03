'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { PayslipDocument } from '@/components/payroll/payslip-document';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { PayrollBatch, PayrollBatchLine, PayrollPeriod, User } from '@/lib/types';
import { buildPayslipFromWorkerLine } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function PayrollBatchPrintAllPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  const batchRef = useMemoFirebase(() => (firestore ? doc(firestore, 'payroll_batches', id) : null), [firestore, id]);
  const { data: batch, isLoading: loadingBatch } = useDoc<PayrollBatch>(batchRef as any);

  const linesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'payroll_batches', id, 'lines') : null), [firestore, id]);
  const { data: lines, isLoading: loadingLines } = useCollection<PayrollBatchLine>(linesQuery as any);

  const periodRef = useMemoFirebase(
    () => (firestore && batch ? doc(firestore, 'payroll_periods', batch.payrollPeriodId) : null),
    [firestore, batch?.payrollPeriodId]
  );
  const { data: period } = useDoc<PayrollPeriod>(periodRef as any);

  const periodLabel = period?.label || `${batch?.payrollPeriodId ?? ''}`;
  const { profile: companyProfile } = useCompanyDocumentProfile();

  const models = useMemo(() => {
    if (!batch || !lines?.length) return [];
    const sorted = [...lines].sort((a, b) =>
      (a.workerNameSnapshot || '').localeCompare(b.workerNameSnapshot || '', 'th', {
        sensitivity: 'base',
        numeric: true,
      }),
    );
    return sorted.map((line) => buildPayslipFromWorkerLine(line, batch, periodLabel, companyProfile ?? undefined));
  }, [batch, lines, periodLabel, companyProfile?.companyNameTh, companyProfile?.companyNameEn, companyProfile?.documentHeaderLogoUrl]);

  const handlePrintAll = () => window.print();

  if (loadingBatch || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!batch) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-8 text-center text-muted-foreground">ไม่พบ batch</div>
      </AppShell>
    );
  }

  const eligible = ['HR_APPROVED', 'FINANCE_PREPARED', 'PAYMENT_EXPORTED', 'PAID', 'LOCKED'].includes(batch.status);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-2xl space-y-4 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/payroll/batches/${id}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">พิมพ์สลิปทั้ง batch</h1>
        </div>
        {!eligible && (
          <p className="text-sm text-amber-700">
            งวดนี้ยังไม่ HR อนุมัติ — สลิปยังไม่ควรแจกจ่ายอย่างเป็นทางการ (ยังพิมพ์ดูร่างได้)
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {lines?.length ?? 0} รายการ — ใช้ &quot;พิมพ์ / บันทึกเป็น PDF&quot; จากเบราว์เซอร์
        </p>
        <Button type="button" onClick={handlePrintAll} className="gap-2">
          <Printer className="h-4 w-4" /> พิมพ์ทั้งหมด / บันทึก PDF
        </Button>
      </div>

      <div className="mx-auto max-w-2xl space-y-8 print:space-y-0 print:max-w-none">
        {loadingLines && (
          <div className="flex justify-center py-20 print:hidden">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}
        {models.map((model, i) => (
          <div
            key={i}
            className="break-after-page print:break-after-page print:py-4 last:print:break-after-auto"
          >
            <PayslipDocument model={model} />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
