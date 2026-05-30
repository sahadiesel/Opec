'use client';

import { useMemo, useState } from 'react';
import { doc } from 'firebase/firestore';
import { FileText, Loader2 } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type {
  OfficePayrollLine,
  OfficePayrollRun,
  OfficeStaff,
  PayrollBatch,
  PayrollBatchLine,
  User,
  Worker,
} from '@/lib/types';
import { officePayrollRunStubFromLine, payrollBatchStubFromLine } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import { PayrollOfficeWhtCertificatePanel } from '@/components/payroll/payroll-office-wht-certificate-panel';
import { PayrollWorkerWhtCertificatePanel } from '@/components/payroll/payroll-worker-wht-certificate-panel';

function useOfficeRunForLine(line: OfficePayrollLine) {
  const firestore = useFirestore();
  const runId = line.officePayrollRunId;
  const officeRef = useMemoFirebase(
    () => (firestore && runId ? doc(firestore, 'office_payroll_runs', runId) : null),
    [firestore, runId],
  );
  const execRef = useMemoFirebase(
    () => (firestore && runId ? doc(firestore, 'executive_payroll_runs', runId) : null),
    [firestore, runId],
  );
  const { data: officeRun, isLoading: officeLoading } = useDoc<OfficePayrollRun>(officeRef as any);
  const { data: execRun, isLoading: execLoading } = useDoc<OfficePayrollRun>(execRef as any);
  const runDoc = officeRun ?? execRun ?? null;
  const run = useMemo(() => officePayrollRunStubFromLine(line, runDoc), [line, runDoc]);
  const isLoading = officeLoading || (!officeRun && execLoading);
  const disabled = run.status === 'DRAFT';
  const disabledTitle = disabled ? 'งวดนี้ยังไม่พร้อมใบหัก ณ ที่จ่าย (ต้องคำนวณแล้ว)' : undefined;
  return { firestore, run, isLoading, disabled, disabledTitle };
}

export function SelfProfileOfficeWhtPrintButton({
  line,
  staff,
  currentUser,
}: {
  line: OfficePayrollLine;
  staff: OfficeStaff;
  currentUser: User;
}) {
  const [open, setOpen] = useState(false);
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const { firestore, run, isLoading, disabled, disabledTitle } = useOfficeRunForLine(line);
  const periodLabel = run.payrollMonth || line.payrollMonth || '—';

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs whitespace-nowrap"
          disabled={disabled}
          title={disabledTitle}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          ใบหักฯ
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto w-[calc(100vw-1rem)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>หนังสือรับรองการหักภาษี ณ ที่จ่าย (พนักงานออฟฟิศ)</DialogTitle>
          <DialogDescription>
            {staff.fullName || line.staffName} · {run.payrollRunNo}
          </DialogDescription>
        </DialogHeader>
        <PayrollOfficeWhtCertificatePanel
          active={open}
          firestore={firestore}
          run={run}
          line={line}
          periodLabel={periodLabel}
          companyProfile={companyProfile as CompanyDocumentProfileForPayrollWht | null}
          currentUser={currentUser}
        />
      </DialogContent>
    </Dialog>
  );
}

export function SelfProfileWorkerWhtPrintButton({
  line,
  worker,
  currentUser,
}: {
  line: PayrollBatchLine;
  worker: Worker;
  currentUser: User;
}) {
  const [open, setOpen] = useState(false);
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const batchRef = useMemoFirebase(
    () => (firestore && line.payrollBatchId ? doc(firestore, 'payroll_batches', line.payrollBatchId) : null),
    [firestore, line.payrollBatchId],
  );
  const { data: batchDoc, isLoading: batchLoading } = useDoc<PayrollBatch>(batchRef as any);
  const batch = useMemo(() => payrollBatchStubFromLine(line, batchDoc ?? null), [line, batchDoc]);
  const periodLabel =
    line.periodStartDate && line.periodEndDate
      ? `${line.periodStartDate} – ${line.periodEndDate}`
      : batch.id;
  const disabled = batch.status === 'DRAFT';
  const disabledTitle = disabled ? 'งวดนี้ยังไม่พร้อมใบหัก ณ ที่จ่าย (ต้องคำนวณแล้ว)' : undefined;

  if (batchLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs whitespace-nowrap"
          disabled={disabled}
          title={disabledTitle}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          ใบหักฯ
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto w-[calc(100vw-1rem)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>หนังสือรับรองการหักภาษี ณ ที่จ่าย (ลูกจ้าง)</DialogTitle>
          <DialogDescription>
            {[worker.firstName, worker.lastName].filter(Boolean).join(' ') || line.workerNameSnapshot} · {batch.id}
          </DialogDescription>
        </DialogHeader>
        <PayrollWorkerWhtCertificatePanel
          active={open}
          firestore={firestore}
          batch={batch}
          line={line}
          periodLabel={periodLabel}
          companyProfile={companyProfile as CompanyDocumentProfileForPayrollWht | null}
          currentUser={currentUser}
        />
      </DialogContent>
    </Dialog>
  );
}
