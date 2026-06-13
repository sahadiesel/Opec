'use client';

import { useState, useMemo, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  Pencil,
  Save, 
  PackagePlus, 
  Building2, 
  Calendar, 
  ShoppingCart,
  CheckCircle2,
  Info,
  Loader2,
  Calculator,
  FileText,
  TrendingUp
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, doc, writeBatch, increment, query, orderBy } from 'firebase/firestore';
import { StoreItem, Vendor, Purchase, PurchaseLine, formatStoreItemLabel } from '@/lib/types';
import { computePurchaseTotalsFromLines } from '@/lib/purchase/pr-totals';
import {
  receiveLineFromStoreItem,
  resolveReceiveStockPick,
  variantLinesForParent,
} from '@/lib/store/receive-stock-select';
import { purchaseLineToReceivableStoreItem, resolvePurchaseLineStoreItem } from '@/lib/purchase/purchase-line-store-link';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { VendorSearchSelect } from '@/components/store/vendor-search-select';
import { StoreStockSearchSelect } from '@/components/store/store-stock-search-select';

interface ReceiveLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  variantSpecification?: string;
  quantity: number;
  unit: string;
  unitCost: number;
  currentStock: number;
  /** บรรทัดจาก PO — ราคาดึงจาก PO */
  purchaseLineId?: string;
  poDescription?: string;
  /** PO บรรทัดไม่มี storeItemId — ต้องเลือกผูกสต็อก */
  needsStockMapping?: boolean;
  /** เมนมีรุ่นย่อย — ต้องเลือก SKU ก่อนรับเข้า */
  needsVariantSelection?: boolean;
  mappingHeaderId?: string;
}

function emptyReceiveLine(): ReceiveLine {
  return {
    id: Math.random().toString(36).slice(2, 11),
    itemId: '',
    itemName: '',
    itemCode: '',
    quantity: 1,
    unit: 'หน่วย',
    unitCost: 0,
    currentStock: 0,
    needsStockMapping: true,
  };
}

function poLineToReceiveLine(pl: PurchaseLine, storeItems: StoreItem[]): ReceiveLine {
  const base = {
    id: pl.id,
    quantity: pl.quantity,
    unitCost: pl.unitPrice,
    purchaseLineId: pl.id,
    poDescription: pl.itemDescription,
  };

  const receivable = purchaseLineToReceivableStoreItem(pl, storeItems);
  if (receivable) {
    return receiveLineFromStoreItem(base, receivable);
  }

  const linked = resolvePurchaseLineStoreItem(pl, storeItems);
  if (linked?.catalogGroupRole === 'header') {
    return {
      ...base,
      itemId: '',
      itemName: linked.itemName,
      itemCode: linked.itemCode,
      unit: linked.unit,
      currentStock: 0,
      needsStockMapping: true,
      needsVariantSelection: true,
      mappingHeaderId: linked.id,
    };
  }

  return {
    ...base,
    itemId: '',
    itemName: pl.itemDescription,
    itemCode: pl.storeItemCode || '—',
    unit: 'หน่วย',
    currentStock: 0,
    needsStockMapping: true,
  };
}

const PO_RECEIVABLE_STATUSES: Purchase['status'][] = [
  'APPROVED',
  'ISSUED',
  'COMPLETED',
];

