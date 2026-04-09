'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Building2, FileText, Info } from 'lucide-react';
import { CommercialInvoice, Customer } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { doc } from 'firebase/firestore';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

function statusBadge(status: CommercialInvoice['status']) {
  switch (status) {
    case 'DRAFT':
      return <Badge variant="secondary">DRAFT</Badge>;
    case 'PENDING_CUSTOMER':
      return <Badge className="bg-amber-600">รอลูกค้า</Badge>;
    case 'ISSUED':
      return <Badge className="bg-green-600">Invoice แล้ว</Badge>;
    case 'VOID':
      return <Badge variant="outline">ยกเลิก</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function DraftInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  const canSee = useMemo(
    () => !!currentUser && canView(currentUser, 'draft_invoices'),
    [currentUser]
  );

  const invRef = useMemoFirebase(
    () => (firestore && canSee ? doc(firestore, 'commercial_invoices', id) : null),
    [firestore, canSee, id]
  );
  const { data: invoice, isLoading } = useDoc<CommercialInvoice>(invRef as any);

  const custRef = useMemoFirebase(
    () =>
      firestore && invoice?.customerId ? doc(firestore, 'customers', invoice.customerId) : null,
    [firestore, invoice?.customerId]
  );
  const { data: customer } = useDoc<Customer>(custRef as any);

  if (isUserLoading || userLoading || !currentUser) return null;

  if (!canSee) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6 text-muted-foreground">ไม่มีสิทธิ์</div>
      </AppShell>
    );
  }

  if (isLoading || !invoice) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6">กำลังโหลด…</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/draft-invoices">
              <ArrowLeft className="h-4 w-4 mr-1" />
              รายการ
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold flex items-center gap-2 flex-wrap">
              <FileText className="h-6 w-6 shrink-0" />
              <span className="font-mono">{invoice.invoiceNo}</span>
              {statusBadge(invoice.status)}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              ใบแจ้งหนี้เรียกเก็บ (ไม่ใช่ใบกำกับภาษี)
            </p>
          </div>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>ขั้นตอนถัดไป</AlertTitle>
          <AlertDescription>
            เมื่อลูกค้าอนุมัติแล้ว จะปรับสถานะเป็น Invoice จริง — ใบกำกับภาษีออกจากบัญชีหลังยืนยันการรับเงิน (เมนูใบกำกับภาษี)
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>หัวเอกสาร</CardTitle>
            <CardDescription>อ้างอิง PO / Wave และช่วง timesheet</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            <div className="flex items-start gap-2">
              <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <div className="text-muted-foreground text-xs">ลูกค้า</div>
                <div className="font-medium">{customer?.name ?? invoice.customerId}</div>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">วันที่เอกสาร</div>
              <div>{formatStoredDateThaiBE(invoice.issueDate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">ช่วง timesheet</div>
              <div>
                {formatStoredDateThaiBE(invoice.periodStart)} — {formatStoredDateThaiBE(invoice.periodEnd)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Wave</div>
              <div className="font-mono">
                {invoice.waveCode || '—'}{' '}
                <Link className="text-primary text-xs underline ml-2" href={`/waves`}>
                  (รหัส {invoice.waveId.slice(0, 10)}…)
                </Link>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">PO</div>
              <Link className="text-primary underline font-mono" href={`/purchase-orders/${invoice.poId}`}>
                เปิด PO
              </Link>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">ผู้สร้าง</div>
              <div>{invoice.createdByName}</div>
            </div>
          </CardContent>
        </Card>

        {invoice.generationWarnings && invoice.generationWarnings.length > 0 && (
          <Alert className="border-amber-200 bg-amber-50/80">
            <AlertTitle>คำเตือนตอนคำนวณ</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 text-sm space-y-1">
                {invoice.generationWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>รายการ ({invoice.lines?.length ?? 0} แถว)</CardTitle>
            <CardDescription>
              จาก timesheet ที่พร้อมวางบิล — รวม {invoice.timesheetCount ?? '—'} แถว timesheet
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">รายละเอียด</TableHead>
                  <TableHead className="text-right">จำนวน</TableHead>
                  <TableHead className="text-right">ราคา/หน่วย</TableHead>
                  <TableHead className="text-right pr-6">จำนวนเงิน</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoice.lines ?? []).map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="pl-6 max-w-md">
                      <div className="font-medium text-sm">{line.description}</div>
                      {line.workerName && (
                        <div className="text-xs text-muted-foreground">{line.workerName}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{line.quantity}</TableCell>
                    <TableCell className="text-right">
                      ฿{line.unitPrice.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right pr-6 font-medium">
                      ฿{line.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 flex flex-col sm:flex-row sm:justify-end gap-2 text-sm">
            <div className="text-right space-y-1">
              <div>
                <span className="text-muted-foreground">ยอดก่อน VAT ({invoice.vatPercent}%) </span>
                <span className="font-mono font-medium">
                  ฿{invoice.amountBeforeTax.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">VAT </span>
                <span className="font-mono font-medium">
                  ฿{invoice.vatAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="text-lg font-bold text-primary pt-2">
                รวม ฿{invoice.totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} {invoice.currency}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
