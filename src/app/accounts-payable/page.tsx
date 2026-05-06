
'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ArrowDownLeft, 
  Search, 
  Filter, 
  Building2, 
  Calendar,
  AlertCircle,
  Clock,
  CircleDollarSign,
  Info
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AccountsPayable, APStatus, User, Vendor } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { collection, query, orderBy } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function AccountsPayablePage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'accounts_payable'),
    [currentUser]
  );

  const apQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'accounts_payable'), orderBy('billDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: apItems, isLoading } = useCollection<AccountsPayable>(apQuery as any);

  const vendorsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'vendors') : null), [firestore, isAuthorized]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const stats = useMemo(() => {
    if (!apItems) return { totalOutstanding: 0, overdue: 0, paid: 0 };
    return {
      totalOutstanding: apItems.reduce((sum, item) => sum + item.outstandingAmount, 0),
      overdue: apItems.filter(item => item.status === 'OVERDUE').reduce((sum, item) => sum + item.outstandingAmount, 0),
      paid: apItems.reduce((sum, item) => sum + item.creditAmount, 0),
    };
  }, [apItems]);

  const getStatusBadge = (status: APStatus) => {
    switch (status) {
      case 'OPEN': return <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50">OPEN</Badge>;
      case 'PARTIALLY_PAID': return <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50">PARTIAL</Badge>;
      case 'PAID': return <Badge className="bg-green-600">PAID</Badge>;
      case 'OVERDUE': return <Badge variant="destructive">OVERDUE</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ArrowDownLeft className="h-8 w-8" /> เจ้าหนี้การค้า (Accounts Payable)
          </h1>
          <p className="text-muted-foreground text-lg">
            ติดตามยอดค้างจ่ายคู่ค้า แยกตามรายใบแจ้งหนี้และวันครบกำหนด
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-l-8 border-l-blue-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดเจ้าหนี้ค้างจ่ายทั้งหมด</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-primary">฿ {stats.totalOutstanding.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Total Outstanding Liability</p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-red-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">หนี้เกินกำหนด (Overdue)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-red-600">฿ {stats.overdue.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Pending Urgent Payment</p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-green-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดชำระแล้ว (MTD)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-green-700">฿ {stats.paid.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Total Paid Current Month</p>
            </CardContent>
          </Card>
        </div>

        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold text-lg">Payment Planning Policy</AlertTitle>
          <AlertDescription className="text-sm">
            กรุณาตรวจสอบวันครบกำหนดชำระ (Due Date) เพื่อวางแผนกระแสเงินสด ระบบจะสร้างรายการ Cashbook อัตโนมัติเมื่อมีการบันทึกการจ่ายเงินในโมดูลที่เกี่ยวข้อง
          </AlertDescription>
        </Alert>

        <Alert className="border-amber-200 bg-amber-50/80">
          <Info className="h-5 w-5 text-amber-800" />
          <AlertTitle className="font-bold text-amber-950">ใบรับวางบิลจากคลัง</AlertTitle>
          <AlertDescription className="text-sm text-amber-900">
            เมื่อคลังส่งเอกสารจากเมนู{' '}
            <Link href="/ap-bills" className="font-semibold underline">
              รับวางบิลเจ้าหนี้ (AP Bills)
            </Link>{' '}
            รายการจะปรากฏที่นี่ — ตรวจสอบยอดและบันทึกจ่าย / ลง cashbook / หนังสือรับรองหัก ณ ที่จ่าย ทำในหน้ารายละเอียดใบรับวางบิลนั้น
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาชื่อคู่ค้า หรือ เลขที่เอกสาร..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลเจ้าหนี้...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">คู่ค้า (Vendor)</TableHead>
                    <TableHead className="font-bold">เอกสารอ้างอิง</TableHead>
                    <TableHead className="font-bold">วันที่ / ครบกำหนด</TableHead>
                    <TableHead className="font-bold text-right">ยอดหนี้ (Debit)</TableHead>
                    <TableHead className="font-bold text-right">จ่ายแล้ว (Credit)</TableHead>
                    <TableHead className="font-bold text-right">คงเหลือ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apItems?.map((item) => {
                    const vendor = vendors?.find(v => v.id === item.vendorId);
                    return (
                      <TableRow key={item.id} className="hover:bg-muted/20">
                        <TableCell className="py-4 pl-6">
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {vendor?.vendorName || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold text-primary">
                          {item.origin === 'STORE_VENDOR_BILL' ? (
                            <Link
                              href={`/store/vendor-bills/${item.id}`}
                              className="text-primary underline hover:no-underline"
                            >
                              {item.documentNo}
                            </Link>
                          ) : (
                            item.documentNo
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col text-[10px]">
                            <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="h-2.5 w-2.5" /> {item.billDate}</span>
                            <span className="flex items-center gap-1 font-bold text-red-600"><Clock className="h-2.5 w-2.5" /> Due: {item.dueDate}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">฿ {item.debitAmount.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-sm text-green-600">฿ {item.creditAmount.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-black text-primary">฿ {item.outstandingAmount.toLocaleString()}</TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {(!apItems || apItems.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการเจ้าหนี้ค้างจ่าย</TableCell>
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
