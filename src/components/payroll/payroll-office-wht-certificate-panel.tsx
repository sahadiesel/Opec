'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { OfficePayrollLine, OfficePayrollRun, OfficeStaff, User } from '@/lib/types';
import type { WithholdingCertificateCopyVariant } from '@/lib/types';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import {
  buildPayrollOfficeWhtPrintVm,
  resolveOfficePayrollWhtPaymentDateYmd,
  validatePayrollOfficeWhtPrint,
} from '@/lib/payroll/payroll-office-wht-model';
import { buildPayrollWhtElectronicDataFromVm, timestampMsToBangkokYmd } from '@/lib/payroll/payroll-worker-wht-model';
import {
  buildPayrollWorkerWhtCertificateHtml,
  buildPayrollWorkerWhtCertificateMultiHtml,
  openPayrollWorkerWhtPrintWindow,
  type PayrollWorkerWhtPrintBaseOptions,
} from '@/lib/payroll/payroll-worker-wht-print-html';
import {
  auditPayrollOfficeWhtSinglePrint,
  auditPayrollOfficeWhtXmlGenerated,
} from '@/lib/payroll/payroll-office-wht-audit';
import { loadOfficeYearToDateStatutoryFunds } from '@/lib/payroll/payroll-wht-year-to-date-funds';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAccounting } from '@/lib/simple-tier-model';
import { PayrollWhtCertificatePanelShell } from '@/components/payroll/payroll-wht-certificate-panel-shell';

function buildPrintOpts(user: User, company: CompanyDocumentProfileForPayrollWht | null): PayrollWorkerWhtPrintBaseOptions {
  const disp = company?.whtCertificateDisplay;
  return {
    official: false,
    printedByName: user.displayName || user.email || user.id,
    printedAtMs: Date.now(),
    showSignatureImage: disp?.showSignatureImage !== false,
    showCompanyStamp: false,
    showSystemGeneratedNote: disp?.showSystemGeneratedNote !== false,
  };
}

export function PayrollOfficeWhtCertificatePanel({
  active,
  firestore,
  run,
  line,
  periodLabel,
  companyProfile,
  currentUser,
  toolbarHost = null,
}: {
  active: boolean;
  firestore: Firestore | null;
  run: OfficePayrollRun;
  line: OfficePayrollLine;
  periodLabel: string;
  companyProfile: CompanyDocumentProfileForPayrollWht | null;
  currentUser: User;
  toolbarHost?: HTMLElement | null;
}) {
  const [loading, setLoading] = useState(false);
  const [staff, setStaff] = useState<OfficeStaff | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !firestore) return;
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    void (async () => {
      try {
        const ss = await getDoc(doc(firestore, 'office_staff', line.staffId));
        if (!ss.exists()) {
          if (!cancelled) {
            setStaff(null);
            setLoadErr('ไม่พบข้อมูลพนักงานใน office_staff');
          }
          return;
        }
        if (!cancelled) setStaff(ss.data() as OfficeStaff);
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, firestore, line.staffId]);

  const paymentYmd = useMemo(() => resolveOfficePayrollWhtPaymentDateYmd(run), [run]);

  const [issueYmd, setIssueYmd] = useState(() => timestampMsToBangkokYmd(Date.now()));
  useEffect(() => {
    if (active) setIssueYmd(timestampMsToBangkokYmd(Date.now()));
  }, [active, run.id, line.id]);

  const [ytdFunds, setYtdFunds] = useState<{ sso: number; assistanceFund: number } | null>(null);
  useEffect(() => {
    if (!active || !firestore || !paymentYmd) {
      setYtdFunds(null);
      return;
    }
    let cancelled = false;
    const year = Number(paymentYmd.slice(0, 4));
    void (async () => {
      try {
        const res = await loadOfficeYearToDateStatutoryFunds(firestore, line.staffId, year, run.id);
        if (!cancelled) setYtdFunds(res);
      } catch {
        if (!cancelled) setYtdFunds(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, firestore, line.staffId, run.id, paymentYmd]);

  const validation = useMemo(
    () =>
      validatePayrollOfficeWhtPrint({
        company: companyProfile,
        staff,
        run,
        line,
        paymentDateYmd: paymentYmd,
      }),
    [companyProfile, staff, run, line, paymentYmd],
  );

  const vm = useMemo(() => {
    if (!staff || !paymentYmd) return null;
    try {
      return buildPayrollOfficeWhtPrintVm({
        run,
        line,
        staff,
        company: companyProfile,
        periodLabel,
        issueDateYmd: issueYmd,
        paymentDateYmd: paymentYmd,
        yearToDateSocialSecurityBaht: ytdFunds?.sso,
        yearToDateEmployeeAssistanceFundBaht: ytdFunds?.assistanceFund,
      });
    } catch {
      return null;
    }
  }, [run, line, staff, companyProfile, periodLabel, issueYmd, paymentYmd, ytdFunds]);

  const previewHtml = useMemo(() => {
    if (!vm) return '';
    const opts = buildPrintOpts(currentUser, companyProfile);
    return buildPayrollWorkerWhtCertificateHtml(vm, 'COPY_PAYEE_TAX_RETURN', {
      ...opts,
      printedAtMs: Date.now(),
    });
  }, [vm, currentUser, companyProfile]);

  const handlePrint = useCallback(
    async (variants: WithholdingCertificateCopyVariant[]) => {
      if (!firestore || !vm) return;
      const opts = buildPrintOpts(currentUser, companyProfile);
      const html =
        variants.length === 1
          ? buildPayrollWorkerWhtCertificateHtml(vm, variants[0], opts)
          : buildPayrollWorkerWhtCertificateMultiHtml(vm, variants, opts);
      openPayrollWorkerWhtPrintWindow(html);
      try {
        await auditPayrollOfficeWhtSinglePrint(firestore, currentUser, {
          officePayrollRunId: run.id,
          lineId: line.id,
          staffId: line.staffId,
          documentNo: vm.documentNo,
          copyVariant: variants.join('+'),
          result: 'success',
        });
      } catch {
        /* audit best-effort */
      }
    },
    [firestore, vm, currentUser, companyProfile, run.id, line.id, line.staffId],
  );

  const handleXmlPayload = useCallback(async () => {
    if (!firestore || !vm) return;
    const payload = buildPayrollWhtElectronicDataFromVm(vm);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vm.documentNo}_xml-ready.json`;
    a.click();
    URL.revokeObjectURL(url);
    try {
      await auditPayrollOfficeWhtXmlGenerated(firestore, currentUser, {
        officePayrollRunId: run.id,
        lineId: line.id,
        staffId: line.staffId,
        documentNo: vm.documentNo,
      });
    } catch {
      /* ignore */
    }
  }, [firestore, vm, currentUser, run.id, line.id, line.staffId]);

  const canXml = isSystemAdmin(currentUser) || isSimpleAccounting(currentUser);

  return (
    <PayrollWhtCertificatePanelShell
      loading={loading}
      loadingLabel="กำลังโหลดทะเบียนพนักงาน…"
      loadErr={loadErr}
      validation={validation}
      previewHtml={previewHtml}
      iframeTitle="office-payroll-wht-preview"
      canPrint={!!vm && validation.ok}
      canXml={canXml}
      onPrint={(variants) => void handlePrint(variants)}
      onXml={() => void handleXmlPayload()}
      toolbarHost={toolbarHost}
    />
  );
}
