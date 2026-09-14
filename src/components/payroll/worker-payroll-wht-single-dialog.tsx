'use client';

import type { Firestore } from 'firebase/firestore';
import type { PayrollBatch, PayrollBatchLine, User } from '@/lib/types';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import { PayrollWorkerWhtCertificatePanel } from '@/components/payroll/payroll-worker-wht-certificate-panel';
import { PayrollWhtSingleDialog } from '@/components/payroll/payroll-wht-single-dialog';

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
  return (
    <PayrollWhtSingleDialog
      title="หนังสือรับรองการหักภาษี ณ ที่จ่าย (ลูกจ้าง)"
      description={
        <>
          {line.workerNameSnapshot} · {batch.id}
        </>
      }
      disabled={disabled}
      disabledTitle={disabledTitle}
    >
      {(open) => (
        <PayrollWorkerWhtCertificatePanel
          active={open}
          firestore={firestore}
          batch={batch}
          line={line}
          periodLabel={periodLabel}
          companyProfile={companyProfile}
          currentUser={currentUser}
        />
      )}
    </PayrollWhtSingleDialog>
  );
}
