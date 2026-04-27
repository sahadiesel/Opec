'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import { PayrollApprovalCenterD6 } from '@/components/hr/payroll-approval-center';
import { useAppUser } from '@/hooks/use-app-user';

function PayrollApprovalInner() {
  const searchParams = useSearchParams();
  const initialBatchId = searchParams.get('batch') || undefined;
  const { currentUser, isLoading: userLoading } = useAppUser();
  const canViewApprovalPage =
    currentUser &&
    canViewHrApprovalSubsection(currentUser, isSystemAdmin(currentUser) || isSimpleAdmin(currentUser));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const { hash } = window.location;
    if (hash === '#pending') {
      requestAnimationFrame(() => {
        document.getElementById('pending')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
    );
  }

  if (!canViewApprovalPage) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div id="pending" className="scroll-mt-24">
        <PayrollApprovalCenterD6 currentUser={currentUser} initialWorkerBatchId={initialBatchId} />
      </div>
    </AppShell>
  );
}

/**
 * HR-D6: ศูนย์อนุมัติ Payroll — Worker / Office แยกแท็บ, ต่อ batch/run มี Summary, Validation, Actions, Audit preview
 * useSearchParams ต้องอยู่ภายใต้ Suspense (Next.js 15 / prerender)
 */
export default function HrPayrollApprovalPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
      }
    >
      <PayrollApprovalInner />
    </Suspense>
  );
}
