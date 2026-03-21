
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  FileBarChart, 
  Search, 
  Filter, 
  Building2, 
  Calendar,
  Clock,
  ArrowUpRight,
  TrendingUp,
  Receipt,
  FileText,
  ShieldCheck,
  Download,
  Info
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { TaxInvoice, User, AccountsReceivable } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { PageGuidance } from '@/components/layout/page-guidance';

export default function ClientBillingViewPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const [searchTerm, setSearchTerm] = useState('');

  // 1. Data Queries scoped to client customerId
  const invQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'tax_invoices'), 
      where('customerId', '==', currentUser.customerId),
      orderBy('issueDate', 'desc')
    );
  }, [firestore, currentUser?.customerId]);
  const { data: invoices, isLoading: isInvLoading } = useCollection<TaxInvoice>(invQuery as any);

  const arQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'accounts_receivable'), 
      where('customerId', '==', currentUser.customerId),
      where('status', 'in', ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'])
    );
  }, [firestore, currentUser?.customerId]);
  const { data: arItems } = useCollection<AccountsReceivable>(arQuery as any);

  const stats = useMemo(() => {
    if (!arItems) return { outstanding: 0, count: 0 };
    return {
      outstanding: arItems.reduce((sum, item) => sum + item.outstandingAmount, 0),
      count: arItems.length
    };
  }, [arItems]);

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter(inv => 
      inv.taxInvoiceNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.issueDate.includes(searchTerm)
    );
  }, [invoices, searchTerm]);

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <FileBarChart className="h-8 w-8" /> เอกสารการเงินและการวางบิล (Billing & Invoices)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ตรวจสอบรายการใบกำกับภาษี ประวัติการรับเงิน และยอดค้างชำระ (Financial document tracking).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-l-8 border-l-blue-600 bg-blue-50/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">ยอดค้างชำระปัจจุบัน (Total Balance)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-primary">฿ {stats.outstanding.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-tighter">Outstanding from {stats.count} Invoices</p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-green-600 bg-green-50/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">รายการที่ชำระแล้ว (Paid MTD)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-green-700">฿ 0.00</div>
              <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-tighter">Confirmed Receipts this month</p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-primary bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Billing Terms</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-primary">Credit 30 Days</div>
              <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-tighter">Standard Commercial Policy</p>
            </CardContent>
          </Card>
        </div>

        <PageGuidance 
          tips={[
            "รายการ 'Tax Invoice' จะแสดงเฉพาะใบกำกับภาษีที่ได้ออกตามใบวางบิล (Billing Note) แล้วเท่านั้น",
            "ท่านสามารถกด 'Download' เพื่อดาวน์โหลดไฟล์เอกสารในรูปแบบ PDF (ถ้ามีในระบบ)",
            "ยอดค้างชำระ (Outstanding) จะอัปเดตอัตโนมัติเมื่อ OPEC ได้รับเงินโอนและออกใบเสร็จรับเงิน (Receipt) เรียบร้อยแล้ว"
          ]}
        />

        <div className="flex items-center gap-3 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ค้นหาตามเลขที่ใบกำกับภาษี..." 
              className="pl-9 h-11" 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <CardTitle className="text-lg">ประวัติใบกำกับภาษี (Invoice History)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isInvLoading ? (
              <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">เลขที่ใบกำกับภาษี (Invoice No.)</TableHead>
                    <TableHead className="font-bold">วันที่ออก (Issue Date)</TableHead>
                    <TableHead className="text-right font-bold">ยอดเงินรวม</TableHead>
                    <TableHead className="text-right font-bold">ยอดค้างชำระ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((inv) => {
                    const ar = arItems?.find(item => item.referenceId === inv.id);
                    const outstanding = ar ? ar.outstandingAmount : (inv.status === 'ISSUED' ? inv.totalAmount : 0);
                    
                    return (
                      <TableRow key={inv.id} className="hover:bg-muted/20 transition-all group">
                        <TableCell className="pl-6 py-4">
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            {inv.taxInvoiceNo}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-medium text-muted-foreground">
                          {inv.issueDate}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          ฿ {inv.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-black text-primary">
                          ฿ {outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={outstanding === 0 ? 'default' : 'outline'} className={outstanding === 0 ? 'bg-green-600' : 'uppercase text-[9px]'}>
                            {outstanding === 0 ? 'PAID' : inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button size="sm" variant="ghost" className="font-bold text-xs h-8 group">
                            <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredInvoices.length === 0 && !isInvLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ไม่พบประวัติการวางบิล</TableCell>
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
