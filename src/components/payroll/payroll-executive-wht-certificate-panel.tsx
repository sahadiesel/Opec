'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

const ALL_VARIANTS: WithholdingCertificateCopyVariant[] = [
  'COPY_PAYEE_TAX_RETURN',
  'COPY_PAYEE_RECORD',
  'COPY_PAYER_RECORD',
];

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

  const toolbar: ReactNode = (
    <div className="flex flex-wrap gap-2 justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" disabled={!vm || !validation.ok} className="gap-1.5">
            <Printer className="h-4 w-4" />
            พิมพ์…
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void handlePrint(['COPY_PAYEE_TAX_RETURN'])}>พิมพ์ฉบับที่ 1</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handlePrint(['COPY_PAYEE_RECORD'])}>พิมพ์ฉบับที่ 2</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handlePrint(['COPY_PAYER_RECORD'])}>พิมพ์สำเนาผู้หักภาษี</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handlePrint([...ALL_VARIANTS])}>พิมพ์ครบชุด (3 ฉบับ)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {canXml ? (
        <Button type="button" variant="secondary" size="sm" disabled={!vm || !validation.ok} onClick={() => void handleXmlPayload()}>
          Generate Internal XML (JSON)
        </Button>
      ) : null}
    </div>
  );

  return (
    <>
      {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-5 w-5 animate-spin" /> กำลังโหลดทะเบียนผู้บริหาร…
        </div>
      ) : null}

      {loadErr ? (
        <Alert variant="destructive">
          <AlertTitle>โหลดข้อมูลไม่สำเร็จ</AlertTitle>
          <AlertDescription>{loadErr}</AlertDescription>
        </Alert>
      ) : null}

      {!loading && !loadErr && !validation.ok ? (
        <Alert variant="destructive">
          <AlertTitle>ตรวจสอบข้อมูลก่อนพิมพ์</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 space-y-1">
              {validation.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {!loading && !loadErr && validation.warnings.length > 0 ? (
        <Alert>
          <AlertTitle>หมายเหตุ</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 space-y-1">
              {validation.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {previewHtml ? (
        <iframe title="executive-payroll-wht-preview" className="w-full min-h-[560px] border rounded-md bg-white" srcDoc={previewHtml} />
      ) : (
        <p className="text-sm text-muted-foreground py-6">ยังไม่มีตัวอย่าง — โหลดข้อมูลหรือแก้ validation ก่อน</p>
      )}
    </>
  );
}
