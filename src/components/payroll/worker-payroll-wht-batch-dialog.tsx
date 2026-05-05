'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { PayrollBatch, PayrollBatchLine, Position, User, Worker } from '@/lib/types';
import type { WithholdingCertificateCopyVariant } from '@/lib/types';
import type { CompanyDocumentProfileForPayrollWht, PayrollWorkerWhtLinePrep } from '@/lib/payroll/payroll-worker-wht-types';
import {
  buildPayrollWorkerWhtPrintVm,
  resolvePayrollWorkerWhtPaymentDateYmd,
  timestampMsToBangkokYmd,
  validatePayrollWorkerWhtPrint,
} from '@/lib/payroll/payroll-worker-wht-model';
import {
  buildPayrollWorkerWhtCertificateMultiHtml,
  openPayrollWorkerWhtPrintWindow,
  type PayrollWorkerWhtPrintBaseOptions,
} from '@/lib/payroll/payroll-worker-wht-print-html';
import { auditPayrollWorkerWhtBatchPrint } from '@/lib/payroll/payroll-worker-wht-audit';

const ALL_VARIANTS: WithholdingCertificateCopyVariant[] = [
  'COPY_PAYEE_TAX_RETURN',
  'COPY_PAYEE_RECORD',
  'COPY_PAYER_RECORD',
];

