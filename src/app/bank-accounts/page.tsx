'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Filter, 
  ChevronRight, 
  CreditCard, 
  Building2, 
  Info, 
  Trash2,
  Wallet
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { BankAccount, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function BankAccountsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isAuthorized = useMemo(() => {
    const authRoles = ['system_admin', 'finance_officer'];
    return currentUser?.roleIds?.some(r => authRoles.includes(r)) || false;
  }, [currentUser]);

  const accountsQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !isAuthorized) return null;
    return collection(firestore, 'bank_accounts');
  }, [firestore, isUserLoading, firebaseUser, isAuthorized]);

  const { data: accounts, isLoading } = useCollection<BankAccount>(accountsQuery as any);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!firestore) return;
    if (confirm('ยืนยันการลบข้อมูลบัญชีธนาคาร?')) {
      deleteDocumentNonBlocking(doc(firestore, 'bank_accounts', id));
      toast({ title: "ลบข้อมูลสำเร็จ" });
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <CreditCard className="h-8 w-8" /> บัญชีธนาคาร (Bank Accounts)
          </h1>
          <p className="text-muted-foreground text-lg">
            จัดการข้อมูลบัญชีธนาคารของบริษัท สำหรับการจ่ายเงินเดือน จ่ายคู่ค้า และรับชำระเงินจากลูกค้า
          </p>
        </div>

        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold text-lg">นโยบายข้อมูลการเงิน (Financial Data Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            บัญชีธนาคารจะถูกใช้ในระบบรับเงิน จ่ายเงิน และรายงาน Cashbook กรุณาตรวจสอบเลขที่บัญชีให้ถูกต้องเพื่อป้องกันความผิดพลาดในการโอนเงิน
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาตามรหัส หรือ ชื่อบัญชี..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 px-4 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Button className="gap-2 h-11 px-6 bg-primary font-bold shadow-md" onClick={() => router.push('/bank-accounts/new')}>
            <Plus className="h-5 w-5" /> เพิ่มบัญชีธนาคาร (Add Account)
          </Button>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground animate-pulse">กำลังโหลดข้อมูลบัญชีธนาคาร...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">รหัส (Code)</TableHead>
                    <TableHead className="font-bold">ธนาคาร & ชื่อบัญชี</TableHead>
                    <TableHead className="font-bold">เลขที่บัญชี</TableHead>
                    <TableHead className="font-bold">ประเภท</TableHead>
                    <TableHead className="font-bold text-right">ยอดเงินปัจจุบัน</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts?.map((acc) => (
                    <TableRow 
                      key={acc.id} 
                      className="cursor-pointer hover:bg-muted/30 group transition-all"
                      onClick={() => router.push(`/bank-accounts/${acc.id}`)}
                    >
                      <TableCell className="py-4 pl-6 font-mono text-xs font-bold text-primary">{acc.accountCode}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold text-base text-primary">{acc.bankName}</span>
                          <span className="text-xs text-muted-foreground font-medium">{acc.accountName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{acc.accountNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-bold">
                          {acc.accountType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-black text-primary">
                        {acc.currency} {acc.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={acc.status === 'ACTIVE' ? 'default' : 'secondary'} className={acc.status === 'ACTIVE' ? 'bg-green-600' : ''}>
                          {acc.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => handleDelete(acc.id, e)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!accounts || accounts.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีข้อมูลบัญชีธนาคารในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Wallet className="h-5 w-5" /> การใช้งานบัญชีธนาคาร (Account Usage)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
              <div className="p-4 bg-white rounded-md border shadow-sm">
                <p className="font-bold text-primary mb-1">Payroll</p>
                <p className="text-muted-foreground text-xs">ใช้สำรองเงินสำหรับการโอนจ่ายเงินเดือนพนักงานและคนงาน</p>
              </div>
              <div className="p-4 bg-white rounded-md border shadow-sm">
                <p className="font-bold text-primary mb-1">Supplier Payment</p>
                <p className="text-muted-foreground text-xs">ใช้สำหรับชำระค่าสินค้าและบริการให้กับคู่ค้า (Vendors)</p>
              </div>
              <div className="p-4 bg-white rounded-md border shadow-sm">
                <p className="font-bold text-primary mb-1">Customer Receipts</p>
                <p className="text-muted-foreground text-xs">ระบุเป็นบัญชีที่ลูกค้าโอนเงินเข้าเมื่อชำระค่าบริการ</p>
              </div>
              <div className="p-4 bg-white rounded-md border shadow-sm">
                <p className="font-bold text-primary mb-1">Cashbook</p>
                <p className="text-muted-foreground text-xs">ยอดเงินคงเหลือจะถูกนำมาสรุปในรายงานกระแสเงินสด</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
