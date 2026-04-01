'use client';

import { useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { canAccess, isHRStaff, isMatrixControlledRole } from '@/lib/permissions';
import { PayrollApprovalCenterD6 } from '@/components/hr/payroll-approval-center';
import { useAppUser } from '@/hooks/use-app-user';

/**
 * HR-D6: ศูนย์อนุมัติ Payroll — Worker / Office แยกแท็บ, ต่อ batch/run มี Summary, Validation, Actions, Audit preview
 */
export default function HrPayrollApprovalPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewApprovalPage = useMatrixGuards
    ? canAccess(currentUser, 'payroll_runs', 'view') || canAccess(currentUser, 'worker_payroll', 'view')
    : isHRStaff(currentUser);

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
        <PayrollApprovalCenterD6 currentUser={currentUser} />
      </div>
    </AppShell>
  );
}
