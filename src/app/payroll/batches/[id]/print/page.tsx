'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { PayslipDocument } from '@/components/payroll/payslip-document';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { buildPayslipFromWorkerLine, isWorkerPayrollBatchSnapshotFrozen } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { sanitizePrintFileBaseName } from '@/lib/documents/standard-document-print';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useNormalBatchesAndLines } from '@/hooks/use-normal-batches-and-lines';
import { usePoPartyLabels } from '@/hooks/use-po-party-labels';
import type { PayrollBatch, PayrollBatchLine, PayrollPeriod, Position, User, Worker } from '@/lib/types';
import { positionListPrimaryName } from '@/lib/position-display';

export default function PayrollBatchPrintAllPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  const batchRef = useMemoFirebase(() => (firestore ? doc(firestore, 'payroll_batches', id) : null), [firestore, id]);
  const { data: batch, isLoading: loadingBatch } = useDoc<PayrollBatch>(batchRef as any);

  useEffect(() => {
    if (!batch?.id) return;
    const next = sanitizePrintFileBaseName(`payslips-worker-${batch.id}`);
    const prev = document.title;
    document.title = next;
    return () => {
      document.title = prev;
    };
  }, [batch?.id]);

  const linesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'payroll_batches', id, 'lines') : null), [firestore, id]);
  const { data: lines, isLoading: loadingLines } = useCollection<PayrollBatchLine>(linesQuery as any);

  const periodRef = useMemoFirebase(
    () => (firestore && batch ? doc(firestore, 'payroll_periods', batch.payrollPeriodId) : null),
    [firestore, batch?.payrollPeriodId]
  );
  const { data: period } = useDoc<PayrollPeriod>(periodRef as any);

  const periodLabel = period?.label || `${batch?.payrollPeriodId ?? ''}`;
  const { profile: companyProfile } = useCompanyDocumentProfile();

  const { normalBatches, normalLines, priorPaidRefs } = useNormalBatchesAndLines(
    batch?.payrollPeriodId,
    {
      isSupplemental: batch?.batchType === 'SUPPLEMENTAL',
      includePriorPaidForNormal: batch?.batchType !== 'SUPPLEMENTAL',
      currentBatchId: batch?.id,
      currentBatchStatus: batch?.status,
      currentBatchChronologyMs: batch?.createdAt ?? batch?.financePreparedAt ?? null,
    },
  );

  const poPartyLabelById = usePoPartyLabels(lines);

  const positionsQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'positions') : null),
    [firestore],
  );
  const { data: positions } = useCollection<Position>(positionsQuery as any);
  const workersQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'workers') : null),
    [firestore],
  );
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const positionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of positions ?? []) {
      const name = positionListPrimaryName(p).trim();
      if (p.id && name) m.set(p.id, name);
    }
    return m;
  }, [positions]);

  const fallbackPosByWorkerId = useMemo(() => {
    const workerById = new Map((workers ?? []).map((w) => [w.id, w]));
    const out = new Map<string, string>();
    for (const line of lines ?? []) {
      const snapPosId = String(line.laborCostResolutionSnapshot?.positionId || '').trim();
      const workerPosId = String(workerById.get(line.workerId)?.currentPositionId || '').trim();
      const posId = snapPosId || workerPosId;
      const name = posId ? positionNameById.get(posId) : undefined;
      if (name) out.set(line.workerId, name);
    }
    return out;
  }, [lines, workers, positionNameById]);

  /** สลิปพิมพ์จาก snapshot ในงวดเท่านั้น — ไม่คำนวณสูตรสด */
  const models = useMemo(() => {
    if (!batch || !lines?.length) return [];
    const sorted = [...lines].sort((a, b) =>
      (a.workerNameSnapshot || '').localeCompare(b.workerNameSnapshot || '', 'th', {
        sensitivity: 'base',
        numeric: true,
      }),
    );
    return sorted.map((line) => {
      const normalLine = normalLines.find((l) => l.workerId === line.workerId);
      const normalBatch = normalLine
        ? normalBatches.find((b) => b.id === normalLine.payrollBatchId)
        : undefined;
      const priorForWorker = priorPaidRefs.filter((r) => r.line.workerId === line.workerId);
      const lineFrozen = isWorkerPayrollBatchSnapshotFrozen(batch, {
        hasEarlierPaidInPeriod: priorForWorker.length > 0,
      });
      const fallbackPos = fallbackPosByWorkerId.get(line.workerId);
      return buildPayslipFromWorkerLine(
        line,
        batch,
        periodLabel,
        companyProfile ?? undefined,
        normalLine,
        normalBatch,
        priorForWorker,
        lineFrozen ? undefined : poPartyLabelById,
        {
          positionNameById,
          fallbackPositionName: fallbackPos,
        },
      );
    });
  }, [
    batch,
    lines,
    periodLabel,
    companyProfile?.companyNameTh,
    companyProfile?.companyNameEn,
    companyProfile?.documentHeaderLogoUrl,
    normalBatches,
    normalLines,
    priorPaidRefs,
    poPartyLabelById,
    positionNameById,
    fallbackPosByWorkerId,
  ]);

  const handlePrintAll = () => window.print();

  if (loadingBatch || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!batch) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-8 text-center text-muted-foreground">ไม่พบ batch</div>
      </AppShell>
    );
  }

  const eligible = ['HR_APPROVED', 'FINANCE_PREPARED', 'PAYMENT_EXPORTED', 'PAID', 'LOCKED'].includes(batch.status);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-2xl space-y-4 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/payroll/batches/${id}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">พิมพ์สลิปทั้ง batch</h1>
        </div>
        {!eligible && (
          <p className="text-sm text-amber-700">
            งวดนี้ยังไม่ HR อนุมัติ — สลิปยังไม่ควรแจกจ่ายอย่างเป็นทางการ (ยังพิมพ์ดูร่างได้)
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {lines?.length ?? 0} รายการ — ใช้ &quot;พิมพ์ / บันทึกเป็น PDF&quot; จากเบราว์เซอร์
        </p>
        <Button type="button" onClick={handlePrintAll} className="gap-2">
          <Printer className="h-4 w-4" /> พิมพ์ทั้งหมด / บันทึก PDF
        </Button>
      </div>

      <div className="mx-auto max-w-2xl space-y-8 print:space-y-0 print:max-w-none">
        {loadingLines && (
          <div className="flex justify-center py-20 print:hidden">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}
        {models.map((model, i) => (
          <div
            key={i}
            className="break-after-page print:break-after-page print:py-4 last:print:break-after-auto"
          >
            <PayslipDocument model={model} />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
