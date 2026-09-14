'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { ExecutivePayrollStaff, OfficePayrollLine, OfficePayrollRun, OfficeStaff, User } from '@/lib/types';
import type { WithholdingCertificateCopyVariant } from '@/lib/types';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import {
  validatePayrollOfficeWhtPrint,
  resolveOfficePayrollWhtPaymentDateYmd,
} from '@/lib/payroll/payroll-office-wht-model';
import { buildPayrollExecutiveWhtPrintVm, mergeExecutivePayrollStaffForWhtCertificate } from '@/lib/payroll/payroll-executive-wht-model';
import { buildPayrollWhtElectronicDataFromVm, timestampMsToBangkokYmd } from '@/lib/payroll/payroll-worker-wht-model';
import {
  buildPayrollWorkerWhtCertificateHtml,
  buildPayrollWorkerWhtCertificateMultiHtml,
  openPayrollWorkerWhtPrintWindow,
  type PayrollWorkerWhtPrintBaseOptions,
} from '@/lib/payroll/payroll-worker-wht-print-html';
import {
  auditPayrollExecutiveWhtSinglePrint,
  auditPayrollExecutiveWhtXmlGenerated,
} from '@/lib/payroll/payroll-executive-wht-audit';
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

export function PayrollExecutiveWhtCertificatePanel({
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
  /** ถ้าส่งมา จะเรนเดอร์ปุ่มพิมพ์ไปยัง element นี้ (เช่น มุมขวาบนของหน้า) */
  toolbarHost?: HTMLElement | null;
}) {
  const [loading, setLoading] = useState(false);
  const [staffMerged, setStaffMerged] = useState<OfficeStaff | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !firestore) return;
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    void (async () => {
      try {
        const exRef = doc(firestore, 'executive_payroll_staff', line.staffId);
        const exSnap = await getDoc(exRef);
        if (!exSnap.exists()) {
          if (!cancelled) {
            setStaffMerged(null);
            setLoadErr('ไม่พบข้อมูลใน executive_payroll_staff');
          }
          return;
        }
        const exec = { id: exSnap.id, ...exSnap.data() } as ExecutivePayrollStaff;
        let linked: OfficeStaff | null = null;
        const linkId = (exec.linkedOfficeStaffId || '').trim();
        if (linkId) {
          const os = await getDoc(doc(firestore, 'office_staff', linkId));
          if (os.exists()) linked = { id: os.id, ...os.data() } as OfficeStaff;
        }
        if (!cancelled) {
          setStaffMerged(mergeExecutivePayrollStaffForWhtCertificate(exec, linked));
          setLoadErr(null);
        }
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

  const validation = useMemo(
    () =>
      validatePayrollOfficeWhtPrint({
        company: companyProfile,
        staff: staffMerged,
        run,
        line,
        paymentDateYmd: paymentYmd,
        staffRegistry: 'executive_payroll_staff',
      }),
    [companyProfile, staffMerged, run, line, paymentYmd],
  );

  const vm = useMemo(() => {
    if (!staffMerged || !paymentYmd) return null;
    try {
      return buildPayrollExecutiveWhtPrintVm({
        run,
        line,
        staff: staffMerged,
        company: companyProfile,
        periodLabel,
        issueDateYmd: issueYmd,
        paymentDateYmd: paymentYmd,
      });
    } catch {
      return null;
    }
  }, [run, line, staffMerged, companyProfile, periodLabel, issueYmd, paymentYmd]);

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
        await auditPayrollExecutiveWhtSinglePrint(firestore, currentUser, {
          executivePayrollRunId: run.id,
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
      await auditPayrollExecutiveWhtXmlGenerated(firestore, currentUser, {
        executivePayrollRunId: run.id,
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
      loadingLabel="กำลังโหลดทะเบียนผู้บริหาร…"
      loadErr={loadErr}
      validation={validation}
      previewHtml={previewHtml}
      iframeTitle="executive-payroll-wht-preview"
      canPrint={!!vm && validation.ok}
      canXml={canXml}
      onPrint={(variants) => void handlePrint(variants)}
      onXml={() => void handleXmlPayload()}
      toolbarHost={toolbarHost}
    />
  );
}
