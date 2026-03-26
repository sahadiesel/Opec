'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { User } from '@/lib/types';
import { isHRStaff } from '@/lib/permissions';
import { PayrollApprovalCenterD6 } from '@/components/hr/payroll-approval-center';

/**
 * HR-D6: ศูนย์อนุมัติ Payroll — Worker / Office แยกแท็บ, ต่อ batch/run มี Summary, Validation, Actions, Audit preview
 */
export default function HrPayrollApprovalPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const { hash } = window.location;
    if (hash === '#pending') {
      requestAnimationFrame(() => {
        document.getElementById('pending')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

  if (!currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
    );
  }

  if (!isHRStaff(currentUser)) {
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
