'use client';

import { useState, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ArrowLeft, 
  Search, 
  Filter, 
  History, 
  Download, 
  Calendar, 
  User, 
  Briefcase, 
  Waves, 
  Package,
  ArrowUpDown,
  ChevronRight,
  Info
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { 
  StoreItem, 
  StoreTransaction, 
  User as AppUser, 
  Worker, 
  Assignment, 
  Wave,
  TransactionType
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import Link from 'next/link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { formatYmdLocalThaiBE, formatTimeThaiBE } from '@/lib/date-thai';

export default function InventoryLedgerPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  const canAccess = useMemo(() => canAccessDomain(currentUser, 'store'), [currentUser]);

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // 1. Data Fetching — gate by store access
  const txQuery = useMemoFirebase(() => {
    if (!firestore || userLoading || isUserLoading || !firebaseUser || !canAccess) return null;
    return query(collection(firestore, 'store_transactions'), orderBy('createdAt', 'desc'), limit(500));
  }, [firestore, userLoading, isUserLoading, firebaseUser, canAccess]);
  const { data: transactions, isLoading: isTxLoading } = useCollection<StoreTransaction>(txQuery as any);

  const itemsQuery = useMemoFirebase(() => (firestore && canAccess ? collection(firestore, 'store_items') : null), [firestore, canAccess]);
  const { data: items } = useCollection<StoreItem>(itemsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore && canAccess ? collection(firestore, 'workers') : null), [firestore, canAccess]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const mobQuery = useMemoFirebase(() => (firestore && canAccess ? collection(firestore, 'mobilizations') : null), [firestore, canAccess]);
  const { data: assignments } = useCollection<Assignment>(mobQuery as any);

  const wavesQuery = useMemoFirebase(() => (firestore && canAccess ? collection(firestore, 'waves') : null), [firestore, canAccess]);
  const { data: waves } = useCollection<Wave>(wavesQuery as any);

  // 2. Logic: Filtering & Mapping
  const filteredLedger = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter(tx => {
      const item = items?.find(i => i.id === tx.itemId);
      const matchesSearch = item?.itemName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           item?.itemCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           tx.notes?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = typeFilter === 'ALL' || tx.transactionType === typeFilter;
      const matchesCategory = categoryFilter === 'ALL' || item?.category === categoryFilter;
      
      return matchesSearch && matchesType && matchesCategory;
    });
  }, [transactions, items, searchTerm, typeFilter, categoryFilter]);

  const categories = useMemo(() => {
    if (!items) return [];
    return Array.from(new Set(items.map(i => i.category))).sort();
  }, [items]);

  const getTransactionBadge = (type: TransactionType) => {
    switch (type) {
      case 'RECEIVE': return <Badge className="bg-green-600">RECEIVE</Badge>;
      case 'ISSUE': return <Badge variant="outline" className="text-orange-700 border-orange-200 bg-orange-50">ISSUE</Badge>;
      case 'RETURN': return <Badge className="bg-blue-600">RETURN</Badge>;
      case 'WRITEOFF': return <Badge variant="destructive">WRITEOFF</Badge>;
      case 'DAMAGED': return <Badge variant="destructive" className="bg-red-500">DAMAGED</Badge>;
      case 'LOST': return <Badge variant="destructive" className="bg-slate-900 text-white">LOST</Badge>;
      default: return <Badge variant="outline">{type}</Badge>;
    }
  };

  if (userLoading || isUserLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังตรวจสอบสิทธิ์…
      </div>
    );
  }
  if (!currentUser || !canAccess) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/store"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <History className="h-8 w-8 text-slate-600" /> ประวัติการเคลื่อนไหวสินค้า (Inventory Ledger)
            </h1>
            <p className="text-muted-foreground text-lg">
              ตรวจสอบการรับเข้า เบิก คืน และปรับยอดสต็อกทั้งหมดแบบละเอียด (Audit Trail)
            </p>
          </div>
          <Button variant="outline" className="gap-2 h-11">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>

        {/* Filters Card */}
        <Card className="shadow-sm border-none bg-card">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-muted-foreground">ค้นหา (Search)</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="รหัส, ชื่อสินค้า หรือบันทึก..." 
                    className="pl-9"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-muted-foreground">ประเภทรายการ (Type)</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="ทุกประเภท" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกประเภท (All Types)</SelectItem>
                    <SelectItem value="RECEIVE">รับของเข้า (RECEIVE)</SelectItem>
                    <SelectItem value="ISSUE">เบิกของออก (ISSUE)</SelectItem>
                    <SelectItem value="RETURN">รับคืน (RETURN)</SelectItem>
                    <SelectItem value="WRITEOFF">ตัดยอด (WRITEOFF)</SelectItem>
                    <SelectItem value="DAMAGED">ชำรุด (DAMAGED)</SelectItem>
                    <SelectItem value="LOST">สูญหาย (LOST)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-muted-foreground">หมวดหมู่ (Category)</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="ทุกหมวดหมู่" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกหมวดหมู่</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button variant="ghost" className="w-full gap-2 text-muted-foreground" onClick={() => {
                  setSearchTerm('');
                  setTypeFilter('ALL');
                  setCategoryFilter('ALL');
                }}>
                  <Filter className="h-4 w-4" /> ล้างตัวกรอง (Clear)
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Ledger Table */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isTxLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลประวัติ...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6 w-[150px]">วันที่ / เวลา</TableHead>
                    <TableHead className="font-bold">ประเภท</TableHead>
                    <TableHead className="font-bold">รหัส & ชื่ออุปกรณ์</TableHead>
                    <TableHead className="font-bold text-center">จำนวน</TableHead>
                    <TableHead className="font-bold">อ้างอิง (Ref)</TableHead>
                    <TableHead className="font-bold">ผู้เบิก / รายละเอียด</TableHead>
                    <TableHead className="text-right pr-6">ผู้บันทึก</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLedger.map((tx) => {
                    const item = items?.find(i => i.id === tx.itemId);
                    const worker = workers?.find(w => w.id === tx.workerId);
                    const asgn = assignments?.find(a => a.id === tx.assignmentId);
                    const wave = waves?.find(w => w.id === tx.waveId);

                    return (
                      <TableRow key={tx.id} className="hover:bg-muted/20 transition-colors group">
                        <TableCell className="pl-6 py-4">
                          <div className="flex flex-col text-[10px]">
                            <span className="font-bold text-primary flex items-center gap-1">
                              <Calendar className="h-2.5 w-2.5" /> {formatYmdLocalThaiBE(tx.transactionDate, tx.transactionDate || '—')}
                            </span>
                            <span className="text-muted-foreground">
                              {formatTimeThaiBE(tx.createdAt)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {getTransactionBadge(tx.transactionType)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-black text-sm text-primary flex items-center gap-1">
                              <Package className="h-3 w-3 text-muted-foreground" /> {item?.itemName || 'Unknown Item'}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">{item?.itemCode || 'N/A'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-black text-lg">
                          <span className={tx.transactionType === 'ISSUE' || tx.transactionType === 'WRITEOFF' ? 'text-red-600' : 'text-green-700'}>
                            {tx.transactionType === 'ISSUE' || tx.transactionType === 'WRITEOFF' ? '-' : '+'}{tx.quantity}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-1 font-normal">{item?.unit}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col text-[10px]">
                            <span className="font-bold text-muted-foreground uppercase">{tx.referenceType || 'Direct'}</span>
                            <span className="font-mono text-primary font-bold">{tx.referenceId?.substring(0, 12) || '-'}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            {worker && (
                              <span className="font-bold text-xs text-primary flex items-center gap-1">
                                <User className="h-2.5 w-2.5" /> {worker.firstName} {worker.lastName}
                              </span>
                            )}
                            {wave && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Waves className="h-2.5 w-2.5" /> {wave.waveCode}
                              </span>
                            )}
                            <span className="text-[10px] italic text-muted-foreground truncate max-w-[200px]">{tx.notes || '-'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] font-bold text-primary">{tx.createdBy}</span>
                            <span className="text-[9px] text-muted-foreground uppercase tracking-widest">Inventory Staff</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredLedger.length === 0 && !isTxLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">
                        ไม่พบข้อมูลการเคลื่อนไหวตามเงื่อนไขที่เลือก
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Audit Disclaimer */}
        <Card className="bg-primary/5 border-primary/10 border-dashed border-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-primary font-bold uppercase tracking-wider">
              <Info className="h-4 w-4" /> Audit Standard Compliance
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[10px] text-muted-foreground leading-relaxed">
            รายการทั้งหมดใน Ledger นี้ถูกบันทึกแบบถาวร (Immutable) และเชื่อมโยงกับบัญชีผู้ใช้ที่ทำรายการ ข้อมูลนี้ใช้สำหรับตรวจสอบย้อนกลับในกรณีที่สต็อกไม่ตรงหรือเกิดความสูญเสียในหน้างาน (Offshore/Onshore sites)
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
