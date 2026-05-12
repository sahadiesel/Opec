'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { PayslipDocument } from '@/components/payroll/payslip-document';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { OfficePayrollLine, OfficePayrollRun, User } from '@/lib/types';
import { buildPayslipFromOfficeLine } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { canView } from '@/lib/permissions';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function ExecutivePayrollPrintAllPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  const isAuthorized = useMemo(() => canView(currentUser, 'executive_payroll'), [currentUser]);

  const runRef = useMemoFirebase(
    () => (firestore && isAuthorized ? doc(firestore, 'executive_payroll_runs', id) : null),
    [firestore, id, isAuthorized],
  );
  const { data: run, isLoading: loadingRun } = useDoc<OfficePayrollRun>(runRef as any);

  const linesQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'executive_payroll_runs', id, 'lines') : null),
    [firestore, id, isAuthorized],
  );
  const { data: lines, isLoading: loadingLines } = useCollection<OfficePayrollLine>(linesQuery as any);
  const { profile: companyProfile } = useCompanyDocumentProfile();

  const models = useMemo(() => {
    if (!run || !lines?.length) return [];
    return lines.map((line) =>
      buildPayslipFromOfficeLine(line, run, companyProfile ?? undefined, 'ผู้บริหาร / Executive Payroll (รายเดือน)'),
    );
  }, [run, lines, companyProfile?.companyNameTh, companyProfile?.companyNameEn, companyProfile?.documentHeaderLogoUrl]);

  if (loadingRun || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-8 text-center text-muted-foreground">ไม่มีสิทธิ์</div>
      </AppShell>
    );
  }

  if (!run) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-8 text-center text-muted-foreground">ไม่พบงวด</div>
      </AppShell>
    );
  }

  const eligible = ['HR_APPROVED', 'FINANCE_APPROVED', 'PAID', 'LOCKED'].includes(run.status);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-2xl space-y-4 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/accounting/executive-payroll/${id}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">พิมพ์สลิปทั้งงวด — เงินเดือนผู้บริหาร</h1>
        </div>
        {!eligible && (
          <p className="text-sm text-amber-700">งวดยังไม่ HR อนุมัติ — สลิปยังไม่เป็นทางการ</p>
        )}
        <p className="text-sm text-muted-foreground">
          {lines?.length ?? 0} รายการ — พิมพ์ / บันทึก PDF จากเบราว์เซอร์ (รูปแบบเดียวกับพนักงานออฟฟิศ)
        </p>
        <Button type="button" onClick={() => window.print()} className="gap-2">
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
          <div key={i} className="break-after-page print:break-after-page print:py-4 last:print:break-after-auto">
            <PayslipDocument model={model} />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
