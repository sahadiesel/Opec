'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { EmployeeQuotaDocument, JobMode } from '@/lib/types';
import { formatDateThaiBE, formatTimeThaiBE } from '@/lib/date-thai';
import { ArrowLeft, FileText, Pencil } from 'lucide-react';

function jobModeLabel(mode: JobMode): string {
  return mode === 'ONSHORE' ? 'Onshore' : 'Offshore';
}

function displayDocNo(d: EmployeeQuotaDocument): string {
  return d.quotaDocumentNo?.trim() || d.id;
}

export default function QuotaDocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const docRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'employee_quota_documents', id) : null),
    [firestore, id],
  );
  const { data: quotaDoc, isLoading } = useDoc<EmployeeQuotaDocument>(docRef as any);

  const createdLabel = useMemo(() => {
    if (!quotaDoc?.createdAt) return '—';
    const ms = quotaDoc.createdAt;
    return `${formatDateThaiBE(ms)} ${formatTimeThaiBE(ms)}`;
  }, [quotaDoc?.createdAt]);

  const updatedLabel = useMemo(() => {
    if (!quotaDoc?.updatedAt || quotaDoc.updatedAt === quotaDoc.createdAt) return null;
    const ms = quotaDoc.updatedAt;
    return `${formatDateThaiBE(ms)} ${formatTimeThaiBE(ms)}`;
  }, [quotaDoc?.updatedAt, quotaDoc?.createdAt]);

  if (userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-4xl space-y-6 p-1">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" asChild className="gap-2">
            <Link href="/system-admin/employee-demo/quota-document">
              <ArrowLeft className="h-4 w-4" />
              รายการเอกสาร
            </Link>
          </Button>
          {quotaDoc ? (
            <Button size="sm" asChild className="gap-2">
              <Link href={`/system-admin/employee-demo/quota-document/${id}/edit`}>
                <Pencil className="h-4 w-4" />
                แก้ไข PO
              </Link>
            </Button>
          ) : null}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">กำลังโหลดเอกสาร…</p>
        ) : !quotaDoc ? (
          <Card>
            <CardHeader>
              <CardTitle>ไม่พบเอกสาร</CardTitle>
              <CardDescription>ตรวจสอบลิงก์หรือว่าเอกสารถูกลบแล้ว</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card className="border-primary/25">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                <FileText className="h-6 w-6 text-primary" />
                {displayDocNo(quotaDoc)}
              </CardTitle>
              <CardDescription className="space-y-1 font-mono text-xs">
                <div>รหัสอ้างอิง (Firestore): {quotaDoc.id}</div>
                <div>วันที่สร้าง: {createdLabel}</div>
                {updatedLabel ? <div>แก้ไขล่าสุด: {updatedLabel}</div> : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">ลูกค้า</span>
                  <p className="font-semibold">{quotaDoc.customerName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">ประเภทโควต้า (ราคา)</span>
                  <p className="font-semibold">{jobModeLabel(quotaDoc.quotaJobMode)}</p>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">PO ที่รวม ({quotaDoc.purchaseOrderIds.length})</span>
                  <p className="font-mono text-xs leading-relaxed break-all">
                    {quotaDoc.purchaseOrderIds.join(', ')}
                  </p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ตำแหน่ง</TableHead>
                    <TableHead className="text-right">โควต้ารวม (คน)</TableHead>
                    <TableHead>แยกตาม PO</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotaDoc.lines.map((row) => (
                    <TableRow key={row.positionId}>
                      <TableCell className="font-medium">{row.positionName}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.contributions.map((c) => (
                          <span key={c.poId} className="mr-2 inline-block whitespace-nowrap">
                            {c.poCode}: {c.quantity}
                          </span>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {quotaDoc.lines.length === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  ไม่มีบรรทัดโควต้า — ตรวจสอบ PO ที่ผูกไว้
                </p>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
