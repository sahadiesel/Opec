'use client';

import { useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { PayrollBatch, PayrollBatchLine, User } from '@/lib/types';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import { PayrollWorkerWhtCertificatePanel } from '@/components/payroll/payroll-worker-wht-certificate-panel';

export function WorkerPayrollWhtSingleDialog({
  firestore,
  batch,
  line,
  periodLabel,
  companyProfile,
  currentUser,
  disabled,
  disabledTitle,
}: {
  firestore: Firestore | null;
  batch: PayrollBatch;
  line: PayrollBatchLine;
  periodLabel: string;
  companyProfile: CompanyDocumentProfileForPayrollWht | null;
  currentUser: User;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1 whitespace-nowrap"
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
            {line.workerNameSnapshot} · {batch.id}
          </DialogDescription>
        </DialogHeader>
        <PayrollWorkerWhtCertificatePanel
          active={open}
          firestore={firestore}
          batch={batch}
          line={line}
          periodLabel={periodLabel}
          companyProfile={companyProfile}
          currentUser={currentUser}
        />
      </DialogContent>
    </Dialog>
  );
}
