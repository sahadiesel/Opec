'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { collectionGroup, limit, query, where, doc } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { canViewPayrollPerFirestoreRules } from '@/lib/permission-core';
import type { PayrollBatch, PayrollBatchLine, User } from '@/lib/types';
import { buildPayslipFromWorkerLine } from '@/lib/payroll/payslip-model';
import type { CompanyDocumentProfileNames } from '@/hooks/use-company-document-profile';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

function WorkerPayslipRow({
  line,
  companyProfile,
}: {
  line: PayrollBatchLine;
  companyProfile?: CompanyDocumentProfileNames | null;
}) {
  const firestore = useFirestore();
  const batchRef = useMemoFirebase(
    () => (firestore && line.payrollBatchId ? doc(firestore, 'payroll_batches', line.payrollBatchId) : null),
    [firestore, line.payrollBatchId]
  );
  const { data: batch, isLoading } = useDoc<PayrollBatch>(batchRef as any);

  const periodLabel = `${line.periodStartDate} → ${line.periodEndDate}`;

  if (isLoading || !batch) {
    return (
      <TableRow>
        <TableCell colSpan={4} className="text-muted-foreground text-sm">
          {isLoading ? 'กำลังโหลด…' : 'ไม่พบ batch'}
        </TableCell>
      </TableRow>
    );
  }

  const model = buildPayslipFromWorkerLine(line, batch, periodLabel, companyProfile ?? undefined);

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{line.payrollBatchId}</TableCell>
      <TableCell className="text-sm">{periodLabel}</TableCell>
      <TableCell className="text-right tabular-nums">฿{line.netAmount.toLocaleString('th-TH')}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <PayslipDialog model={model} />
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/payroll/batches/${line.payrollBatchId}/print`}>งวดเต็ม</Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function WorkerPayslipHistory({ workerId, currentUser }: { workerId: string; currentUser: User | null }) {
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const allowed = canViewPayrollPerFirestoreRules(currentUser);

  const linesQuery = useMemoFirebase(
    () =>
      firestore && allowed
        ? query(collectionGroup(firestore, 'lines'), where('workerId', '==', workerId), limit(100))
        : null,
    [firestore, workerId, allowed]
  );
  const { data: lines, isLoading } = useCollection<PayrollBatchLine>(linesQuery as any);

  const sorted = useMemo(() => {
    if (!lines) return [];
    return [...lines].sort((a, b) => (b.periodEndDate || '').localeCompare(a.periodEndDate || ''));
  }, [lines]);

  if (!allowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>สลิปเงินเดือน</CardTitle>
          <CardDescription>คุณไม่มีสิทธ์ดูข้อมูลสลิปในระบบนี้</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>สลิปเงินเดือน (Worker Payroll)</CardTitle>
        <CardDescription>สรุปจาก Payroll Batch Line — ดู/พิมพ์ย้อนหลัง</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}
        {!isLoading && sorted.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">ยังไม่มีบรรทัด payroll สำหรับคนงานนี้</p>
        )}
        {!isLoading && sorted.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>งวด</TableHead>
                <TableHead className="text-right">สุทธิ</TableHead>
                <TableHead className="text-right">สลิป</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((line) => (
                <WorkerPayslipRow
                  key={`${line.payrollBatchId}_${line.id}`}
                  line={line}
                  companyProfile={companyProfile}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
