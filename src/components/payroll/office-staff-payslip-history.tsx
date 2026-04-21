'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { collectionGroup, limit, query, where, doc } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { canViewPayrollPerFirestoreRules } from '@/lib/permission-core';
import type { OfficePayrollLine, OfficePayrollRun, User } from '@/lib/types';
import { buildPayslipFromOfficeLine } from '@/lib/payroll/payslip-model';
import type { CompanyDocumentProfileNames } from '@/hooks/use-company-document-profile';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

function StaffPayslipRow({
  line,
  companyProfile,
}: {
  line: OfficePayrollLine;
  companyProfile?: CompanyDocumentProfileNames | null;
}) {
  const firestore = useFirestore();
  const runId = line.officePayrollRunId;
  const runRef = useMemoFirebase(
    () => (firestore && runId ? doc(firestore, 'office_payroll_runs', runId) : null),
    [firestore, runId]
  );
  const { data: run, isLoading } = useDoc<OfficePayrollRun>(runRef as any);

  if (!runId) {
    return (
      <TableRow>
        <TableCell className="text-xs text-muted-foreground">—</TableCell>
        <TableCell colSpan={3} className="text-muted-foreground text-sm">
          บรรทัดเก่าไม่มีรหัสงวด — เปิดจากหน้างวด office payroll
        </TableCell>
      </TableRow>
    );
  }

  if (isLoading || !run) {
    return (
      <TableRow>
        <TableCell colSpan={4} className="text-muted-foreground text-sm">
          {isLoading ? 'กำลังโหลด…' : 'ไม่พบงวด'}
        </TableCell>
      </TableRow>
    );
  }

  const model = buildPayslipFromOfficeLine(line, run, companyProfile ?? undefined);

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{run.payrollRunNo}</TableCell>
      <TableCell className="text-sm">{run.payrollMonth}</TableCell>
      <TableCell className="text-right tabular-nums">฿{line.netPay.toLocaleString('th-TH')}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <PayslipDialog model={model} />
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/office-payroll/${runId}/print`}>งวดเต็ม</Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function OfficeStaffPayslipHistory({ staffId, currentUser }: { staffId: string; currentUser: User | null }) {
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const allowed = canViewPayrollPerFirestoreRules(currentUser);

  const linesQuery = useMemoFirebase(
    () =>
      firestore && allowed
        ? query(collectionGroup(firestore, 'lines'), where('staffId', '==', staffId), limit(100))
        : null,
    [firestore, staffId, allowed]
  );
  const { data: lines, isLoading } = useCollection<OfficePayrollLine>(linesQuery as any);

  const sorted = useMemo(() => {
    if (!lines) return [];
    return [...lines].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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
        <CardTitle>สลิปเงินเดือน (Office Payroll)</CardTitle>
        <CardDescription>จาก Office Payroll Line ที่เกี่ยวกับพนักงานนี้</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}
        {!isLoading && sorted.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">ยังไม่มีบรรทัด payroll</p>
        )}
        {!isLoading && sorted.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เลขที่งวด</TableHead>
                <TableHead>เดือน</TableHead>
                <TableHead className="text-right">สุทธิ</TableHead>
                <TableHead className="text-right">สลิป</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((line) => (
                <StaffPayslipRow key={line.id} line={line} companyProfile={companyProfile} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
