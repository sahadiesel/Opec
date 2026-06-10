'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ArrowLeft,
  Search,
  Filter,
  History,
  Download,
  Calendar,
  User,
  Waves,
  Package,
  Info,
  Building2,
  Briefcase,
  Printer,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  StoreItem,
  StoreTransaction,
  Worker,
  Assignment,
  Wave,
  TransactionType,
  OfficeStaff,
  formatStoreItemLabel,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import Link from 'next/link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import {
  buildInventoryLedgerPrintHtml,
  describeLedgerPrintFilters,
  ledgerBangkokYyyyMmNow,
  ledgerMonthSelectOptions,
  storeTransactionInLedgerMonth,
  type LedgerPrintContext,
} from '@/lib/store/inventory-ledger-print';
import { formatYmdLocalThaiBE, formatTimeThaiBE } from '@/lib/date-thai';
import { filterActiveWorkersForSelection } from '@/lib/hr/worker-active';
import { filterActiveOfficeStaffForSelection } from '@/lib/hr/office-staff-active';

type LedgerHolderPick = { kind: 'worker' | 'office'; id: string; displayName: string };

function normalizeLedgerSearch(s: string): string {
  return s.trim().toLowerCase();
}

export default function InventoryLedgerPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canAccess = useMemo(() => canAccessDomain(currentUser, 'store'), [currentUser]);

  const [itemSearchTerm, setItemSearchTerm] = useState('');
  const [holderSearchInput, setHolderSearchInput] = useState('');
  const [selectedHolder, setSelectedHolder] = useState<LedgerHolderPick | null>(null);
  const [holderSuggestOpen, setHolderSuggestOpen] = useState(false);
  const holderWrapRef = useRef<HTMLDivElement>(null);

  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [monthFilter, setMonthFilter] = useState(() => ledgerBangkokYyyyMmNow());
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  const monthOptions = useMemo(() => ledgerMonthSelectOptions(36), []);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!holderWrapRef.current?.contains(e.target as Node)) setHolderSuggestOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

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

  const officeStaffQuery = useMemoFirebase(() => (firestore && canAccess ? collection(firestore, 'office_staff') : null), [firestore, canAccess]);
  const { data: officeStaffList } = useCollection<OfficeStaff>(officeStaffQuery as any);

  const holderSuggestions = useMemo(() => {
    const q = normalizeLedgerSearch(holderSearchInput);
    if (q.length < 1) return [];
    type Sug = LedgerHolderPick & { sortKey: string };
    const out: Sug[] = [];
    for (const w of filterActiveWorkersForSelection(workers)) {
      const displayName = `${w.firstName || ''} ${w.lastName || ''}`.trim() || w.id;
      const hay = normalizeLedgerSearch(displayName);
      if (hay.includes(q) || normalizeLedgerSearch(w.id).includes(q)) {
        out.push({ kind: 'worker', id: w.id, displayName, sortKey: displayName });
      }
    }
    for (const s of filterActiveOfficeStaffForSelection(officeStaffList)) {
      const displayName = (s.fullName || '').trim() || s.id;
      const hay = normalizeLedgerSearch(displayName);
      if (hay.includes(q) || normalizeLedgerSearch(s.id).includes(q)) {
        out.push({ kind: 'office', id: s.id, displayName, sortKey: displayName });
      }
    }
    out.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'th'));
    return out.slice(0, 24);
  }, [holderSearchInput, workers, officeStaffList]);

  const requesterDisplayLabel = useCallback(
    (tx: StoreTransaction): string => {
      const oid = (tx.officeStaffId || '').trim();
      if (oid) {
        const st = officeStaffList?.find((o) => o.id === oid);
        return (st?.fullName || '').trim() || oid;
      }
      const wid = (tx.workerId || '').trim();
      if (wid) {
        const w = workers?.find((x) => x.id === wid);
        return `${w?.firstName || ''} ${w?.lastName || ''}`.trim() || wid;
      }
      return '';
    },
    [workers, officeStaffList],
  );

  // 2. Logic: Filtering & Mapping
  const filteredLedger = useMemo(() => {
    if (!transactions) return [];
    const itemQ = normalizeLedgerSearch(itemSearchTerm);
    const holderQ = normalizeLedgerSearch(holderSearchInput);

    return transactions.filter((tx) => {
      if (!storeTransactionInLedgerMonth(tx, monthFilter)) return false;

      const item = items?.find((i) => i.id === tx.itemId);
      const matchesItem =
        !itemQ ||
        (item?.itemName && normalizeLedgerSearch(item.itemName).includes(itemQ)) ||
        (item?.itemCode && normalizeLedgerSearch(item.itemCode).includes(itemQ)) ||
        (item?.variantSpecification &&
          normalizeLedgerSearch(item.variantSpecification).includes(itemQ)) ||
        (item && normalizeLedgerSearch(formatStoreItemLabel(item)).includes(itemQ));

      let matchesHolder = true;
      if (selectedHolder) {
        matchesHolder =
          (selectedHolder.kind === 'worker' && tx.workerId === selectedHolder.id) ||
          (selectedHolder.kind === 'office' && tx.officeStaffId === selectedHolder.id);
      } else if (holderQ) {
        const label = normalizeLedgerSearch(requesterDisplayLabel(tx));
        matchesHolder = Boolean(label && label.includes(holderQ));
      }

      const matchesType = typeFilter === 'ALL' || tx.transactionType === typeFilter;
      const matchesCategory = categoryFilter === 'ALL' || item?.category === categoryFilter;

      return matchesItem && matchesHolder && matchesType && matchesCategory;
    });
  }, [
    transactions,
    items,
    itemSearchTerm,
    holderSearchInput,
    selectedHolder,
    typeFilter,
    categoryFilter,
    monthFilter,
    requesterDisplayLabel,
  ]);

  const categories = useMemo(() => {
    if (!items) return [];
    return Array.from(new Set(items.map(i => i.category))).sort();
  }, [items]);

  const printFilterSummary = useMemo(
    () => ({
      monthYyyyMm: monthFilter,
      itemSearch: itemSearchTerm,
      holderLabel: selectedHolder?.displayName ?? holderSearchInput,
      typeFilter,
      categoryFilter,
    }),
    [monthFilter, itemSearchTerm, selectedHolder, holderSearchInput, typeFilter, categoryFilter],
  );

  const printContext: LedgerPrintContext = useMemo(
    () => ({ items, workers, assignments, waves, officeStaffList }),
    [items, workers, assignments, waves, officeStaffList],
  );

  const hasActiveFilters = useMemo(() => {
    return (
      monthFilter !== ledgerBangkokYyyyMmNow() ||
      itemSearchTerm.trim() !== '' ||
      holderSearchInput.trim() !== '' ||
      selectedHolder !== null ||
      typeFilter !== 'ALL' ||
      categoryFilter !== 'ALL'
    );
  }, [monthFilter, itemSearchTerm, holderSearchInput, selectedHolder, typeFilter, categoryFilter]);

  const runLedgerPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const rows = scope === 'filtered' ? filteredLedger : transactions ?? [];
      if (rows.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามตัวกรอง — ปรับตัวกรองหรือเลือกพิมพ์ทั้งหมด'
              : 'ยังไม่มีประวัติการเคลื่อนไหวในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines =
          scope === 'filtered' ? describeLedgerPrintFilters(printFilterSummary) : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';

        const body = buildInventoryLedgerPrintHtml({
          rows,
          ctx: printContext,
          scopeTitle,
          filterLines,
          generatedAt,
          printedBy: currentUser?.displayName,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Inventory-Ledger',
          suggestedFileName: `Inventory-Ledger-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!ok) {
          toast({
            variant: 'destructive',
            title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
            description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
          });
          return;
        }
        setPrintDialogOpen(false);
      } finally {
        setPrintBusy(false);
      }
    },
    [filteredLedger, transactions, printFilterSummary, printContext, currentUser, toast],
  );

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
          <Button variant="outline" className="gap-2 h-11" onClick={() => setPrintDialogOpen(true)}>
            <Printer className="h-4 w-4" /> พิมพ์รายการ
          </Button>
          <Button variant="outline" className="gap-2 h-11">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการสมุดบัญชีสินค้า</DialogTitle>
              <DialogDescription>
                เลือกพิมพ์ตามตัวกรองที่ตั้งไว้ หรือพิมพ์ทุกรายการในชุดข้อมูลล่าสุด (สูงสุด 500 รายการ)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {hasActiveFilters ? (
                <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                  <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                  <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                    {describeLedgerPrintFilters(printFilterSummary).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="text-xs font-medium pt-1">
                    จะพิมพ์ {filteredLedger.length} รายการ
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  ยังไม่ได้ตั้งตัวกรอง — 「พิมพ์ตามตัวกรอง」จะพิมพ์ทุกรายการในตาราง (เท่ากับพิมพ์ทั้งหมด)
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                ข้อมูลทั้งหมดในระบบ: {transactions?.length ?? 0} รายการ
              </p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filteredLedger.length === 0}
                onClick={() => void runLedgerPrint('filtered')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ตามตัวกรอง ({filteredLedger.length})
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={printBusy || !(transactions?.length)}
                onClick={() => void runLedgerPrint('all')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ทั้งหมด ({transactions?.length ?? 0})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Filters Card */}
        <Card className="shadow-sm border-none bg-card">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label className="text-xs font-bold uppercase text-muted-foreground">
                  เดือน (Month)
                </Label>
                <Select value={monthFilter} onValueChange={setMonthFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label className="text-xs font-bold uppercase text-muted-foreground">
                  ค้นหาอุปกรณ์ (Item)
                </Label>
                <div className="relative">
                  <Package className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="รหัสหรือชื่อสินค้า..."
                    className="pl-9"
                    value={itemSearchTerm}
                    onChange={(e) => setItemSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2 md:col-span-2" ref={holderWrapRef}>
                <Label className="text-xs font-bold uppercase text-muted-foreground">
                  ผู้เบิก / ผู้ถือครอง (Requester)
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-[1]" />
                  <Input
                    placeholder="พิมพ์ชื่อ — เลือกจากรายการที่โผล่..."
                    className="pl-9"
                    autoComplete="off"
                    value={holderSearchInput}
                    onChange={(e) => {
                      setHolderSearchInput(e.target.value);
                      setSelectedHolder(null);
                      setHolderSuggestOpen(true);
                    }}
                    onFocus={() => setHolderSuggestOpen(true)}
                  />
                  {holderSuggestOpen && holderSuggestions.length > 0 ? (
                    <ul
                      className="absolute left-0 right-0 top-full mt-1 max-h-56 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md z-50 py-1 text-sm"
                      role="listbox"
                    >
                      {holderSuggestions.map((s) => (
                        <li key={`${s.kind}:${s.id}`}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-muted/80 flex items-center gap-2"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSelectedHolder({ kind: s.kind, id: s.id, displayName: s.displayName });
                              setHolderSearchInput(s.displayName);
                              setHolderSuggestOpen(false);
                            }}
                          >
                            {s.kind === 'office' ? (
                              <Building2 className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
                            ) : (
                              <User className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                            )}
                            <span className="truncate">{s.displayName}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {s.kind === 'office' ? 'ออฟฟิศ' : 'ลูกจ้าง'}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {selectedHolder ? (
                  <p className="text-[10px] text-muted-foreground">
                    กรองเฉพาะรายการของ <strong className="text-foreground">{selectedHolder.displayName}</strong>{' '}
                    <button
                      type="button"
                      className="text-primary underline font-medium"
                      onClick={() => {
                        setSelectedHolder(null);
                        setHolderSearchInput('');
                      }}
                    >
                      ล้างการเลือก
                    </button>
                  </p>
                ) : null}
              </div>

              <div className="space-y-2 md:col-span-2">
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

              <div className="space-y-2 md:col-span-2">
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

              <div className="flex items-end md:col-span-2">
                <Button
                  variant="ghost"
                  className="w-full gap-2 text-muted-foreground"
                  onClick={() => {
                    setItemSearchTerm('');
                    setHolderSearchInput('');
                    setSelectedHolder(null);
                    setHolderSuggestOpen(false);
                    setTypeFilter('ALL');
                    setCategoryFilter('ALL');
                    setMonthFilter(ledgerBangkokYyyyMmNow());
                  }}
                >
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
                    const requesterName = requesterDisplayLabel(tx);
                    const slipNote =
                      tx.notes && /ref\s*(slip|return)/i.test(tx.notes)
                        ? tx.notes.replace(/\s+/g, ' ').trim().slice(0, 120)
                        : '';

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
                              <Package className="h-3 w-3 text-muted-foreground" />{' '}
                              {item ? formatStoreItemLabel(item) : 'Unknown Item'}
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
                        <TableCell className="max-w-[280px]">
                          <div className="flex flex-col gap-0.5">
                            {requesterName ? (
                              <span className="font-bold text-sm text-primary flex items-center gap-1.5">
                                {(tx.officeStaffId || '').trim() ? (
                                  <Building2 className="h-3.5 w-3.5 shrink-0 text-sky-700" aria-hidden />
                                ) : (
                                  <User className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                )}
                                <span className="leading-tight">{requesterName}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">— ไม่มีผู้เบิกในบรรทัด (เช่น รับเข้า/ตัดยอดคลัง)</span>
                            )}
                            {(tx.officeStaffId || '').trim() ? (
                              <span className="text-[10px] text-sky-800/90">พนักงานออฟฟิศ</span>
                            ) : worker && asgn ? (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Briefcase className="h-2.5 w-2.5 shrink-0" aria-hidden />
                                <span className="truncate">{asgn.projectName || 'งานมอบหมาย'}</span>
                              </span>
                            ) : null}
                            {wave && !(tx.officeStaffId || '').trim() ? (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Waves className="h-2.5 w-2.5 shrink-0" aria-hidden />
                                {wave.waveCode}
                              </span>
                            ) : null}
                            {slipNote ? (
                              <span className="text-[10px] text-muted-foreground truncate" title={tx.notes}>
                                {slipNote}
                              </span>
                            ) : tx.notes ? (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[260px]" title={tx.notes}>
                                {tx.notes}
                              </span>
                            ) : null}
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
