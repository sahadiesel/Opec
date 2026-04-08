'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banknote, Building2, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import type { PurchaseVendorBill, User, Vendor } from '@/lib/types';
import { formatDateThaiBE } from '@/lib/date-thai';

function purchaseTypeLabel(t: string | undefined): string {
  if (t === 'CASH') return 'เงินสด';
  if (t === 'CREDIT') return 'เครดิต';
  return t || '—';
}

export default function AccountingOutgoingReviewPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const authorized = useMemo(
    () => !!currentUser && canView(currentUser, 'accounts_payable'),
    [currentUser]
  );

  const billsQuery = useMemoFirebase(() => {
    if (!firestore || !authorized) return null;
    return query(collection(firestore, 'purchase_vendor_bills'), where('status', '==', 'SUBMITTED'));
  }, [firestore, authorized]);

  const { data: billsRaw, isLoading } = useCollection<PurchaseVendorBill>(billsQuery as any);

  const bills = useMemo(() => {
    const list = billsRaw || [];
    return [...list].sort((a, b) => (b.submittedToAccountingAt || b.createdAt) - (a.submittedToAccountingAt || a.createdAt));
  }, [billsRaw]);

  const vendorsQuery = useMemoFirebase(
    () => (firestore && authorized ? collection(firestore, 'vendors') : null),
    [firestore, authorized]
  );
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  if (userLoading || !currentUser) return null;

  if (!authorized) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
            <Banknote className="h-8 w-8" /> ตรวจสอบรายจ่าย (ใบรับวางบิลจากคลัง)
          </h1>
          <p className="text-muted-foreground">
            รายการที่สโตร์กดส่งแผนกบัญชีแล้ว — การส่งถือเป็นการยืนยันตรวจรับสินค้า/งานตามงวดนั้นแล้ว
          </p>
        </div>

        <Card className="border-emerald-200/60">
          <CardHeader>
            <CardTitle className="text-base">แนวทางบัญชี</CardTitle>
            <CardDescription className="space-y-2">
              <p>
                <strong>เงินสด:</strong> เปิดรายการ → กดจ่ายเงินและลงสมุดรายรับรายจ่าย (cashbook) ระบบจะตัดเจ้าหนี้และอัปเดตงวด PO
                อัตโนมัติ
              </p>
              <p>
                <strong>เครดิต:</strong> ตรวจสอบแล้วติดตามยอดที่{' '}
                <Link href="/accounts-payable" className="text-primary font-semibold underline">
                  เจ้าหนี้การค้า
                </Link>{' '}
                — เมื่อถึงกำหนดจ่ายค่อยบันทึกจ่ายจากหน้ารายละเอียดใบรับวางบิล
              </p>
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">คิวรอดำเนินการ ({bills.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-16 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่ใบรับวางบิล</TableHead>
                    <TableHead>PO / งวด</TableHead>
                    <TableHead>คู่ค้า</TableHead>
                    <TableHead>เงื่อนไข PO</TableHead>
                    <TableHead className="text-right">ยอด</TableHead>
                    <TableHead>ส่งเมื่อ</TableHead>
                    <TableHead className="text-right">ดำเนินการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.map((b) => {
                    const vendor = vendors?.find((v) => v.id === b.vendorId);
                    const amt = b.billAmount ?? 0;
                    const submitted = b.submittedToAccountingAt
                      ? formatDateThaiBE(b.submittedToAccountingAt)
                      : '—';
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono font-semibold">{b.receiptNo}</TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{b.purchaseNo || b.purchaseId}</div>
                          {b.notes ? <div className="text-xs text-muted-foreground">{b.notes}</div> : null}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1 text-sm">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {vendor?.vendorName || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{purchaseTypeLabel(b.purchaseType)}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ฿{amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{submitted}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" asChild className="gap-1">
                            <Link href={`/store/vendor-bills/${b.id}`}>
                              <FileText className="h-3.5 w-3.5" />
                              เปิดรายการ
                              <ExternalLink className="h-3 w-3 opacity-60" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {bills.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
                        ไม่มีใบรับวางบิลที่รอตรวจสอบ/จ่าย
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