function printOpts(user: User, company: CompanyDocumentProfileForPayrollWht | null): PayrollWorkerWhtPrintBaseOptions {
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

function variantsForMode(mode: string): WithholdingCertificateCopyVariant[] {
  switch (mode) {
    case 'copy1':
      return ['COPY_PAYEE_TAX_RETURN'];
    case 'copy2':
      return ['COPY_PAYEE_RECORD'];
    case 'payer':
      return ['COPY_PAYER_RECORD'];
    case 'all':
    default:
      return [...ALL_VARIANTS];
  }
}

export function WorkerPayrollWhtBatchDialog({
  firestore,
  batch,
  linesSorted,
  periodLabel,
  companyProfile,
  currentUser,
  disabled,
  disabledTitle,
}: {
  firestore: Firestore | null;
  batch: PayrollBatch;
  linesSorted: PayrollBatchLine[];
  periodLabel: string;
  companyProfile: CompanyDocumentProfileForPayrollWht | null;
  currentUser: User;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [prep, setPrep] = useState<PayrollWorkerWhtLinePrep[]>([]);
  const [issueYmd, setIssueYmd] = useState(() => timestampMsToBangkokYmd(Date.now()));
  const [copyMode, setCopyMode] = useState<string>('all');

  const paymentYmd = useMemo(() => resolvePayrollWorkerWhtPaymentDateYmd(batch), [batch]);

  useEffect(() => {
    if (open) setIssueYmd(timestampMsToBangkokYmd(Date.now()));
  }, [open]);

  useEffect(() => {
    if (!open || !firestore || linesSorted.length === 0) {
      setPrep([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const workersById = new Map<string, Worker>();
      const positionsById = new Map<string, Position>();
      await Promise.all(
        linesSorted.map(async (line) => {
          try {
            const ws = await getDoc(doc(firestore, 'workers', line.workerId));
            if (!ws.exists()) return;
            const w = ws.data() as Worker;
            workersById.set(line.workerId, w);
            if (w.currentPositionId && !positionsById.has(w.currentPositionId)) {
              const ps = await getDoc(doc(firestore, 'positions', w.currentPositionId));
              if (ps.exists()) positionsById.set(w.currentPositionId, ps.data() as Position);
            }
          } catch {
            /* row skip */
          }
        }),
      );
      if (cancelled) return;

      const rows: PayrollWorkerWhtLinePrep[] = linesSorted.map((line) => {
        const worker = workersById.get(line.workerId) ?? null;
        const posId = worker?.currentPositionId;
        const position = posId ? positionsById.get(posId) ?? null : null;
        const validation = validatePayrollWorkerWhtPrint({
          company: companyProfile,
          worker,
          batch,
          line,
          paymentDateYmd: paymentYmd,
        });
        let vm = null;
        if (worker && paymentYmd && validation.ok) {
          try {
            vm = buildPayrollWorkerWhtPrintVm({
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
            vm = null;
          }
        }
        return {
          lineId: line.id,
          workerId: line.workerId,
          workerNameSnapshot: line.workerNameSnapshot,
          vm,
          validation,
        };
      });
      setPrep(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, firestore, linesSorted, batch, companyProfile, periodLabel, issueYmd, paymentYmd]);

  const summary = useMemo(() => {
    const total = prep.length;
    const ok = prep.filter((p) => p.validation.ok && p.vm).length;
    const warn = prep.filter((p) => p.validation.ok && p.vm && p.validation.warnings.length > 0).length;
    const bad = prep.filter((p) => !p.validation.ok || !p.vm).length;
    return { total, ok, warn, bad };
  }, [prep]);

  const mergedPreviewHtml = useMemo(() => {
    const opts = printOpts(currentUser, companyProfile);
    const variantList = variantsForMode(copyMode);
    const bodies: string[] = [];
    let firstHead = '';
    for (const row of prep) {
      if (!row.vm) continue;
      const full = buildPayrollWorkerWhtCertificateMultiHtml(row.vm, variantList, opts);
      if (!firstHead) {
        const headMatch = full.match(/<head[^>]*>([\s\S]*)<\/head>/i);
        firstHead = headMatch ? headMatch[1] : '';
      }
      const bodyMatch = full.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch) bodies.push(bodyMatch[1]);
    }
    return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"/>${firstHead}</head><body>${bodies.join('')}</body></html>`;
  }, [prep, copyMode, currentUser, companyProfile]);

  const handlePrintAll = useCallback(async () => {
    if (!firestore) return;
    const opts = printOpts(currentUser, companyProfile);
    const variantList = variantsForMode(copyMode);
    const bodies: string[] = [];
    let firstHead = '';
    let printed = 0;
    for (const row of prep) {
      if (!row.vm) continue;
      const full = buildPayrollWorkerWhtCertificateMultiHtml(row.vm, variantList, opts);
      if (!firstHead) {
        const headMatch = full.match(/<head[^>]*>([\s\S]*)<\/head>/i);
        firstHead = headMatch ? headMatch[1] : '';
      }
      const bodyMatch = full.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch) {
        bodies.push(bodyMatch[1]);
        printed++;
      }
    }
    const docHtml = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"/>${firstHead}</head><body>${bodies.join('')}</body></html>`;
    openPayrollWorkerWhtPrintWindow(docHtml);
    try {
      await auditPayrollWorkerWhtBatchPrint(firestore, currentUser, {
        batchId: batch.id,
        linesAttempted: prep.length,
        linesPrinted: printed,
        linesSkipped: prep.length - printed,
        copyMode,
        result: 'success',
      });
    } catch {
      /* ignore */
    }
  }, [firestore, prep, copyMode, currentUser, companyProfile, batch.id]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1" disabled={disabled} title={disabledTitle}>
          <Printer className="h-4 w-4 shrink-0" />
          พิมพ์ใบหักทั้ง batch
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto w-[calc(100vw-1rem)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>พิมพ์ใบหัก ณ ที่จ่ายทั้ง Batch (ลูกจ้าง)</DialogTitle>
          <DialogDescription>
            {batch.id} · {periodLabel}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> กำลังโหลดข้อมูลลูกจ้างและตรวจสอบ…
          </div>
        ) : null}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="rounded border p-2">
            <div className="text-muted-foreground text-xs">ทั้งหมด</div>
            <div className="font-bold text-lg">{summary.total}</div>
          </div>
          <div className="rounded border p-2 border-green-200 bg-green-50/80">
            <div className="text-muted-foreground text-xs">พร้อมพิมพ์</div>
            <div className="font-bold text-lg text-green-800">{summary.ok}</div>
          </div>
          <div className="rounded border p-2 border-amber-200 bg-amber-50/80">
            <div className="text-muted-foreground text-xs">มีคำเตือน</div>
            <div className="font-bold text-lg text-amber-900">{summary.warn}</div>
          </div>
          <div className="rounded border p-2 border-red-200 bg-red-50/80">
            <div className="text-muted-foreground text-xs">พิมพ์ไม่ได้</div>
            <div className="font-bold text-lg text-red-800">{summary.bad}</div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>โหมดสำเนา</Label>
          <Select value={copyMode} onValueChange={setCopyMode}>
            <SelectTrigger className="max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="copy1">ฉบับที่ 1 เท่านั้น</SelectItem>
              <SelectItem value="copy2">ฉบับที่ 2 เท่านั้น</SelectItem>
              <SelectItem value="payer">สำเนาผู้หักภาษีเท่านั้น</SelectItem>
              <SelectItem value="all">พิมพ์ครบชุด (ทุกฉบับต่อคน)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {summary.bad > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>มีบรรทัดที่ข้อมูลไม่ครบ</AlertTitle>
            <AlertDescription>
              <ScrollArea className="h-36 pr-3">
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {prep
                    .filter((p) => !p.validation.ok || !p.vm)
                    .map((p) => (
                      <li key={p.lineId}>
                        <strong>{p.workerNameSnapshot}</strong>: {p.validation.errors[0] || 'ไม่สามารถสร้างเอกสาร'}
                      </li>
                    ))}
                </ul>
              </ScrollArea>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={loading || summary.ok === 0} onClick={() => void handlePrintAll()}>
            Preview / Print ทั้งหมด (ข้ามผู้ที่ไม่พร้อม)
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          การพิมพ์ไม่แก้ไขข้อมูล Payroll — ระบบไม่บันทึกสถานะ ISSUED จนกว่าจะมี workflow ออกเอกสารในอนาคต
        </div>

        {prep.some((p) => p.vm) ? (
          <iframe title="batch-wht-preview" className="w-full min-h-[480px] border rounded-md bg-white" srcDoc={mergedPreviewHtml} />
        ) : (
          <p className="text-sm text-muted-foreground">ยังไม่มีตัวอย่าง — โหลดข้อมูลหรือไม่มีบรรทัดที่พร้อมพิมพ์</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
