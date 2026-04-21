
'use client';

import { useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ArrowUpRight, 
  Search, 
  Filter, 
  Building2, 
  Calendar,
  AlertCircle,
  Clock,
  TrendingUp,
  CircleDollarSign,
  Info
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AccountsReceivable, ARStatus, User, Customer } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { collection, query, orderBy } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatStoredDateThaiBE } from '@/lib/date-thai';

export default function AccountsReceivablePage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'accounts_receivable'),
    [currentUser]
  );

  const arQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'accounts_receivable'), orderBy('issueDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: arItems, isLoading } = useCollection<AccountsReceivable>(arQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'customers') : null), [firestore, isAuthorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const stats = useMemo(() => {
    if (!arItems) return { totalOutstanding: 0, overdue: 0, collected: 0 };
    return {
      totalOutstanding: arItems.reduce((sum, item) => sum + item.outstandingAmount, 0),
      overdue: arItems.filter(item => item.status === 'OVERDUE').reduce((sum, item) => sum + item.outstandingAmount, 0),
      collected: arItems.reduce((sum, item) => sum + item.creditAmount, 0),
    };
  }, [arItems]);

  const getStatusBadge = (status: ARStatus) => {
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
            <ArrowUpRight className="h-8 w-8" /> ลูกหนี้การค้า (Accounts Receivable)
          </h1>
          <p className="text-muted-foreground text-lg">
            ติดตามยอดค้างชำระจากลูกค้า แยกตามรายใบกำกับภาษีและวันครบกำหนด
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-l-8 border-l-blue-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดลูกหนี้ค้างชำระทั้งหมด</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-primary">฿ {stats.totalOutstanding.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Total Outstanding Portfolio</p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-red-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ลูกหนี้เกินกำหนด (Overdue)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-red-600">฿ {stats.overdue.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Needs Urgent Collection</p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-green-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดเรียกเก็บได้แล้ว (MTD)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-green-700">฿ {stats.collected.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Cash Collected Current Month</p>
            </CardContent>
          </Card>
        </div>

        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold text-lg">Aging Report Policy</AlertTitle>
          <AlertDescription className="text-sm">
            ระบบจะคำนวณสถานะ OVERDUE อัตโนมัติเมื่อพ้นกำหนดชำระ (Due Date) — บันทึกการรับชำระและปิดลูกหนี้ผ่านบัญชี (Cashbook / ปรับสถานะ AR) ตามนโยบายบริษัท
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาชื่อลูกค้า หรือ เลขที่เอกสาร..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลลูกหนี้...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">ลูกค้า (Customer)</TableHead>
                    <TableHead className="font-bold">เอกสารอ้างอิง</TableHead>
                    <TableHead className="font-bold">วันที่ออก / ครบกำหนด</TableHead>
                    <TableHead className="font-bold text-right">ยอดขาย (Debit)</TableHead>
                    <TableHead className="font-bold text-right">รับแล้ว (Credit)</TableHead>
                    <TableHead className="font-bold text-right">คงเหลือ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {arItems?.map((item) => {
                    const customer = customers?.find(c => c.id === item.customerId);
                    return (
                      <TableRow key={item.id} className="hover:bg-muted/20">
                        <TableCell className="py-4 pl-6">
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold text-primary">{item.documentNo}</TableCell>
                        <TableCell>
                          <div className="flex flex-col text-[10px]">
                            <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="h-2.5 w-2.5" /> {formatStoredDateThaiBE(item.issueDate)}</span>
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
                  {(!arItems || arItems.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการลูกหนี้ค้างชำระ</TableCell>
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
