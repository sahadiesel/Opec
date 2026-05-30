'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { doc } from 'firebase/firestore';
import { useFirestore, useMemoFirebase, useDoc } from '@/firebase';
import { canViewPayrollPerFirestoreRules } from '@/lib/permission-core';
import type { OfficePayrollLine, OfficePayrollRun, User } from '@/lib/types';
import { buildPayslipFromOfficeLine, officePayrollRunStubFromLine } from '@/lib/payroll/payslip-model';
import { useOfficeStaffPayrollLines } from '@/lib/payroll/fetch-self-payroll-lines';
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
  selfProfileOnly,
}: {
  line: OfficePayrollLine;
  companyProfile?: CompanyDocumentProfileNames | null;
  /** My Profile — ไม่ลิงก์ไปพิมพ์ทั้งงวด (มีสลิปคนอื่น) */
  selfProfileOnly?: boolean;
}) {
  const firestore = useFirestore();
  const runId = line.officePayrollRunId;
  const runRef = useMemoFirebase(
    () => (firestore && runId && !selfProfileOnly ? doc(firestore, 'office_payroll_runs', runId) : null),
    [firestore, runId, selfProfileOnly],
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

  if (isLoading && !selfProfileOnly) {
    return (
      <TableRow>
        <TableCell colSpan={4} className="text-muted-foreground text-sm">
          กำลังโหลด…
        </TableCell>
      </TableRow>
    );
  }

  const runForPayslip = officePayrollRunStubFromLine(line, run ?? null);
  const model = buildPayslipFromOfficeLine(line, runForPayslip, companyProfile ?? undefined);

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{runForPayslip.payrollRunNo}</TableCell>
      <TableCell className="text-sm">{runForPayslip.payrollMonth}</TableCell>
      <TableCell className="text-right tabular-nums">฿{line.netPay.toLocaleString('th-TH')}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <PayslipDialog model={model} />
          {!selfProfileOnly && runId ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/office-payroll/${runId}/print`}>งวดเต็ม</Link>
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function OfficeStaffPayslipHistory({
  staffId,
  currentUser,
  selfProfileOnly = false,
  linkedUserId,
}: {
  staffId: string;
  currentUser: User | null;
  /** หน้า My Profile — เฉพาะสลิปของตนเอง ไม่เปิดงวดเต็ม */
  selfProfileOnly?: boolean;
  linkedUserId?: string | null;
}) {
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const allowed = canViewPayrollPerFirestoreRules(currentUser);

  const { lines, isLoading, error, syncHint, reload } = useOfficeStaffPayrollLines(
    firestore,
    staffId,
    allowed,
    selfProfileOnly && linkedUserId ? { linkedUserId } : undefined,
  );

  const sorted = useMemo(() => lines ?? [], [lines]);

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
        <CardDescription>
          {selfProfileOnly
            ? 'เฉพาะงวดของคุณจากทะเบียนที่ผูกบัญชี — กด «สลิป» เพื่อดู/พิมพ์'
            : 'จาก Office Payroll Line ที่เกี่ยวกับพนักงานนี้'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}
        {!isLoading && error ? (
          <p className="text-sm text-destructive py-4 text-center">{error}</p>
        ) : null}
        {!isLoading && !error && sorted.length === 0 && (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {syncHint || 'ยังไม่มีบรรทัด payroll'}
            </p>
            {selfProfileOnly ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
                โหลดสลิปจากระบบ
              </Button>
            ) : null}
          </div>
        )}
        {!isLoading && !error && sorted.length > 0 && (
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
                <StaffPayslipRow
                  key={line.id}
                  line={line}
                  companyProfile={companyProfile}
                  selfProfileOnly={selfProfileOnly}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
