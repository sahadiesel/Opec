'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

export function PayrollOfficeWhtCertificatePanel({
  active,
  firestore,
  run,
  line,
  periodLabel,
  companyProfile,
  currentUser,
}: {
  active: boolean;
  firestore: Firestore | null;
  run: OfficePayrollRun;
  line: OfficePayrollLine;
  periodLabel: string;
  companyProfile: CompanyDocumentProfileForPayrollWht | null;
  currentUser: User;
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
      });
    } catch {
      return null;
    }
  }, [run, line, staff, companyProfile, periodLabel, issueYmd, paymentYmd]);

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
    <>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-5 w-5 animate-spin" /> กำลังโหลดทะเบียนพนักงาน…
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

      <div className="flex flex-wrap gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" disabled={!vm || !validation.ok}>
              พิมพ์…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
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

      {previewHtml ? (
        <iframe title="office-payroll-wht-preview" className="w-full min-h-[560px] border rounded-md bg-white" srcDoc={previewHtml} />
      ) : (
        <p className="text-sm text-muted-foreground py-6">ยังไม่มีตัวอย่าง — โหลดข้อมูลหรือแก้ validation ก่อน</p>
      )}
    </>
  );
}
