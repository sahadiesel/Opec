'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Warehouse, 
  Plus, 
  History, 
  ArrowUpRight, 
  ArrowDownLeft, 
  AlertTriangle, 
  Package, 
  Search,
  ShoppingCart,
  HardHat,
  Hammer,
  Info,
  ChevronRight
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { StoreItem, StoreTransaction, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function StoreDashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const itemsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'store_items') : null), [firestore]);
  const { data: items } = useCollection<StoreItem>(itemsQuery as any);

  const txQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'store_transactions'), orderBy('createdAt', 'desc'), limit(10)) : null), [firestore]);
  const { data: transactions } = useCollection<StoreTransaction>(txQuery as any);

  if (!currentUser) return null;

  const lowStockCount = items?.filter(i => i.currentStock <= i.minimumStock).length || 0;
  const activePPE = items?.filter(i => i.isPPE && i.active).length || 0;
  const activeTools = items?.filter(i => i.isTool && i.active).length || 0;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Warehouse className="h-8 w-8" /> คลังอุปกรณ์ (Store / Inventory)
          </h1>
          <p className="text-muted-foreground text-lg">
            ใช้จัดการ PPE และเครื่องมือสำหรับงาน offshore โดยผูกกับตำแหน่งงาน Assignment และ Wave เพื่อควบคุมการเบิกและการคืนของอย่างถูกต้อง
          </p>
        </div>

        {/* Warning Notice */}
        <Alert className="bg-amber-50 border-amber-200 text-amber-800">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <AlertTitle className="font-bold">นโยบายการเบิกอุปกรณ์ (Issuance Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            ระบบต้องอนุญาตให้เบิกเฉพาะ PPE หรือเครื่องมือที่ระบุไว้ใน Position Requirement เท่านั้น หากอยู่นอก requirement ต้องใช้ขั้นตอนอนุมัติพิเศษ
          </AlertDescription>
        </Alert>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="รายการทั้งหมด" value={items?.length || 0} sub="Items in Catalog" icon={Package} colorClass="border-l-blue-600" />
          <StatCard title="PPE Active" value={activePPE} sub="Personal Protective Eq." icon={HardHat} colorClass="border-l-orange-500" />
          <StatCard title="เครื่องมือ Active" value={activeTools} sub="Tools & Equipment" icon={Hammer} colorClass="border-l-emerald-600" />
          <StatCard title="สินค้าใกล้หมด" value={lowStockCount} sub="Below Minimum Level" icon={AlertTriangle} colorClass={lowStockCount > 0 ? "border-l-red-600 text-red-600" : "border-l-slate-200"} />
        </div>

        {/* Action Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/store/issue" className="block">
            <Button className="w-full h-24 text-lg font-bold gap-3 shadow-md bg-primary hover:bg-primary/90">
              <ArrowUpRight className="h-6 w-6" /> เบิกอุปกรณ์ (Issue PPE/Tools)
            </Button>
          </Link>
          <Link href="/store/return" className="block">
            <Button variant="outline" className="w-full h-24 text-lg font-bold gap-3 shadow-md border-primary text-primary">
              <ArrowDownLeft className="h-6 w-6" /> รับคืนอุปกรณ์ (Return Items)
            </Button>
          </Link>
          <Link href="/store/receive" className="block">
            <Button variant="secondary" className="w-full h-24 text-lg font-bold gap-3 shadow-md">
              <Plus className="h-6 w-6" /> รับของเข้าคลัง (Receive Stock)
            </Button>
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Recent Transactions */}
          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xl flex items-center gap-2">
                  <History className="h-5 w-5" /> ประวัติการทำรายการล่าสุด (Recent Activity)
                </CardTitle>
                <CardDescription>รายการล่าสุด 10 รายการในคลัง</CardDescription>
              </div>
              <Button variant="ghost" asChild>
                <Link href="/store/transactions">ดูทั้งหมด <ChevronRight className="h-4 w-4 ml-1" /></Link>
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ประเภท</TableHead>
                    <TableHead>รายการ</TableHead>
                    <TableHead>จำนวน</TableHead>
                    <TableHead>วันที่</TableHead>
                    <TableHead>ผู้ดำเนินการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions?.map((tx) => {
                    const item = items?.find(i => i.id === tx.itemId);
                    return (
                      <TableRow key={tx.id}>
                        <TableCell>
                          <Badge variant={tx.transactionType === 'ISSUE' ? 'destructive' : 'default'} className="uppercase text-[10px]">
                            {tx.transactionType}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{item?.itemName || 'Unknown Item'}</TableCell>
                        <TableCell className="font-bold">{tx.quantity}</TableCell>
                        <TableCell className="text-xs">{tx.transactionDate}</TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">{tx.createdBy}</TableCell>
                      </TableRow>
                    );
                  })}
                  {(!transactions || transactions.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่มีประวัติการทำรายการ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Quick Links & Info */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">ระบบจัดการหลัก</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-between" asChild>
                  <Link href="/store/items">
                    <span className="flex items-center gap-2"><Package className="h-4 w-4" /> ทะเบียนอุปกรณ์ (Master Data)</span>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" className="w-full justify-between" asChild>
                  <Link href="/store/outstanding">
                    <span className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> รายการค้างคืน (Outstanding)</span>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-dashed">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2 text-primary">
                  <Info className="h-4 w-4" /> ขั้นตอนการทำงาน
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-3 text-muted-foreground">
                <p>1. <b>เลือก Worker & Assignment:</b> เพื่อดึงตำแหน่งงานมาตรวจสอบ Requirement</p>
                <p>2. <b>ตรวจสอบรายการ:</b> ระบบจะอนุญาตให้เบิกเฉพาะสิ่งที่ระบุในเมทริกซ์ตำแหน่งเท่านั้น</p>
                <p>3. <b>บันทึกการเบิก:</b> สต็อกจะถูกตัด และสถานะความพร้อมในหน้า Mobilization จะอัปเดต</p>
                <p>4. <b>คืนอุปกรณ์:</b> เมื่อพนักงานกลับจากหน้างาน (Demob) ต้องคืนอุปกรณ์เพื่อปิด Wave</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-50" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black text-primary">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
