'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { doc } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { PayrollExecutiveWhtCertificatePanel } from '@/components/payroll/payroll-executive-wht-certificate-panel';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { canAccess, canView, isMatrixControlledRole } from '@/lib/permissions';
import { canViewHrPayrollFlowSubsection } from '@/lib/navigation/nav-access';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { usePermissions } from '@/hooks/use-permissions';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import type { OfficePayrollLine, OfficePayrollRun, User } from '@/lib/types';

function executivePayrollPeriodLabel(run: OfficePayrollRun): string {
  const m = run.payrollMonth?.trim();
  if (m) return m;
  const a = run.payrollPeriodStart?.trim();
  const b = run.payrollPeriodEnd?.trim();
  if (a && b) return `${a} – ${b}`;
  return run.payrollRunNo || run.id;
}

export default function AccountingPayrollExecutiveWhtCertificatePage({
  params,
}: {
  params: Promise<{ runId: string; lineId: string }>;
}) {
  const { runId, lineId } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();

  const useMatrixGuards = isMatrixControlledRole(currentUser);

  const canViewExecutivePayroll = useMemo(() => {
    if (!currentUser) return false;
    const admin = isSystemAdmin(currentUser) || isSimpleAdmin(currentUser);
    if (admin) return true;
    if (canViewHrPayrollFlowSubsection(currentUser, profile, false)) return true;
    if (useMatrixGuards) {
      return canAccess(currentUser, 'executive_payroll', 'view');
    }
    return canView(currentUser, 'executive_payroll', profile);
  }, [currentUser, useMatrixGuards, profile]);

  const runRef = useMemoFirebase(
    () => (firestore && canViewExecutivePayroll ? doc(firestore, 'executive_payroll_runs', runId) : null),
    [firestore, runId, canViewExecutivePayroll],
  );
  const lineRef = useMemoFirebase(
    () => (firestore && canViewExecutivePayroll ? doc(firestore, 'executive_payroll_runs', runId, 'lines', lineId) : null),
    [firestore, runId, lineId, canViewExecutivePayroll],
  );

  const { data: run, isLoading: runLoading } = useDoc<OfficePayrollRun>(runRef as any);
  const { data: line, isLoading: lineLoading } = useDoc<OfficePayrollLine>(lineRef as any);

  const periodLabel = run ? executivePayrollPeriodLabel(run) : '';

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const user = currentUser as User;
  if (!canViewExecutivePayroll) {
    return (
      <AppShell user={user} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าถึงเอกสารหัก ณ ที่จ่ายผู้บริหาร
        </div>
      </AppShell>
    );
  }

  const loading = runLoading || lineLoading;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-4 py-6 px-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="ghost" size="sm" asChild className="gap-1">
            <Link href="/accounting/withholding-payroll">
              <ArrowLeft className="h-4 w-4" />
              กลับรายการหัก ณ ที่จ่าย (พนักงาน)
            </Link>
          </Button>
        </div>

        <div>
          <h1 className="text-xl font-bold tracking-tight">หนังสือรับรองหัก ณ ที่จ่าย — ผู้บริหาร</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {line?.staffName ?? '…'} · {run?.payrollRunNo ?? runId} · บรรทัด {lineId}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
          </div>
        ) : !run || !line ? (
          <p className="text-sm text-muted-foreground py-8">ไม่พบข้อมูลงวดหรือบรรทัดจ่าย</p>
        ) : (
          <PayrollExecutiveWhtCertificatePanel
            active
            firestore={firestore}
            run={run}
            line={line}
            periodLabel={periodLabel}
            companyProfile={(companyProfile ?? null) as CompanyDocumentProfileForPayrollWht | null}
            currentUser={user}
          />
        )}
      </div>
    </AppShell>
  );
}
