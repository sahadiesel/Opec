
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  Warehouse, 
  Plus, 
  History, 
  AlertTriangle, 
  Package, 
  Search,
  HardHat,
  Hammer,
  Info,
  ChevronRight,
  PackageMinus,
  PackagePlus,
  Trash2,
  AlertCircle,
  Users,
  TrendingDown,
  ArrowRight,
  ClipboardList,
  CheckCircle2,
  BookOpen,
  ShieldAlert
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, query, orderBy, limit, where } from 'firebase/firestore';
import { StoreItem, StoreTransaction, User, Assignment, Worker } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function StoreDashboardPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  const canAccess = useMemo(() => canAccessDomain(currentUser, 'store'), [currentUser]);
  const isOpsOrHR = useMemo(
    () => canAccessDomain(currentUser, 'operations') || canAccessDomain(currentUser, 'hr'),
    [currentUser]
  );

  // 1. Data Fetching — gate by store access (operation + accounting)
  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || userLoading || isUserLoading || !firebaseUser || !canAccess) return null;
    return collection(firestore, 'store_items');
  }, [firestore, userLoading, isUserLoading, firebaseUser, canAccess]);
  const { data: items, isLoading: isItemsLoading } = useCollection<StoreItem>(itemsQuery as any);

  const txQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess) return null;
    return query(collection(firestore, 'store_transactions'), orderBy('createdAt', 'desc'), limit(50));
  }, [firestore, canAccess]);
  const { data: transactions } = useCollection<StoreTransaction>(txQuery as any);

  // 2. Mobilizations / workers — same store access (internal)
  const mobQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess) return null;
    return collection(firestore, 'mobilizations');
  }, [firestore, canAccess]);
  const { data: mobilizations } = useCollection<Assignment>(mobQuery as any);

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess) return null;
    return collection(firestore, 'workers');
  }, [firestore, canAccess]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  // 3. Calculated Stats
  const stats = useMemo(() => {
    if (!items) return { total: 0, low: 0, activePPE: 0, activeTools: 0 };
    return {
      total: items.length,
      low: items.filter(i => i.currentStock <= i.minimumStock).length,
      activePPE: items.filter(i => i.isPPE && i.active).length,
      activeTools: items.filter(i => i.isTool && i.active).length,
    };
  }, [items]);

  const stockAlerts = useMemo(() => {
    if (!items) return [];
    return items.filter(i => i.currentStock <= i.minimumStock && i.active);
  }, [items]);

  const pendingReturns = useMemo(() => {
    // If user cannot read workers or mobilizations, we cannot resolve the names
    // But we can still see raw transaction counts if we have access to transactions
    if (!transactions) return [];
    
    // Group all transactions by assignment
    const balanceMap: Record<string, { assignmentId: string; itemCount: number; totalQty: number }> = {};
    
    transactions.forEach(tx => {
      if (!tx.assignmentId) return;
      if (!balanceMap[tx.assignmentId]) {
        balanceMap[tx.assignmentId] = { assignmentId: tx.assignmentId, itemCount: 0, totalQty: 0 };
      }
      
      const change = tx.transactionType === 'ISSUE' ? tx.quantity : (tx.transactionType === 'RETURN' ? -tx.quantity : 0);
      balanceMap[tx.assignmentId].totalQty += change;
    });

    return Object.values(balanceMap)
      .filter(b => b.totalQty > 0)
      .map(b => {
        const asgn = mobilizations?.find(m => m.id === b.assignmentId);
        const worker = workers?.find(w => w.id === asgn?.workerId);
        return {
          ...b,
          workerName: worker ? `${worker.firstName} ${worker.lastName}` : (isOpsOrHR ? 'Unknown' : 'Restricted Access'),
          projectName: asgn?.projectName || (isOpsOrHR ? 'Unknown Project' : 'Restricted Access'),
          waveCode: asgn?.waveId || 'N/A'
        };
      });
  }, [transactions, mobilizations, workers, isOpsOrHR]);

  if (userLoading || isUserLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังตรวจสอบสิทธิ์…
      </div>
    );
  }
  if (!currentUser) return null;

  if (!canAccess) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-[1100px] mx-auto space-y-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Warehouse className="h-8 w-8" /> คลังอุปกรณ์ (Store / Inventory)
            </h1>
            <p className="text-muted-foreground text-lg">
              เมนูนี้ต้องใช้สิทธิ์ Store เพื่อดูข้อมูลสต็อกและธุรกรรมคลัง
            </p>
          </div>

          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
            <ShieldAlert className="h-5 w-5" />
            <AlertTitle className="font-bold">ไม่มีสิทธิ์เข้าใช้งานเมนูคลังอุปกรณ์</AlertTitle>
            <AlertDescription>
              บัญชีปัจจุบันยังไม่มีสิทธิ์ `store` ในโปรไฟล์สิทธิ์ กรุณาให้ผู้ดูแลระบบเพิ่มสิทธิ์ หรือใช้งานเมนูที่ได้รับอนุญาตแทน
            </AlertDescription>
          </Alert>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Warehouse className="h-8 w-8" /> คลังอุปกรณ์ (Store / Inventory)
          </h1>
          <p className="text-muted-foreground text-lg">
            ใช้สำหรับดูภาพรวมสต๊อก PPE และเครื่องมือ รวมถึงรายการคงค้าง การเบิก-คืน และของที่ต้องจัดซื้อเพิ่ม
          </p>
        </div>

        {/* Action Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <QuickActionCard 
            title="เบิกอุปกรณ์" 
            sub="Issue to Worker" 
            href="/store/issue" 
            icon={PackageMinus} 
            color="bg-primary" 
          />
          <QuickActionCard 
            title="รับคืนอุปกรณ์" 
            sub="Return from Worker" 
            href="/store/return" 
            icon={PackagePlus} 
            color="bg-blue-600" 
          />
          <QuickActionCard 
            title="รับของเข้า" 
            sub="Receive Stock" 
            href="/store/receive" 
            icon={Plus} 
            color="bg-green-600" 
          />
          <QuickActionCard 
            title="ตัดของออก" 
            sub="Write-off Stock" 
            href="/store/writeoff" 
            icon={Trash2} 
            color="bg-destructive" 
          />
          <QuickActionCard 
            title="สมุดบัญชีสินค้า" 
            sub="Inventory Ledger" 
            href="/store/ledger" 
            icon={BookOpen} 
            color="bg-slate-700" 
          />
          <QuickActionCard 
            title="ทะเบียนอุปกรณ์" 
            sub="Master Catalog" 
            href="/store/items" 
            icon={ClipboardList} 
            color="bg-slate-500" 
          />
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-6">
          <StatCard title="รายการอุปกรณ์" value={stats.total} sub="Total Catalog Items" icon={Package} colorClass="border-l-slate-400" />
          <StatCard title="PPE Active" value={stats.activePPE} sub="Safety Eq. Types" icon={HardHat} colorClass="border-l-orange-500" />
          <StatCard title="เครื่องมือ Active" value={stats.activeTools} sub="Tools & Assets" icon={Hammer} colorClass="border-l-blue-500" />
          <StatCard title="สินค้าใกล้หมด" value={stats.low} sub="Low Stock Alerts" icon={AlertTriangle} colorClass={stats.low > 0 ? "border-l-red-600 text-red-600" : "border-l-slate-200"} />
          <StatCard title="รายการค้างคืน" value={pendingReturns.length} sub="Pending Returns" icon={Users} colorClass="border-l-amber-600" />
          <StatCard title="ยอดค้างรวม" value={pendingReturns.reduce((sum, r) => sum + r.totalQty, 0)} sub="Items in Field" icon={TrendingDown} colorClass="border-l-indigo-600" />
        </div>

        <Tabs defaultValue="alerts" className="w-full">
          <TabsList className="grid grid-cols-4 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="alerts" className="gap-2 py-2 px-6">แจ้งเตือนสต็อก ({stockAlerts.length})</TabsTrigger>
            <TabsTrigger value="returns" className="gap-2 py-2 px-6">รายการค้างคืน ({pendingReturns.length})</TabsTrigger>
            <TabsTrigger value="recent" className="gap-2 py-2 px-6">ความเคลื่อนไหวล่าสุด</TabsTrigger>
            <TabsTrigger value="requirements" className="gap-2 py-2 px-6">ความต้องการจัดซื้อ</TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="mt-6 space-y-6">
            {stockAlerts.length > 0 ? (
              <Card className="border-red-200 shadow-lg overflow-hidden">
                <CardHeader className="bg-red-50/50 border-b border-red-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-red-700 flex items-center gap-2">
                        <AlertCircle className="h-5 w-5" /> สินค้าใกล้หมดหรือขาดแคลน (Stock Alerts)
                      </CardTitle>
                      <CardDescription>รายการสินค้าที่มีจำนวนคงเหลือต่ำกว่าเกณฑ์มาตรฐาน</CardDescription>
                    </div>
                    <Button variant="outline" className="text-red-700 border-red-200 hover:bg-red-100" asChild>
                      <Link href="/store/receive">สั่งซื้อ/รับเข้า <ArrowRight className="h-4 w-4 ml-2" /></Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="font-bold pl-6">รหัส</TableHead>
                        <TableHead className="font-bold">ชื่ออุปกรณ์</TableHead>
                        <TableHead className="font-bold">หมวดหมู่</TableHead>
                        <TableHead className="text-center font-bold">คงเหลือ</TableHead>
                        <TableHead className="text-center font-bold">เกณฑ์ขั้นต่ำ</TableHead>
                        <TableHead className="text-center font-bold text-red-600">จำนวนที่ขาด</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockAlerts.map((item) => (
                        <TableRow key={item.id} className="hover:bg-muted/30">
                          <TableCell className="pl-6 font-mono text-xs font-bold text-primary">{item.itemCode}</TableCell>
                          <TableCell className="font-bold text-primary">{item.itemName}</TableCell>
                          <TableCell><Badge variant="outline">{item.category}</Badge></TableCell>
                          <TableCell className="text-center">
                            <span className={`font-black ${item.currentStock === 0 ? 'text-red-600' : 'text-orange-600'}`}>
                              {item.currentStock} {item.unit}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">{item.minimumStock}</TableCell>
                          <TableCell className="text-center font-black text-red-600">
                            {Math.max(0, item.minimumStock - item.currentStock)}
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <Button size="sm" variant="ghost" asChild>
                              <Link href="/store/receive">รับเข้า <ChevronRight className="h-4 w-4" /></Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <div className="py-20 text-center space-y-4 border-2 border-dashed rounded-lg bg-muted/10">
                <CheckCircle2 className="h-12 w-12 mx-auto text-green-500/30" />
                <p className="text-muted-foreground italic">ไม่มีการแจ้งเตือนสต็อก ทุกรายการมีสินค้าเพียงพอ</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="returns" className="mt-6">
            {!isOpsOrHR && (
              <div className="p-10 mb-6">
                <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
                  <ShieldAlert className="h-5 w-5" />
                  <AlertTitle className="font-bold">จำกัดการเข้าถึง (Restricted Access)</AlertTitle>
                  <AlertDescription>
                    คุณไม่มีสิทธิ์เรียกดูรายชื่อคนงานและโครงการ กรุณาตรวจสอบประวัติการเบิกคืนจากสมุดบัญชีสินค้า (Inventory Ledger) แทน
                  </AlertDescription>
                </Alert>
              </div>
            )}
            <Card className="shadow-lg overflow-hidden border-none">
              <CardHeader className="bg-amber-50/50 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-amber-600" /> รายการค้างคืนจากคนงาน (Pending Returns)
                </CardTitle>
                <CardDescription>รายการ PPE และเครื่องมือที่พนักงานยังไม่ได้ส่งคืนหลังจบงานหรือ Demob</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-bold pl-6">พนักงาน (Worker)</TableHead>
                      <TableHead className="font-bold">โครงการ / โฟลว์</TableHead>
                      <TableHead className="font-bold">รอบงาน (Wave)</TableHead>
                      <TableHead className="text-center font-bold">จำนวนชิ้นที่ถือครอง</TableHead>
                      <TableHead className="text-right pr-6">ดำเนินการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingReturns.map((ret) => (
                      <TableRow key={ret.assignmentId} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="pl-6 font-bold text-primary">{ret.workerName}</TableCell>
                        <TableCell className="text-sm">{ret.projectName}</TableCell>
                        <TableCell><Badge variant="outline" className="font-mono bg-white">{ret.waveCode}</Badge></TableCell>
                        <TableCell className="text-center">
                          <Badge className="bg-amber-600 hover:bg-amber-700 font-bold px-3">
                            {ret.totalQty} รายการ
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button size="sm" variant="outline" className="border-amber-600 text-amber-700 hover:bg-amber-50 font-bold" asChild>
                            <Link href="/store/return">บันทึกรับคืน <ChevronRight className="h-4 w-4 ml-1" /></Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {pendingReturns.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการค้างคืนในขณะนี้</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="recent" className="mt-6">
            <Card className="shadow-lg border-none overflow-hidden">
              <CardHeader className="bg-muted/30 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" /> ประวัติการทำรายการ (Recent Transactions)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-bold pl-6">วันที่ (Date)</TableHead>
                      <TableHead className="font-bold">ประเภท</TableHead>
                      <TableHead className="font-bold">อุปกรณ์</TableHead>
                      <TableHead className="text-center font-bold">จำนวน</TableHead>
                      <TableHead className="font-bold">อ้างอิง / ผู้เบิก</TableHead>
                      <TableHead className="text-right pr-6">ผู้ทำรายการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions?.map((tx) => {
                      const item = items?.find(i => i.id === tx.itemId);
                      const worker = workers?.find(w => w.id === tx.workerId);
                      return (
                        <TableRow key={tx.id} className="hover:bg-muted/20">
                          <TableCell className="pl-6 text-xs text-muted-foreground">{tx.transactionDate}</TableCell>
                          <TableCell>
                            <Badge variant={
                              tx.transactionType === 'ISSUE' || tx.transactionType === 'WRITEOFF' || tx.transactionType === 'DAMAGED' || tx.transactionType === 'LOST' 
                              ? 'destructive' : 'default'
                            } className="uppercase text-[9px] font-bold">
                              {tx.transactionType}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium text-sm">{item?.itemName || 'N/A'}</TableCell>
                          <TableCell className="text-center font-bold">{tx.quantity}</TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">
                            {worker ? `${worker.firstName} ${worker.lastName}` : (tx.referenceId ? `Ref: ${tx.referenceId.substring(0,8)}` : (isOpsOrHR ? '-' : 'Restricted'))}
                          </TableCell>
                          <TableCell className="text-right pr-6 text-[10px] font-medium text-primary">{tx.createdBy}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
              <CardFooter className="bg-muted/10 border-t flex justify-center py-4">
                <Button variant="link" className="gap-2" asChild>
                  <Link href="/store/ledger">ดูประวัติทั้งหมด (Inventory Ledger) <ArrowRight className="h-4 w-4" /></Link>
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>

          <TabsContent value="requirements" className="mt-6">
            <Card className="shadow-lg border-none overflow-hidden">
              <CardHeader className="bg-blue-50/50 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-blue-600" /> แผนความต้องการอุปกรณ์ (Demand Requirements)
                </CardTitle>
                <CardDescription>คำนวณจากจำนวนพนักงานที่กำลังเตรียมส่งตัว (Mobilization Queue)</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-bold pl-6">อุปกรณ์</TableHead>
                      <TableHead className="text-center font-bold">ความต้องการ (Demand)</TableHead>
                      <TableHead className="text-center font-bold">พร้อมใช้งาน (Available)</TableHead>
                      <TableHead className="text-center font-bold text-red-600">ขาดแคลน (Shortage)</TableHead>
                      <TableHead className="text-right pr-6">คำแนะนำ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items?.filter(i => i.currentStock <= i.minimumStock).map(i => (
                      <TableRow key={i.id}>
                        <TableCell className="pl-6 font-bold text-primary">{i.itemName}</TableCell>
                        <TableCell className="text-center text-muted-foreground">-</TableCell>
                        <TableCell className="text-center font-bold">{i.currentStock}</TableCell>
                        <TableCell className="text-center font-black text-red-600">{i.minimumStock}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Badge variant="outline" className="bg-blue-50 text-blue-700">Recommend Purchase</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!items || items.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ไม่มีข้อมูลความต้องการพิเศษ</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm h-full`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-50 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black text-primary">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}

function QuickActionCard({ title, sub, icon: Icon, href, color }: any) {
  return (
    <Link href={href} className="block group">
      <Card className="h-full hover:shadow-lg transition-all border-none shadow-md overflow-hidden">
        <div className={`h-1.5 ${color}`} />
        <CardContent className="p-4 flex items-center gap-4 group-hover:bg-muted/10">
          <div className={`p-2 rounded-lg ${color} text-white shadow-sm`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-primary truncate leading-tight">{title}</p>
            <p className="text-[10px] text-muted-foreground font-medium truncate">{sub}</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </CardContent>
      </Card>
    </Link>
  );
}
