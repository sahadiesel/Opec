'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Coins, 
  Users, 
  Calendar, 
  Lock, 
  CheckCircle2, 
  History,
  Calculator,
  Loader2,
  ChevronRight,
  Info,
  Building2,
  FileText,
  CreditCard,
  Printer
} from 'lucide-react';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { buildPayslipFromWorkerLine } from '@/lib/payroll/payslip-model';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { PayrollBatch, PayrollBatchLine, User, PayrollPeriod } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { formatDateTimeThaiBE } from '@/lib/date-thai';
import { canGeneratePayslips } from '@/lib/permissions';

function lineDeductionsTotal(line: PayrollBatchLine): number {
  return Object.values(line.deductionsBreakdown || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

export default function PayrollBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const batchRef = useMemoFirebase(() => (firestore ? doc(firestore, 'payroll_batches', id) : null), [firestore, id]);
  const { data: batch, isLoading: isBatchLoading } = useDoc<PayrollBatch>(batchRef as any);

  const linesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'payroll_batches', id, 'lines') : null), [firestore, id]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<PayrollBatchLine>(linesQuery as any);

  const periodRef = useMemoFirebase(() => (firestore && batch ? doc(firestore, 'payroll_periods', batch.payrollPeriodId) : null), [firestore, batch?.payrollPeriodId]);
  const { data: period } = useDoc<PayrollPeriod>(periodRef as any);

  if (isBatchLoading || !batch || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  const isLocked = batch.status === 'LOCKED' || batch.status === 'PAID';
  const canGenerateWorkerPayslips = canGeneratePayslips(currentUser, batch.status);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/payroll/batches')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="space-y-2">
              <PayrollScopeTag scope="worker" showHint={false} />
              <h1 className="text-2xl font-bold tracking-tight">รายละเอียดงวดจ่ายลูกจ้าง (Batch)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{batch.id}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>Period: {period?.label || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild className="gap-1">
              <Link href={`/payroll/batches/${id}/print`}>
                <Printer className="h-4 w-4" />
                สลิปทั้ง batch
              </Link>
            </Button>
            <Badge variant={isLocked ? 'default' : 'outline'} className={isLocked ? 'bg-primary py-1.5 px-4' : 'py-1.5 px-4'}>
              {isLocked && <Lock className="h-3 w-3 mr-2" />}
              STATUS: {batch.status}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-l-8 border-l-blue-600 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Total Workers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-primary">{batch.totalWorkers} Persons</div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-amber-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Gross Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-primary">฿{batch.grossAmount.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-red-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Total Deductions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-primary">฿{batch.totalDeductions.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-green-600 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Net Payable</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-primary">฿{batch.netAmount.toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="lines" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="lines" className="gap-2 py-2 px-8">Settlement Lines</TabsTrigger>
            <TabsTrigger value="info" className="gap-2 py-2 px-8">Batch Metadata</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 px-8">Audit Trail</TabsTrigger>
          </TabsList>

          <TabsContent value="lines" className="mt-6">
            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6 py-4">Worker (Snapshot)</TableHead>
                      <TableHead>Payment Method</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right font-bold">Net Amount</TableHead>
                      <TableHead className="text-right pr-2 w-[100px]">สลิป</TableHead>
                      <TableHead className="text-right pr-6">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines?.map(line => {
                      const periodLabel = period?.label || batch.payrollPeriodId;
                      const slipModel = buildPayslipFromWorkerLine(line, batch, periodLabel);
                      return (
                      <TableRow key={line.id} className="hover:bg-muted/10">
                        <TableCell className="pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{line.workerNameSnapshot}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{line.workerId}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs">
                            <CreditCard className="h-3 w-3 text-muted-foreground" />
                            {line.workerPaymentProfileSnapshot?.paymentMethod || 'CASH'}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">฿{line.grossAmount.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs text-red-600">
                          ฿{lineDeductionsTotal(line).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-black text-primary">฿{line.netAmount.toLocaleString()}</TableCell>
                        <TableCell className="text-right pr-2">
                          {canGenerateWorkerPayslips ? (
                            <PayslipDialog model={slipModel} />
                          ) : (
                            <Badge variant="outline" className="text-[9px]">รอเตรียม/อนุมัติ</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Badge variant="outline" className="text-[9px] uppercase font-bold">{line.exportStatus}</Badge>
                        </TableCell>
                      </TableRow>
                    );})}
                    {(!lines || lines.length === 0) && !isLinesLoading && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">No settlement lines found in this batch.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="info" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle>Source Context</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Payroll Period:</span>
                    <span className="font-bold">{period?.label}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Date Range:</span>
                    <span className="font-bold">{period?.startDate} to {period?.endDate}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Work Mode Scope:</span>
                    <span className="font-bold uppercase">{batch.workModeScope}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Attribution</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Generated By:</span>
                    <span className="font-bold">{batch.createdBy}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Generated At:</span>
                    <span className="font-bold">{formatDateTimeThaiBE(batch.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <Card>
              <CardContent className="py-20 text-center text-muted-foreground italic">
                Detailed settlement logs will appear here upon next approval stage.
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
