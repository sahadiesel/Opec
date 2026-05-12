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
import type { ExecutivePayrollStaff, OfficePayrollLine, OfficePayrollRun, OfficeStaff, User } from '@/lib/types';
import type { WithholdingCertificateCopyVariant } from '@/lib/types';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import type { OfficePayrollWhtLinePrep } from '@/lib/payroll/payroll-office-wht-types';
import {
  validatePayrollOfficeWhtPrint,
  resolveOfficePayrollWhtPaymentDateYmd,
} from '@/lib/payroll/payroll-office-wht-model';
import { buildPayrollExecutiveWhtPrintVm, mergeExecutivePayrollStaffForWhtCertificate } from '@/lib/payroll/payroll-executive-wht-model';
import { timestampMsToBangkokYmd } from '@/lib/payroll/payroll-worker-wht-model';
import {
  buildPayrollWorkerWhtCertificateMultiHtml,
  openPayrollWorkerWhtPrintWindow,
  type PayrollWorkerWhtPrintBaseOptions,
} from '@/lib/payroll/payroll-worker-wht-print-html';
import { auditPayrollExecutiveWhtBatchPrint } from '@/lib/payroll/payroll-executive-wht-audit';

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

async function loadMergedStaffForLine(
  firestore: Firestore,
  line: OfficePayrollLine,
): Promise<OfficeStaff | null> {
  const exSnap = await getDoc(doc(firestore, 'executive_payroll_staff', line.staffId));
  if (!exSnap.exists()) return null;
  const exec = { id: exSnap.id, ...exSnap.data() } as ExecutivePayrollStaff;
  let linked: OfficeStaff | null = null;
  const linkId = (exec.linkedOfficeStaffId || '').trim();
  if (linkId) {
    const os = await getDoc(doc(firestore, 'office_staff', linkId));
    if (os.exists()) linked = { id: os.id, ...os.data() } as OfficeStaff;
  }
  return mergeExecutivePayrollStaffForWhtCertificate(exec, linked);
}

export function ExecutivePayrollWhtBatchDialog({
  firestore,
  run,
  linesSorted,
  periodLabel,
  companyProfile,
  currentUser,
  disabled,
  disabledTitle,
}: {
  firestore: Firestore | null;
  run: OfficePayrollRun;
  linesSorted: OfficePayrollLine[];
  periodLabel: string;
  companyProfile: CompanyDocumentProfileForPayrollWht | null;
  currentUser: User;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [prep, setPrep] = useState<OfficePayrollWhtLinePrep[]>([]);
  const [issueYmd, setIssueYmd] = useState(() => timestampMsToBangkokYmd(Date.now()));
  const [copyMode, setCopyMode] = useState<string>('all');

  const paymentYmd = useMemo(() => resolveOfficePayrollWhtPaymentDateYmd(run), [run]);

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
      const staffById = new Map<string, OfficeStaff | null>();
      await Promise.all(
        linesSorted.map(async (line) => {
          try {
            const merged = await loadMergedStaffForLine(firestore, line);
            staffById.set(line.staffId, merged);
          } catch {
            staffById.set(line.staffId, null);
          }
        }),
      );
      if (cancelled) return;

      const rows: OfficePayrollWhtLinePrep[] = linesSorted.map((line) => {
        const staff = staffById.get(line.staffId) ?? null;
        const validation = validatePayrollOfficeWhtPrint({
          company: companyProfile,
          staff,
          run,
          line,
          paymentDateYmd: paymentYmd,
          staffRegistry: 'executive_payroll_staff',
        });
        let vm = null;
        if (staff && paymentYmd && validation.ok) {
          try {
            vm = buildPayrollExecutiveWhtPrintVm({
              run,
              line,
              staff,
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
          staffId: line.staffId,
          staffNameSnapshot: line.staffName,
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
  }, [open, firestore, linesSorted, run, companyProfile, periodLabel, issueYmd, paymentYmd]);

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
      await auditPayrollExecutiveWhtBatchPrint(firestore, currentUser, {
        executivePayrollRunId: run.id,
        linesAttempted: prep.length,
        linesPrinted: printed,
        linesSkipped: prep.length - printed,
        copyMode,
        result: 'success',
      });
    } catch {
      /* ignore */
    }
  }, [firestore, prep, copyMode, currentUser, companyProfile, run.id]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1" disabled={disabled} title={disabledTitle}>
          <Printer className="h-4 w-4 shrink-0" />
          พิมพ์ใบหักทั้งงวด
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto w-[calc(100vw-1rem)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>พิมพ์ใบหัก ณ ที่จ่ายทั้งงวด (ผู้บริหาร)</DialogTitle>
          <DialogDescription>
            {run.payrollRunNo} · {periodLabel}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> กำลังโหลดทะเบียนผู้บริหารและตรวจสอบ…
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
                        <strong>{p.staffNameSnapshot}</strong>: {p.validation.errors[0] || 'ไม่สามารถสร้างเอกสาร'}
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

        {mergedPreviewHtml ? (
          <iframe title="executive-wht-batch-preview" className="w-full min-h-[400px] border rounded-md bg-white" srcDoc={mergedPreviewHtml} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
