'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { PayrollBatch, PayrollBatchLine, Position, User, Worker } from '@/lib/types';
import type { WithholdingCertificateCopyVariant } from '@/lib/types';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import {
  buildPayrollWorkerWhtPrintVm,
  resolvePayrollWorkerWhtPaymentDateYmd,
  timestampMsToBangkokYmd,
  validatePayrollWorkerWhtPrint,
  buildPayrollWhtElectronicDataFromVm,
} from '@/lib/payroll/payroll-worker-wht-model';
import {
  buildPayrollWorkerWhtCertificateHtml,
  buildPayrollWorkerWhtCertificateMultiHtml,
  openPayrollWorkerWhtPrintWindow,
  type PayrollWorkerWhtPrintBaseOptions,
} from '@/lib/payroll/payroll-worker-wht-print-html';
import { auditPayrollWorkerWhtSinglePrint, auditPayrollWorkerWhtXmlGenerated } from '@/lib/payroll/payroll-worker-wht-audit';
import { loadWorkerYearToDateStatutoryFunds } from '@/lib/payroll/payroll-wht-year-to-date-funds';
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

export function PayrollWorkerWhtCertificatePanel({
  active,
  firestore,
  batch,
  line,
  periodLabel,
  companyProfile,
  currentUser,
  toolbarHost = null,
}: {
  active: boolean;
  firestore: Firestore | null;
  batch: PayrollBatch;
  line: PayrollBatchLine;
  periodLabel: string;
  companyProfile: CompanyDocumentProfileForPayrollWht | null;
  currentUser: User;
  toolbarHost?: HTMLElement | null;
}) {
  const [loading, setLoading] = useState(false);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !firestore) return;
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    void (async () => {
      try {
        const ws = await getDoc(doc(firestore, 'workers', line.workerId));
        if (!ws.exists()) {
          if (!cancelled) {
            setWorker(null);
            setPosition(null);
            setLoadErr('ไม่พบข้อมูลลูกจ้างใน Firestore');
          }
          return;
        }
        const w = ws.data() as Worker;
        let pos: Position | null = null;
        if (w.currentPositionId) {
          const ps = await getDoc(doc(firestore, 'positions', w.currentPositionId));
          if (ps.exists()) pos = ps.data() as Position;
        }
        if (!cancelled) {
          setWorker(w);
          setPosition(pos);
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
  }, [active, firestore, line.workerId]);

  const paymentYmd = useMemo(() => resolvePayrollWorkerWhtPaymentDateYmd(batch, line), [batch, line]);

  const [issueYmd, setIssueYmd] = useState(() => timestampMsToBangkokYmd(Date.now()));
  useEffect(() => {
    if (active) setIssueYmd(timestampMsToBangkokYmd(Date.now()));
  }, [active, batch.id, line.id]);

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
        const res = await loadWorkerYearToDateStatutoryFunds(firestore, line.workerId, year, batch.id);
        if (!cancelled) setYtdFunds(res);
      } catch {
        if (!cancelled) setYtdFunds(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, firestore, line.workerId, batch.id, paymentYmd]);

  const validation = useMemo(
    () =>
      validatePayrollWorkerWhtPrint({
        company: companyProfile,
        worker,
        batch,
        line,
        paymentDateYmd: paymentYmd,
      }),
    [companyProfile, worker, batch, line, paymentYmd],
  );

  const vm = useMemo(() => {
    if (!worker || !paymentYmd) return null;
    try {
      return buildPayrollWorkerWhtPrintVm({
        batch,
        line,
        worker,
        position,
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
  }, [batch, line, worker, position, companyProfile, periodLabel, issueYmd, paymentYmd, ytdFunds]);

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
        await auditPayrollWorkerWhtSinglePrint(firestore, currentUser, {
          batchId: batch.id,
          settlementLineId: line.id,
          workerId: line.workerId,
          documentNo: vm.documentNo,
          copyVariant: variants.join('+'),
          result: 'success',
        });
      } catch {
        /* audit best-effort */
      }
    },
    [firestore, vm, currentUser, companyProfile, batch.id, line.id, line.workerId],
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
      await auditPayrollWorkerWhtXmlGenerated(firestore, currentUser, {
        batchId: batch.id,
        settlementLineId: line.id,
        workerId: line.workerId,
        documentNo: vm.documentNo,
      });
    } catch {
      /* ignore */
    }
  }, [firestore, vm, currentUser, batch.id, line.id, line.workerId]);

  const canXml = isSystemAdmin(currentUser) || isSimpleAccounting(currentUser);

  return (
    <PayrollWhtCertificatePanelShell
      loading={loading}
      loadingLabel="กำลังโหลดข้อมูลลูกจ้าง…"
      loadErr={loadErr}
      validation={validation}
      previewHtml={previewHtml}
      iframeTitle="payroll-wht-preview"
      canPrint={!!vm && validation.ok}
      canXml={canXml}
      onPrint={(variants) => void handlePrint(variants)}
      onXml={() => void handleXmlPayload()}
      toolbarHost={toolbarHost}
    />
  );
}
