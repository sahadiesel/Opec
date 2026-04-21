'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info, Percent } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import type { User, WithholdingAtSourceItem } from '@/lib/types';
import { formatDateThaiBE } from '@/lib/date-thai';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

export default function WithholdingTaxItemsPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const allowed = useMemo(
    () => !!currentUser && canView(currentUser, 'withholding_tax_items'),
    [currentUser]
  );

  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || !allowed) return null;
    return query(collection(firestore, 'withholding_at_source_items'), where('status', '==', 'OUTSTANDING'));
  }, [firestore, allowed]);

  const { data: rawItems, isLoading } = useCollection<WithholdingAtSourceItem>(itemsQuery as any);

  const items = useMemo(() => {
    if (!rawItems?.length) return [];
    return [...rawItems].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [rawItems]);

  const totalWht = useMemo(
    () => roundMoney2(items.reduce((s, i) => s + Number(i.whtAmount || 0), 0)),
    [items]
  );

  if (userLoading || !currentUser) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground text-sm">
        กำลังโหลด...
      </div>
    );
  }

  if (!allowed) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1200px] mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Percent className="h-7 w-7" /> รายการหัก ณ ที่จ่าย (ค้างนำส่งสรรพากร)
          </h1>
          <p className="text-muted-foreground mt-1">
            สรุปยอดหักจากการจ่ายคู่ค้า — เงินส่วนนี้<strong>ไม่ได้ตัดจากบัญชีธนาคาร</strong>ตอนโอนให้คู่ค้า ใช้สำหรับเตรียมนำส่งกรมสรรพากรตามรอบ
          </p>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>การทำงาน</AlertTitle>
          <AlertDescription className="text-sm leading-relaxed">
            เมื่อบันทึกจ่ายใบรับวางบิลที่มีหัก ณ ที่จ่าย ระบบตัดบัญชีธนาคารเฉพาะ<strong>สุทธิโอนให้คู่ค้า</strong> และสร้างรายการหักไว้ที่นี่
            — แผนกบัญชีสามารถสรุปยอดรวมด้านล่างเพื่อทำรายการนำส่งภาษี (ออกแบบขั้นตอน REMITTED/หักบัญชีแยกได้ในภายหลัง)
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-muted-foreground">จำนวนรายการค้าง</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-black text-primary">{items.length}</CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-amber-900">รวมยอดหัก ณ ที่จ่ายค้างนำส่ง</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-black text-amber-950">
              ฿ {totalWht.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">รายการ OUTSTANDING</CardTitle>
            <CardDescription>อ้างอิงจากใบรับวางบิล / รายการ cashbook สุทธิจ่ายคู่ค้า</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-16 text-center text-muted-foreground animate-pulse">กำลังโหลด...</div>
            ) : items.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm">ไม่มีรายการหัก ณ ที่จ่ายค้างนำส่ง</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">วันที่รายการ</TableHead>
                    <TableHead>ใบวางบิล / PO</TableHead>
                    <TableHead>คู่ค้า</TableHead>
                    <TableHead className="text-right">ยอดงวด (รวม VAT)</TableHead>
                    <TableHead className="text-right">หัก ณ ที่จ่าย</TableHead>
                    <TableHead className="text-right pr-6">Cashbook</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="pl-6 text-sm">
                        {row.entryDate ? formatDateThaiBE(row.entryDate) : '—'}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="font-mono font-semibold">{row.receiptNo}</span>
                        <span className="text-muted-foreground"> · </span>
                        <Link
                          href={`/purchases/${row.purchaseId}`}
                          className="text-primary underline text-xs font-medium"
                        >
                          {row.purchaseNo || row.purchaseId}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={row.vendorName}>
                        {row.vendorName || row.vendorId}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        ฿{Number(row.grossPaymentAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-amber-900">
                        ฿{Number(row.whtAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          {row.ratePercent}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6 font-mono text-xs text-muted-foreground">
                        {row.cashbookEntryNo || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