export default function StoreReceivePage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canAccess = useMemo(() => canAccessDomain(currentUser, 'store'), [currentUser]);

  // Header State
  const [receiveNo, setReceiveNo] = useState(getPreviewPattern('store_receive'));
  const [receiveDate, setReceiveDate] = useState(() => timestampToHtmlDateValue(Date.now()));
  const [vendorId, setVendorId] = useState('');
  const [refPurchaseId, setRefPurchaseId] = useState('');
  const [notes, setNotes] = useState('');

  // Items State
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Data Queries — gate by store access (operation + accounting read; operation write)
  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || userLoading || isUserLoading || !firebaseUser || !canAccess) return null;
    return collection(firestore, 'store_items');
  }, [firestore, userLoading, isUserLoading, firebaseUser, canAccess]);
  const { data: allStoreItems } = useCollection<StoreItem>(itemsQuery as any);

  const vendorsQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess) return null;
    return collection(firestore, 'vendors');
  }, [firestore, canAccess]);
  const { data: allVendors } = useCollection<Vendor>(vendorsQuery as any);

  const purchasesQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess) return null;
    return collection(firestore, 'purchases');
  }, [firestore, canAccess]);
  const { data: allPurchases } = useCollection<Purchase>(purchasesQuery as any);

  const purchaseLinesQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess || !refPurchaseId) return null;
    return collection(firestore, 'purchases', refPurchaseId, 'lines');
  }, [firestore, canAccess, refPurchaseId]);
  const { data: purchaseLines } = useCollection<PurchaseLine>(purchaseLinesQuery as any);

  const vendorPurchases = useMemo(() => {
    if (!vendorId || !allPurchases) return [];
    return allPurchases
      .filter((p) => p.vendorId === vendorId && PO_RECEIVABLE_STATUSES.includes(p.status))
      .sort((a, b) => String(b.purchaseDate || '').localeCompare(String(a.purchaseDate || '')));
  }, [allPurchases, vendorId]);

  const selectedPurchase = useMemo(
    () => (refPurchaseId ? allPurchases?.find((p) => p.id === refPurchaseId) : undefined),
    [allPurchases, refPurchaseId],
  );

  useEffect(() => {
    if (!refPurchaseId || !purchaseLines) return;
    setReceiveLines((prev) => {
      const manualLines = prev.filter((l) => !l.purchaseLineId);
      const fromPo = purchaseLines.map((pl) => poLineToReceiveLine(pl, allStoreItems ?? []));
      return [...fromPo, ...manualLines];
    });
  }, [refPurchaseId, purchaseLines, allStoreItems]);

  const handleVendorChange = (nextVendorId: string) => {
    setVendorId(nextVendorId);
    if (refPurchaseId) {
      const po = allPurchases?.find((p) => p.id === refPurchaseId);
      if (po?.vendorId !== nextVendorId) {
        setRefPurchaseId('');
        setReceiveLines([]);
      }
    }
  };

  const handlePurchaseChange = (purchaseId: string) => {
    if (purchaseId === 'none') {
      setRefPurchaseId('');
      setReceiveLines([]);
      return;
    }
    setRefPurchaseId(purchaseId);
    const po = allPurchases?.find((p) => p.id === purchaseId);
    if (po?.vendorId) setVendorId(po.vendorId);
  };

  const applyStoreItemToLine = (lineId: string, item: StoreItem) => {
    setReceiveLines((lines) =>
      lines.map((l) =>
        l.id === lineId
          ? {
              ...receiveLineFromStoreItem(
                {
                  id: l.id,
                  quantity: l.quantity,
                  unitCost: l.unitCost,
                  purchaseLineId: l.purchaseLineId,
                  poDescription: l.poDescription,
                },
                item,
              ),
            }
          : l,
      ),
    );
  };

  const handleMapPoLineToStock = (lineId: string, storeItemId: string) => {
    const pick = resolveReceiveStockPick(allStoreItems ?? [], storeItemId);
    if (!pick) return;
    if (pick.kind === 'pick_variant') {
      setReceiveLines((lines) =>
        lines.map((l) =>
          l.id === lineId
            ? {
                ...l,
                itemId: '',
                itemName: pick.header.itemName,
                itemCode: pick.header.itemCode,
                unit: pick.header.unit,
                currentStock: 0,
                needsStockMapping: true,
                needsVariantSelection: true,
                mappingHeaderId: pick.header.id,
              }
            : l,
        ),
      );
      return;
    }
    applyStoreItemToLine(lineId, pick.item);
  };

  const handlePickVariant = (lineId: string, variantId: string) => {
    const item = allStoreItems?.find((i) => i.id === variantId);
    if (!item || item.catalogGroupRole !== 'line') return;
    applyStoreItemToLine(lineId, item);
  };

  const handleEditLineMapping = (lineId: string) => {
    setReceiveLines((lines) =>
      lines.map((l) => {
        if (l.id !== lineId) return l;
        return {
          ...l,
          itemId: '',
          variantSpecification: undefined,
          currentStock: 0,
          needsStockMapping: true,
          needsVariantSelection: false,
          mappingHeaderId: undefined,
        };
      }),
    );
  };

  const handleAddEmptyLine = () => {
    setReceiveLines((prev) => [...prev, emptyReceiveLine()]);
  };

  const handleRemoveLine = (id: string) => {
    setReceiveLines(receiveLines.filter(l => l.id !== id));
  };

  const updateLine = (id: string, field: keyof ReceiveLine, value: any) => {
    setReceiveLines(receiveLines.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const summaryTotals = useMemo(() => {
    const lineSum = receiveLines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
    const vatMode = selectedPurchase?.vatTreatment ?? 'EXCLUSIVE';
    return computePurchaseTotalsFromLines(lineSum, vatMode, 0);
  }, [receiveLines, selectedPurchase]);

  const vatSummaryLabel = useMemo(() => {
    if (selectedPurchase?.vatTreatment === 'NONE') return 'ภาษีมูลค่าเพิ่ม (ไม่มี VAT ตาม PO):';
    if (selectedPurchase?.vatTreatment === 'INCLUSIVE') return 'ภาษีมูลค่าเพิ่ม (รวมในราคา PO):';
    if (selectedPurchase) return 'ภาษีมูลค่าเพิ่ม (7% ตาม PO):';
    return 'ภาษีมูลค่าเพิ่ม (7% Est.):';
  }, [selectedPurchase]);

  const hasIncompleteStockMapping = useMemo(
    () => receiveLines.some((l) => !l.itemId || l.needsStockMapping || l.needsVariantSelection),
    [receiveLines],
  );

  const handleConfirmReceive = async () => {
    if (!firestore || !currentUser || receiveLines.length === 0) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุรายการสินค้าที่ต้องการรับเข้า" });
      return;
    }
    if (receiveLines.some((l) => !l.itemId || l.needsStockMapping || l.needsVariantSelection)) {
      toast({
        variant: 'destructive',
        title: 'ยังผูกสต็อกไม่ครบ',
        description: 'กรุณาเลือกสินค้าคลังและรุ่นย่อย (ถ้ามี) ให้ครบทุกบรรทัดก่อนยืนยันรับของ',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Atomic Sequence Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'store_receive', { actor: currentUser.displayName });

      const batch = writeBatch(firestore);
      const receiptRef = doc(collection(firestore, 'store_receipts'));
      
      // 1. Create Header
      batch.set(receiptRef, {
        receiveNo: finalNo,
        receiveDate,
        vendorId,
        referencePurchaseId: refPurchaseId || null,
        notes,
        totalAmount: summaryTotals.totalAmount,
        amountBeforeTax: summaryTotals.amountBeforeTax,
        vatAmount: summaryTotals.vatAmount,
        vatTreatment: selectedPurchase?.vatTreatment ?? null,
        createdAt: Date.now(),
        createdBy: currentUser.displayName
      });

      // 2. Process Items
      const linesColRef = collection(receiptRef, 'items');
      for (const line of receiveLines) {
        const lineDocRef = doc(linesColRef);
        batch.set(lineDocRef, {
          itemId: line.itemId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          amount: line.quantity * line.unitCost,
          purchaseLineId: line.purchaseLineId ?? null,
          poDescription: line.poDescription ?? null,
        });

        // Update Master Stock
        const itemRef = doc(firestore, 'store_items', line.itemId);
        batch.update(itemRef, { 
          currentStock: increment(line.quantity),
          updatedAt: Date.now()
        });

        // Log Transaction
        const txRef = doc(collection(firestore, 'store_transactions'));
        batch.set(txRef, {
          itemId: line.itemId,
          transactionType: 'RECEIVE',
          quantity: line.quantity,
          transactionDate: receiveDate,
          referenceType: 'RECEIPT',
          referenceId: receiptRef.id,
          notes: `Receive No: ${finalNo}. ${notes}`,
          createdAt: Date.now(),
          createdBy: currentUser.displayName
        });
      }

      await batch.commit();

      toast({ title: "รับของเข้าคลังสำเร็จ", description: `บันทึกรายการเลขที่ ${finalNo} เรียบร้อยแล้ว` });
      router.push('/store');
    } catch (e) {
      console.error(e);
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code?: string }).code) : '';
      const message =
        code === 'permission-denied'
          ? 'ไม่มีสิทธิ์บันทึก (Firestore rules) — แจ้งผู้ดูแลให้ deploy กฎล่าสุด'
          : code === 'not-found'
            ? 'ไม่พบสินค้าในทะเบียนคลัง — ลองเลือกสินค้าใหม่'
            : 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่หรือแจ้งผู้ดูแลระบบ';
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: message });
    } finally {
      setIsSubmitting(false);
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
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild><Link href="/store"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <PackagePlus className="h-8 w-8 text-primary" /> รับของเข้าคลัง (Receive Inventory)
            </h1>
            <p className="text-muted-foreground text-lg">ใช้สำหรับเพิ่มสินค้าเข้าสต็อก โดยสามารถอ้างอิงจากรายการสั่งซื้อ (Purchase Orders)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Form Area */}
          <div className="lg:col-span-3 space-y-6">
            <Card className="shadow-md">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" /> ข้อมูลหัวเอกสาร (Receipt Header)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="font-bold">เลขที่ใบรับ (Receive No.)</Label>
                  <Input value={receiveNo} disabled className="h-11 font-mono font-bold text-primary bg-muted/50" />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">วันที่รับของ (Date)</Label>
                  <DatePickerThaiBE
                    className="h-11"
                    value={htmlDateValueToTimestampMs(receiveDate)}
                    onChange={(ms) => setReceiveDate(timestampToHtmlDateValue(ms))}
                  />
                </div>
                <VendorSearchSelect
                  vendors={allVendors ?? undefined}
                  value={vendorId || undefined}
                  onChange={(id) => handleVendorChange(id ?? '')}
                  label="คู่ค้า / ผู้ขาย (Vendor)"
                  placeholder="เลือกบริษัทคู่ค้า..."
                />
                <div className="space-y-2 md:col-span-2">
                  <Label className="font-bold">อ้างอิงรายการสั่งซื้อ (PO Reference - Optional)</Label>
                  <Select
                    onValueChange={handlePurchaseChange}
                    value={refPurchaseId || 'none'}
                    disabled={!vendorId}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder={vendorId ? 'เลือกรายการสั่งซื้อที่อ้างอิง...' : 'เลือกคู่ค้าก่อน'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- ไม่ระบุ --</SelectItem>
                      {vendorPurchases.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.purchaseNo} | ฿{p.totalAmount.toLocaleString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {vendorId && vendorPurchases.length === 0 && (
                    <p className="text-xs text-muted-foreground">ไม่มี PO ที่อนุมัติ/ออกแล้วของคู่ค้ารายนี้</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">หมายเหตุ</Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="เช่น ระบุเลขที่ใบส่งของ..." className="h-11" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-md overflow-hidden">
              <CardHeader className="bg-muted/20 border-b flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">รายการสินค้าที่รับเข้า (Inventory Items)</CardTitle>
                  <CardDescription>
                    {refPurchaseId
                      ? 'ดึงรายการจาก PO — บรรทัดที่ยังไม่ผูกสต็อกให้เลือกสินค้าคลัง (ราคาต่อหน่วยจาก PO)'
                      : 'กด «เพิ่มรายการ» แล้วเลือกสินค้า — รับเข้าได้หลายรายการในครั้งเดียว'}
                  </CardDescription>
                </div>
                <Button type="button" variant="default" className="shrink-0 gap-2" onClick={handleAddEmptyLine}>
                  <Plus className="h-4 w-4" />
                  เพิ่มรายการ
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="font-bold pl-6">สินค้า (Item)</TableHead>
                      <TableHead className="text-center font-bold">สต็อกเดิม</TableHead>
                      <TableHead className="text-center font-bold">จำนวนรับเข้า</TableHead>
                      <TableHead className="text-center font-bold">สต็อกหลังรับ</TableHead>
                      <TableHead className="text-right font-bold">ต้นทุน/หน่วย</TableHead>
                      <TableHead className="text-right font-bold">ยอดรวม</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receiveLines.map((line) => (
                      <TableRow key={line.id} className="hover:bg-muted/10">
                        <TableCell className="pl-6">
                          {line.needsStockMapping && !line.itemId ? (
                            <div className="flex flex-col gap-2 max-w-md">
                              <Badge variant="outline" className="w-fit text-[10px] border-amber-300 text-amber-800 bg-amber-50">
                                {line.needsVariantSelection
                                  ? 'เลือกรุ่นย่อย'
                                  : line.purchaseLineId
                                    ? 'จาก PO — เลือกสต็อก'
                                    : 'เลือกสินค้า'}
                              </Badge>
                              {line.poDescription && (
                                <p className="text-xs text-muted-foreground leading-snug">PO: {line.poDescription}</p>
                              )}
                              {line.needsVariantSelection && line.mappingHeaderId ? (
                                <StoreStockSearchSelect
                                  items={allStoreItems ?? []}
                                  variantParentId={line.mappingHeaderId}
                                  onPick={(v) => handlePickVariant(line.id, v)}
                                  placeholder="ค้นหารุ่นย่อย / ไซส์…"
                                />
                              ) : (
                                <StoreStockSearchSelect
                                  items={allStoreItems ?? []}
                                  onPick={(v) => handleMapPoLineToStock(line.id, v)}
                                  placeholder="ค้นหารหัส / ชื่อสินค้า…"
                                />
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span className="font-bold text-sm text-primary">
                                {formatStoreItemLabel({
                                  itemName: line.itemName,
                                  variantSpecification: line.variantSpecification,
                                })}
                              </span>
                              <span className="text-[10px] font-mono text-muted-foreground">{line.itemCode}</span>
                              {line.poDescription &&
                                line.poDescription !== line.itemName &&
                                !line.poDescription.includes(line.variantSpecification || '') && (
                                  <span className="text-[10px] text-muted-foreground">PO: {line.poDescription}</span>
                                )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">{line.currentStock} {line.unit}</TableCell>
                        <TableCell className="text-center">
                          <Input 
                            type="number" 
                            className="w-20 mx-auto text-center h-8 font-bold" 
                            value={line.quantity} 
                            onChange={e => updateLine(line.id, 'quantity', parseInt(e.target.value) || 0)} 
                          />
                        </TableCell>
                        <TableCell className="text-center font-black text-green-700">
                          <div className="flex items-center justify-center gap-1">
                            <TrendingUp className="h-3 w-3" />
                            {line.currentStock + line.quantity}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {line.purchaseLineId ? (
                            <span className="font-mono text-sm tabular-nums">
                              ฿ {line.unitCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <Input
                              type="number"
                              className="w-24 ml-auto text-right h-8"
                              value={line.unitCost}
                              onChange={(e) => updateLine(line.id, 'unitCost', parseFloat(e.target.value) || 0)}
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          ฿ {(line.quantity * line.unitCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex items-center justify-end gap-1">
                            {line.itemId && !line.needsStockMapping && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-primary"
                                title="แก้ไขการผูกสต็อก"
                                onClick={() => handleEditLineMapping(line.id)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveLine(line.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {receiveLines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-20 text-center space-y-4">
                          <div className="bg-muted/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                            <Plus className="h-8 w-8 text-muted-foreground/40" />
                          </div>
                          <p className="text-sm text-muted-foreground italic">
                            {refPurchaseId
                              ? 'รอโหลดรายการจาก PO หรือกด «เพิ่มรายการ» เพื่อรับเข้าเพิ่ม'
                              : 'ยังไม่มีรายการ — กด «เพิ่มรายการ» แล้วเลือกสินค้าในแต่ละแถว'}
                          </p>
                          <Button type="button" variant="outline" className="gap-2" onClick={handleAddEmptyLine}>
                            <Plus className="h-4 w-4" />
                            เพิ่มรายการ
                          </Button>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
              {receiveLines.length > 0 && (
                <CardFooter className="border-t bg-muted/10 py-3">
                  <Button type="button" variant="outline" className="gap-2" onClick={handleAddEmptyLine}>
                    <Plus className="h-4 w-4" />
                    เพิ่มรายการ
                  </Button>
                </CardFooter>
              )}
            </Card>
          </div>

          {/* Sidebar: Summary & Action */}
          <div className="space-y-6">
            <Card className="border-primary/20 shadow-lg">
              <CardHeader className="bg-primary text-primary-foreground">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="h-5 w-5" /> สรุปยอดรับเข้า (Summary)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">จำนวนรายการ:</span>
                  <span className="font-bold">{receiveLines.length} รายการ</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">ยอดรวมก่อนภาษี:</span>
                  <span className="font-bold">
                    ฿ {summaryTotals.amountBeforeTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between text-sm border-b pb-2">
                  <span className="text-muted-foreground">{vatSummaryLabel}</span>
                  <span className="font-bold">
                    ฿ {summaryTotals.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between text-lg pt-2">
                  <span className="font-black text-primary uppercase">ยอดรวมสุทธิ:</span>
                  <span className="font-black text-2xl text-primary">
                    ฿ {summaryTotals.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <Separator className="my-4" />

                {hasIncompleteStockMapping && (
                  <Alert variant="destructive" className="py-3">
                    <AlertTitle className="text-sm">ยังเลือกสินค้าคลังไม่ครบ</AlertTitle>
                    <AlertDescription className="text-xs">
                      บรรทัดจาก PO ที่มีป้าย «จาก PO — เลือกสต็อก» ต้องเลือกสินค้าในระบบ (และรุ่นย่อยถ้ามี) ก่อนกดยืนยัน
                    </AlertDescription>
                  </Alert>
                )}

                <Button 
                  className="w-full h-14 font-black text-lg bg-primary shadow-lg" 
                  disabled={receiveLines.length === 0 || isSubmitting || hasIncompleteStockMapping}
                  onClick={handleConfirmReceive}
                >
                  {isSubmitting ? <Loader2 className="h-6 w-6 animate-spin mr-2" /> : <CheckCircle2 className="h-6 w-6 mr-2" />}
                  ยืนยันรับของ (Confirm Intake)
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-dashed border-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase flex items-center gap-2 text-primary">
                  <Info className="h-4 w-4" /> ผลลัพธ์หลังบันทึก
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-muted-foreground leading-relaxed space-y-2">
                <p>1. ระบบจะเพิ่มสต็อกสินค้า (Current Stock) ในทะเบียนอุปกรณ์ทันที</p>
                <p>2. สร้างรายการ Transaction ประเภท RECEIVE เพื่อใช้ตรวจสอบยอด</p>
                <p>3. ข้อมูลชุดนี้สามารถนำไปอ้างอิงตอนทำจ่ายเงินคู่ค้า (AP Bill) ได้ในอนาคต</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
