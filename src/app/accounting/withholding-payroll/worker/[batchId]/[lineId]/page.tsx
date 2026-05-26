'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { doc } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { PayrollWorkerWhtCertificatePanel } from '@/components/payroll/payroll-worker-wht-certificate-panel';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { canAccess, canSeeAccountingPillarUi, canView, isMatrixControlledRole } from '@/lib/permissions';
import { canViewHrPayrollFlowSubsection } from '@/lib/navigation/nav-access';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAccounting, isSimpleAdmin } from '@/lib/simple-tier-model';
import { usePermissions } from '@/hooks/use-permissions';
import type { PayrollBatch, PayrollBatchLine, PayrollPeriod, User } from '@/lib/types';

export default function AccountingPayrollWorkerWhtCertificatePage({
  params,
}: {
  params: Promise<{ batchId: string; lineId: string }>;
}) {
  const { batchId, lineId } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();

  const useMatrixGuards = isMatrixControlledRole(currentUser);

  const canViewPayrollBatch = useMemo(() => {
    if (!currentUser) return false;
    if (isSystemAdmin(currentUser) || isSimpleAdmin(currentUser) || isSimpleAccounting(currentUser)) return true;
    if (useMatrixGuards) {
      return (
        canAccess(currentUser, 'worker_payroll', 'view') ||
        canAccess(currentUser, 'payroll_runs', 'view') ||
        canAccess(currentUser, 'payslips', 'view')
      );
    }
    return canView(currentUser, 'worker_payroll');
  }, [currentUser, useMatrixGuards]);

  const batchRef = useMemoFirebase(
    () => (firestore && canViewPayrollBatch ? doc(firestore, 'payroll_batches', batchId) : null),
    [firestore, batchId, canViewPayrollBatch],
  );
  const lineRef = useMemoFirebase(
    () => (firestore && canViewPayrollBatch ? doc(firestore, 'payroll_batches', batchId, 'lines', lineId) : null),
    [firestore, batchId, lineId, canViewPayrollBatch],
  );

  const { data: batch, isLoading: batchLoading } = useDoc<PayrollBatch>(batchRef as any);
  const { data: line, isLoading: lineLoading } = useDoc<PayrollBatchLine>(lineRef as any);

  const periodRef = useMemoFirebase(
    () => (firestore && batch ? doc(firestore, 'payroll_periods', batch.payrollPeriodId) : null),
    [firestore, batch?.payrollPeriodId],
  );
  const { data: period } = useDoc<PayrollPeriod>(periodRef as any);

  const periodLabel = period?.label || batch?.payrollPeriodId || '';

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const user = currentUser as User;
  /** เปิดให้ทั้ง accounting (เดิม) และทีม payroll (hr_manager · operations_manager · payroll_officer) */
  const canSeePage =
    canSeeAccountingPillarUi(user, profile)
    || canViewHrPayrollFlowSubsection(user, profile, isSystemAdmin(user));
  if (!canSeePage) {
    return (
      <AppShell user={user} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูบัญชี</div>
      </AppShell>
    );
  }

  const loading = batchLoading || lineLoading;

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
          <h1 className="text-xl font-bold tracking-tight">หนังสือรับรองหัก ณ ที่จ่าย — ลูกจ้าง</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {line?.workerNameSnapshot ?? '…'} · {batchId} · บรรทัด {lineId}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
          </div>
        ) : !batch || !line ? (
          <p className="text-sm text-muted-foreground py-8">ไม่พบข้อมูลงวดหรือบรรทัดจ่าย</p>
        ) : (
          <PayrollWorkerWhtCertificatePanel
            active
            firestore={firestore}
            batch={batch}
            line={line}
            periodLabel={periodLabel}
            companyProfile={companyProfile}
            currentUser={user}
          />
        )}
      </div>
    </AppShell>
  );
}
