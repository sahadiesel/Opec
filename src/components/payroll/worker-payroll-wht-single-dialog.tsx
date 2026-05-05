'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  const [loading, setLoading] = useState(false);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !firestore) return;
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
  }, [open, firestore, line.workerId]);

  const paymentYmd = useMemo(() => resolvePayrollWorkerWhtPaymentDateYmd(batch), [batch]);

  const [issueYmd, setIssueYmd] = useState(() => timestampMsToBangkokYmd(Date.now()));
  useEffect(() => {
    if (open) setIssueYmd(timestampMsToBangkokYmd(Date.now()));
  }, [open]);

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
      });
    } catch {
      return null;
    }
  }, [batch, line, worker, position, companyProfile, periodLabel, issueYmd, paymentYmd]);

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

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-5 w-5 animate-spin" /> กำลังโหลดข้อมูลลูกจ้าง…
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
          <iframe title="payroll-wht-preview" className="w-full min-h-[560px] border rounded-md bg-white" srcDoc={previewHtml} />
        ) : (
          <p className="text-sm text-muted-foreground py-6">ยังไม่มีตัวอย่าง — โหลดข้อมูลหรือแก้ validation ก่อน</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
