'use client';

import { useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { PayslipDocument } from '@/components/payroll/payslip-document';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { OfficePayrollLine, OfficePayrollRun } from '@/lib/types';
import { buildPayslipFromOfficeLine } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { sanitizePrintFileBaseName } from '@/lib/documents/standard-document-print';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';

const PRINT_ELIGIBLE_STATUSES = ['HR_APPROVED', 'FINANCE_APPROVED', 'PAID', 'LOCKED'] as const;

export type PayrollPrintAllShellProps = {
  runId: string;
  /** Permission module key — keep office vs executive separate. */
  permissionModule: 'office_payroll' | 'executive_payroll';
  /** Firestore root collection — never merge collections. */
  runsCollection: 'office_payroll_runs' | 'executive_payroll_runs';
  backHref: string;
  pageTitle: string;
  /**
   * Extra text after the shared count line
   * (e.g. executive: ` (รูปแบบเดียวกับพนักงานออฟฟิศ)`).
   */
  linesSummaryExtra?: string;
  /** Slip header override — office omits (default office label); executive passes its own. */
  payrollTypeLabelOverride?: string;
};

/**
 * Shared print-all UI for Office / Executive payroll runs.
 * Domain pages own collection path, permission module, Thai titles, and slip-header props.
 */
export function PayrollPrintAllShell({
  runId,
  permissionModule,
  runsCollection,
  backHref,
  pageTitle,
  linesSummaryExtra = '',
  payrollTypeLabelOverride,
}: PayrollPrintAllShellProps) {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const isAuthorized = useMemo(
    () => canView(currentUser, permissionModule),
    [currentUser, permissionModule],
  );

  const runRef = useMemoFirebase(
    () => (firestore && isAuthorized ? doc(firestore, runsCollection, runId) : null),
    [firestore, isAuthorized, runsCollection, runId],
  );
  const { data: run, isLoading: loadingRun } = useDoc<OfficePayrollRun>(
    // firebase hook typing accepts DocumentReference | null via loose cast in app pages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- useDoc ref typing
    runRef as any,
  );

  useEffect(() => {
    if (!run?.payrollRunNo) return;
    const next = sanitizePrintFileBaseName(run.payrollRunNo);
    const prev = document.title;
    document.title = next;
    return () => {
      document.title = prev;
    };
  }, [run?.payrollRunNo]);

  const linesQuery = useMemoFirebase(
    () =>
      firestore && isAuthorized ? collection(firestore, runsCollection, runId, 'lines') : null,
    [firestore, isAuthorized, runsCollection, runId],
  );
  const { data: lines, isLoading: loadingLines } = useCollection<OfficePayrollLine>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- useCollection query typing
    linesQuery as any,
  );
  const { profile: companyProfile } = useCompanyDocumentProfile();

  const models = useMemo(() => {
    if (!run || !lines?.length) return [];
    return lines.map((line) =>
      buildPayslipFromOfficeLine(
        line,
        run,
        companyProfile ?? undefined,
        payrollTypeLabelOverride,
      ),
    );
  }, [
    run,
    lines,
    companyProfile,
    payrollTypeLabelOverride,
  ]);

  if (loadingRun || userLoading || !currentUser) {
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

  const eligible = (PRINT_ELIGIBLE_STATUSES as readonly string[]).includes(run.status);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-2xl space-y-4 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.push(backHref)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">{pageTitle}</h1>
        </div>
        {!eligible && (
          <p className="text-sm text-amber-700">งวดยังไม่ HR อนุมัติ — สลิปยังไม่เป็นทางการ</p>
        )}
        <p className="text-sm text-muted-foreground">
          {lines?.length ?? 0} รายการ — พิมพ์ / บันทึก PDF จากเบราว์เซอร์
          {linesSummaryExtra}
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
