'use client';

import type { Firestore } from 'firebase/firestore';
import type { OfficePayrollLine, OfficePayrollRun, User } from '@/lib/types';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import { PayrollExecutiveWhtCertificatePanel } from '@/components/payroll/payroll-executive-wht-certificate-panel';
import { PayrollWhtSingleDialog } from '@/components/payroll/payroll-wht-single-dialog';

export function ExecutivePayrollWhtSingleDialog({
  firestore,
  run,
  line,
  periodLabel,
  companyProfile,
  currentUser,
  disabled,
  disabledTitle,
}: {
  firestore: Firestore | null;
  run: OfficePayrollRun;
  line: OfficePayrollLine;
  periodLabel: string;
  companyProfile: CompanyDocumentProfileForPayrollWht | null;
  currentUser: User;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return (
    <PayrollWhtSingleDialog
      title="หนังสือรับรองการหักภาษี ณ ที่จ่าย (ผู้บริหาร)"
      description={
        <>
          {line.staffName} · {run.payrollRunNo}
        </>
      }
      disabled={disabled}
      disabledTitle={disabledTitle}
    >
      {(open) => (
        <PayrollExecutiveWhtCertificatePanel
          active={open}
          firestore={firestore}
          run={run}
          line={line}
          periodLabel={periodLabel}
          companyProfile={companyProfile}
          currentUser={currentUser}
        />
      )}
    </PayrollWhtSingleDialog>
  );
}
