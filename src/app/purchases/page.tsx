'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Plus,
  Search,
  ChevronRight,
  PackageSearch, 
  Building2, 
  Calendar,
  AlertTriangle,
  Loader2,
  Trash2,
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { formatYmdLocalThaiBE, htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import {
  Purchase,
  PurchaseType,
  Vendor,
  PurchaseStatus,
  PurchaseRequest,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canApprovePurchaseAsManager, isSystemAdmin } from '@/lib/permissions';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import {
  addDoc,
  collection,
  query,
  orderBy,
  where,
  getDocs,
  getDoc,
  deleteDoc,
  deleteField,
  doc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { seedPurchaseLinesAndMilestonesFromPr } from '@/lib/purchase/pr-seed-purchase';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { computePurchaseTotalsFromLines } from '@/lib/purchase/pr-totals';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Paid vendor bills or closed milestones block PO removal (draft or admin cascade). */
async function fetchPurchaseDeleteBlockReason(
  firestore: Firestore,
  purchaseId: string
): Promise<string | null> {
  const vbSnap = await getDocs(
    query(collection(firestore, 'purchase_vendor_bills'), where('purchaseId', '==', purchaseId))
  );
  for (const d of vbSnap.docs) {
    const row = d.data() as { status?: string; paidAt?: number };
    if (row.status === 'PAID' || row.status === 'CLOSED' || (typeof row.paidAt === 'number' && row.paidAt > 0)) {
      return 'มีใบรับวางบิลที่บันทึกจ่ายแล้ว — ลบใบสั่งซื้อนี้ไม่ได้';
    }
  }
  const milestonesSnap = await getDocs(
    collection(firestore, 'purchases', purchaseId, 'payment_milestones')
  );
  for (const d of milestonesSnap.docs) {
    const row = d.data() as { status?: string };
    if (row.status === 'PAID') {
      return 'มีงวดชำระที่ปิดแล้ว — ลบใบสั่งซื้อนี้ไม่ได้';
    }
  }
  return null;
}

/**
 * Clears `linkedPurchaseId` on PR(s) for this PO.
 * If `purchaseRequestId` on the PO is wrong (e.g. stores a display code, or the PR doc was removed),
 * `updateDoc` on that path throws "No document to update" — so we only update when the doc exists,
 * and we also fix any PR row that still points at this PO via `linkedPurchaseId`.
 */
async function unlinkPurchaseRequestsBeforePoDelete(
  firestore: Firestore,
  purchaseId: string,
  purchaseRequestId?: string
): Promise<void> {
  const touched = new Set<string>();

  const rawPrId = typeof purchaseRequestId === 'string' ? purchaseRequestId.trim() : '';
  if (rawPrId) {
    const ref = doc(firestore, 'purchase_requests', rawPrId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const prStatus = snap.data()?.status;
      await updateDoc(ref, {
        linkedPurchaseId: deleteField(),
        ...(prStatus === 'PO_ISSUED' ? { status: 'APPROVED' } : {}),
        updatedAt: Date.now(),
      });
      touched.add(ref.id);
    }
  }

  const linkedSnap = await getDocs(
    query(collection(firestore, 'purchase_requests'), where('linkedPurchaseId', '==', purchaseId))
  );
  for (const d of linkedSnap.docs) {
    if (touched.has(d.id)) continue;
    const prStatus = d.data()?.status;
    await updateDoc(d.ref, {
      linkedPurchaseId: deleteField(),
      ...(prStatus === 'PO_ISSUED' ? { status: 'APPROVED' } : {}),
      updatedAt: Date.now(),
    });
  }
}

/** Deletes linked top-level docs and subcollections, then the purchase document. */
async function deletePurchaseCascade(firestore: Firestore, purchaseId: string) {
  const vbSnap = await getDocs(
    query(collection(firestore, 'purchase_vendor_bills'), where('purchaseId', '==', purchaseId))
  );

  const whtSnap = await getDocs(
    query(
      collection(firestore, 'withholding_certificate_documents'),
      where('sourcePurchaseId', '==', purchaseId)
    )
  );
  for (const d of whtSnap.docs) {
    await deleteDoc(d.ref);
  }

  for (const d of vbSnap.docs) {
    await deleteDoc(doc(firestore, 'accounts_payable', d.id));
    await deleteDoc(d.ref);
  }

  const linesSnap = await getDocs(collection(firestore, 'purchases', purchaseId, 'lines'));
  for (const d of linesSnap.docs) {
    await deleteDoc(d.ref);
  }

  const milestonesSnap = await getDocs(collection(firestore, 'purchases', purchaseId, 'payment_milestones'));
  for (const d of milestonesSnap.docs) {
    await deleteDoc(d.ref);
  }

  const apSnap = await getDocs(
    query(collection(firestore, 'ap_bills'), where('purchaseId', '==', purchaseId))
  );
  for (const d of apSnap.docs) {
    await deleteDoc(d.ref);
  }

  await deleteDoc(doc(firestore, 'purchases', purchaseId));
}

export default function PurchasesPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () =>
      !!currentUser &&
      (canView(currentUser, 'purchases') || canApprovePurchaseAsManager(currentUser)),
    [currentUser]
  );

  const purchasesQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'purchases'), orderBy('purchaseDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: purchases, isLoading } = useCollection<Purchase>(purchasesQuery as any);

  const vendorsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'vendors') : null), [firestore, isAuthorized]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const prApprovedQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'purchase_requests'), where('status', '==', 'APPROVED'));
  }, [firestore, isAuthorized]);
  const { data: approvedPrs } = useCollection<PurchaseRequest>(prApprovedQuery as any);

  const availablePrs = useMemo(
    () => (approvedPrs || []).filter((r) => !r.linkedPurchaseId),
    [approvedPrs]
  );

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedPrId, setSelectedPrId] = useState<string>('');

  const selectedPr = useMemo(
    () => (approvedPrs || []).find((r) => r.id === selectedPrId) ?? null,
    [approvedPrs, selectedPrId]
  );

  const selectedPrVendor = useMemo(
    () => (selectedPr?.vendorId ? vendors?.find((v) => v.id === selectedPr.vendorId) : undefined),
    [selectedPr?.vendorId, vendors]
  );
  const [newPurchase, setNewPurchase] = useState<Partial<Purchase>>({
    purchaseNo: getPreviewPattern('purchase'),
    purchaseDate: timestampToHtmlDateValue(Date.now()),
    purchaseType: 'CREDIT',
    storeReceiptStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    status: 'DRAFT',
    notes: ''
  });

  const canApprove = useMemo(() => canApprovePurchaseAsManager(currentUser), [currentUser]);
  const okStore = useMemo(
    () => !!currentUser && canView(currentUser, 'store_inventory'),
    [currentUser]
  );
  const showAdminDelete = useMemo(
    () => !!currentUser && (isSystemAdmin(currentUser) || isSimpleAdmin(currentUser)),
    [currentUser]
  );
  const showPoDeleteColumn = showAdminDelete || okStore;
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [poSearch, setPoSearch] = useState('');
  const [poMonth, setPoMonth] = useState<string>('all');
  const [poVendorId, setPoVendorId] = useState<string>('all');
  /** รออนุมัติเฉพาะ PO เก่าที่ไม่อ้าง PR — ทางทำงานหลักอนุมัติที่ PR ไม่ใช่ PO */
  const pendingApprovalCount = useMemo(
    () => (purchases || []).filter((p) => p.status === 'PENDING_APPROVAL' && !p.purchaseRequestId).length,
    [purchases]
  );

  function purchaseRowMonth(purchaseDate: string | undefined): string {
    if (!purchaseDate?.trim()) return '';
    const parts = purchaseDate.split('-').map((x) => parseInt(x, 10));
    if (parts.length < 2 || !parts[0] || !parts[1]) return '';
    return `${parts[0]}-${String(parts[1]).padStart(2, '0')}`;
  }

  const purchasesFiltered = useMemo(() => {
    const qq = poSearch.trim().toLowerCase();
    return (purchases || []).filter((p) => {
      const v = vendors?.find((x) => x.id === p.vendorId);
      if (poVendorId !== 'all' && p.vendorId !== poVendorId) return false;
      const ym = purchaseRowMonth(p.purchaseDate);
      if (poMonth !== 'all' && ym !== poMonth) return false;
      if (!qq) return true;
      return (
        (p.purchaseNo || '').toLowerCase().includes(qq) ||
        (v?.vendorName || '').toLowerCase().includes(qq) ||
        (p.purchaseRequestId || '').toLowerCase().includes(qq)
      );
    });
  }, [purchases, poSearch, poMonth, poVendorId, vendors]);

  const purchaseMonthOptions = useMemo(() => {
    const set = new Set<string>();
    (purchases || []).forEach((p) => {
      const ym = purchaseRowMonth(p.purchaseDate);
      if (ym) set.add(ym);
    });
    return [...set].sort().reverse();
  }, [purchases]);

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!selectedPrId) {
      toast({
        variant: "destructive",
        title: "ต้องเลือก PR",
        description: "เปิดใบสั่งซื้อได้จาก PR ที่อนุมัติแล้วเท่านั้น",
      });
      return;
    }
    const prId = selectedPrId;
    const prSnap = await getDoc(doc(firestore, 'purchase_requests', prId));
    if (!prSnap.exists()) {
      toast({ variant: 'destructive', title: 'ไม่พบ PR' });
      return;
    }
    const pr = prSnap.data() as PurchaseRequest;

    if (!pr.vendorId?.trim()) {
      toast({
        variant: 'destructive',
        title: 'PR ยังไม่มีคู่ค้า',
        description: 'แก้ไข PR ให้ระบุคู่ค้าก่อน — ข้อมูล PO ดึงจาก PR ทั้งฉบับเพื่อไม่ให้ขัดกัน',
      });
      return;
    }

    const prLinesSnap = await getDocs(collection(firestore, 'purchase_requests', prId, 'lines'));
    if (prLinesSnap.empty) {
      toast({
        variant: 'destructive',
        title: 'PR ยังไม่มีรายการบรรทัด',
        description: 'เปิด PR แล้วเพิ่มรายการสินค้า/บริการให้ครบก่อนสร้าง PO',
      });
      return;
    }

    let amountBeforeTax = Number(pr.amountBeforeTax) || 0;
    let vatAmount = Number(pr.vatAmount) || 0;
    let totalAmount = Number(pr.totalAmount) || 0;
    if (totalAmount <= 0) {
      const sum = roundMoney2(
        prLinesSnap.docs.reduce((s, d) => s + Number(d.data().amount || 0), 0)
      );
      const t = computePurchaseTotalsFromLines(sum, pr.vatTreatment ?? 'EXCLUSIVE');
      amountBeforeTax = t.amountBeforeTax;
      vatAmount = t.vatAmount;
      totalAmount = t.totalAmount;
    }

    setIsCreating(true);
    try {
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'purchase', { actor: currentUser.displayName });

      const purchasePayload = {
        ...newPurchase,
        purchaseRequestId: prId,
        purchaseNo: finalNo,
        purchaseLineMode: pr.lineEntryMode ?? 'INVENTORY',
        purchaseType: pr.purchasePaymentType ?? 'CREDIT',
        vatTreatment: pr.vatTreatment ?? 'EXCLUSIVE',
        amountBeforeTax,
        vatAmount,
        totalAmount,
        vendorId: pr.vendorId,
        /** คัดลอกหัก ณ ที่จ่ายจาก PR (SERVICE) — ไม่ต้องตั้งซ้ำที่ PO */
        supplierWithholdingEnabled:
          (pr.lineEntryMode ?? 'INVENTORY') === 'SERVICE' && !!pr.supplierWithholdingEnabled,
        supplierWithholdingCategory:
          (pr.lineEntryMode ?? 'INVENTORY') === 'SERVICE' &&
          !!pr.supplierWithholdingEnabled &&
          pr.supplierWithholdingCategory
            ? pr.supplierWithholdingCategory
            : null,
        supplierWithholdingRatePercent:
          (pr.lineEntryMode ?? 'INVENTORY') === 'SERVICE' &&
          !!pr.supplierWithholdingEnabled &&
          (Number(pr.supplierWithholdingRatePercent) || 0) > 0
            ? Number(pr.supplierWithholdingRatePercent)
            : null,
        createdByUid: currentUser.id,
        createdByName: currentUser.displayName || currentUser.email || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const docRef = await addDoc(collection(firestore, 'purchases'), purchasePayload);

      await seedPurchaseLinesAndMilestonesFromPr({
        firestore,
        purchaseRef: doc(firestore, 'purchases', docRef.id),
        prId,
        purchaseDate: newPurchase.purchaseDate || '',
        vendor: vendors?.find((v) => v.id === purchasePayload.vendorId),
      });

      await updateDoc(doc(firestore, 'purchase_requests', prId), {
        linkedPurchaseId: docRef.id,
        status: 'PO_ISSUED',
        updatedAt: Date.now(),
      });

      setIsDialogOpen(false);
      setSelectedPrId('');
      toast({
        title: 'เปิดใบสั่งซื้อแล้ว',
        description: `เลขที่ ${finalNo} — คัดลอกรายการจาก PR แล้ว ไปพิมพ์ส่งคู่ค้าได้ที่หน้ารายละเอียด`,
      });
      router.push(`/purchases/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างรายการซื้อได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmDeletePurchase = async () => {
    if (!firestore || !deleteTarget) return;

    const isDraft = deleteTarget.status === 'DRAFT';
    const adminHardDelete =
      showAdminDelete && !isDraft && deleteTarget.status !== 'COMPLETED';

    if (!isDraft && !adminHardDelete) {
      toast({
        variant: 'destructive',
        title: 'ลบไม่ได้',
        description:
          'ลบได้เฉพาะใบสั่งซื้อฉบับร่าง — ผู้ดูแลระบบสามารถลบรายการที่ยังไม่ปิดงบ (ไม่มีการจ่าย) ได้',
      });
      setDeleteTarget(null);
      return;
    }

    const blockReason = await fetchPurchaseDeleteBlockReason(firestore, deleteTarget.id);
    if (blockReason) {
      toast({ variant: 'destructive', title: 'ลบไม่ได้', description: blockReason });
      setDeleteTarget(null);
      return;
    }

    setIsDeleting(true);
    try {
      await unlinkPurchaseRequestsBeforePoDelete(
        firestore,
        deleteTarget.id,
        deleteTarget.purchaseRequestId
      );
      await deletePurchaseCascade(firestore, deleteTarget.id);
      toast({
        title: 'ลบรายการซื้อแล้ว',
        description: `เลขที่ ${deleteTarget.purchaseNo}`,
      });
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
      const detail = e instanceof Error ? e.message : String(e);
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถลบได้',
        description:
          detail && detail !== 'undefined'
            ? `${detail} — ถ้าเป็น permission-denied ให้ตรวจสอบกฎ Firestore และบันทึกผู้ใช้ใน users/{uid}`
            : 'ลองใหม่อีกครั้งหรือตรวจสอบสิทธิ์การเข้าถึง',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusBadge = (status: PurchaseStatus) => {
    switch (status) {
      case 'DRAFT':
        return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">ฉบับร่าง</Badge>;
      case 'PENDING_APPROVAL':
        return <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">รออนุมัติ</Badge>;
      case 'RETURNED_FOR_REVISION':
        return <Badge variant="outline" className="bg-orange-50 text-orange-800 border-orange-200">ส่งกลับแก้ไข</Badge>;
      case 'APPROVED':
        return <Badge variant="outline" className="bg-green-50 text-green-800 border-green-200">อนุมัติแล้ว</Badge>;
      case 'REJECTED':
        return <Badge variant="destructive">ไม่อนุมัติ</Badge>;
      case 'ISSUED':
        return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">ISSUED</Badge>;
      case 'COMPLETED':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">COMPLETED</Badge>;
      case 'CANCELLED':
        return <Badge variant="secondary">CANCELLED</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || userLoading) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" aria-label="กำลังโหลด" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-muted-foreground max-w-md">
          ยังโหลดโปรไฟล์ผู้ใช้ไม่สำเร็จ — ลองรีเฟรช หรือเข้าสู่ระบบใหม่ (ถ้าหน้านี้ว่างนานผิดปกติ ตรวจสอบการเชื่อมต่อและสิทธิ์ Firestore)
        </p>
        <Button type="button" variant="outline" onClick={() => router.push('/')}>
          กลับหน้าหลัก
        </Button>
      </div>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <PackageSearch className="h-8 w-8" /> ใบสั่งซื้อ(Purchase Order)
          </h1>
          <p className="text-muted-foreground text-lg">
            PO ไม่ได้สร้างรายการใหม่แยกจาก PR — เลือก PR ที่อนุมัติแล้วเพื่อ<strong className="text-foreground font-semibold"> เปิดใบสั่งซื้อ </strong>
            ที่ระบบ<strong className="text-foreground font-semibold"> ดึงคู่ค้า ยอด และบรรทัดจาก PR </strong>
            ให้ตรงกันทั้งฉบับ จากนั้นใช้หน้ารายละเอียด PO เพื่อพิมพ์ส่งคู่ค้าและทำรับวางบิล
          </p>
        </div>

        {canApprove && pendingApprovalCount > 0 && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertTitle className="text-amber-900">มี PO รออนุมัติ (รายการเก่า ไม่อ้าง PR)</AlertTitle>
            <AlertDescription className="text-amber-800">
              จำนวน {pendingApprovalCount} รายการ — รายการใหม่ให้ส่งขออนุมัติที่ PR ก่อน แล้วค่อยสร้าง PO จาก PR; รายการนี้เปิดแล้วอนุมัติที่หน้ารายละเอียด
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ค้นหาเลขที่ PO / คู่ค้า / PR id…"
                className="pl-9 h-11"
                value={poSearch}
                onChange={(e) => setPoSearch(e.target.value)}
              />
            </div>
            <Select value={poMonth} onValueChange={setPoMonth}>
              <SelectTrigger className="h-11 w-[200px]">
                <SelectValue placeholder="เดือน" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกเดือน</SelectItem>
                {purchaseMonthOptions.map((ym) => (
                  <SelectItem key={ym} value={ym}>
                    {ym}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={poVendorId} onValueChange={setPoVendorId}>
              <SelectTrigger className="h-11 w-[220px]">
                <SelectValue placeholder="คู่ค้า" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">คู่ค้าทั้งหมด</SelectItem>
                {vendors?.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.vendorName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <Dialog
            open={isAuthorized && isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) {
                setSelectedPrId('');
                setNewPurchase({
                  purchaseNo: getPreviewPattern('purchase'),
                  purchaseDate: timestampToHtmlDateValue(Date.now()),
                  purchaseType: 'CREDIT',
                  storeReceiptStatus: 'PENDING',
                  paymentStatus: 'UNPAID',
                  status: 'DRAFT',
                  notes: '',
                });
              }
            }}
          >
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> เปิด PO จาก PR
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>เปิดใบสั่งซื้อจาก PR</DialogTitle>
                <DialogDescription>
                  เลือก PR ที่อนุมัติแล้ว — ระบบจะใช้คู่ค้า ประเภทจ่าย แบบรายการ และบรรทัดจาก PR เดียวกัน
                  แล้วออกเลข PO ใหม่เพื่อใช้เป็นเอกสารสั่งซื้อพิมพ์ส่งคู่ค้า (ไม่สร้างรายการแยกที่ขัดกับ PR)
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่ PO (ออกอัตโนมัติเมื่อยืนยัน)</Label>
                  <Input value={newPurchase.purchaseNo} disabled className="bg-muted/50 font-mono font-bold" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>PR ที่อนุมัติแล้ว (แหล่งข้อมูล — บังคับ)</Label>
                  <Select value={selectedPrId} onValueChange={setSelectedPrId}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="เลือก PREQ-... (ยังไม่ผูก PO)" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {availablePrs.length === 0 ? (
                        <div className="p-3 text-sm text-muted-foreground">ไม่มี PR ว่าง</div>
                      ) : (
                        availablePrs.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.requestNo} — {r.title}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    ยังไม่มี PR?{' '}
                    <Link href="/store/purchase-requests/new" className="font-semibold text-primary underline" target="_blank" rel="noreferrer">
                      สร้าง PR
                    </Link>
                  </p>
                </div>

                {!selectedPrId ? (
                  <p className="text-sm text-muted-foreground md:col-span-2 border rounded-md px-3 py-2 bg-muted/20">
                    เลือก PR ก่อน — ระบบจะแสดงคู่ค้าและเงื่อนไขจาก PR (แก้ที่ PR ถ้าต้องการเปลี่ยน)
                  </p>
                ) : selectedPr && !selectedPr.vendorId?.trim() ? (
                  <Alert variant="destructive" className="md:col-span-2">
                    <AlertTitle>PR นี้ยังไม่มีคู่ค้า</AlertTitle>
                    <AlertDescription>
                      ไปแก้ PR ให้ระบุคู่ค้าก่อน — PO ดึงจาก PR ทั้งฉบับเพื่อให้ตรงกับที่อนุมัติ
                    </AlertDescription>
                  </Alert>
                ) : selectedPr && selectedPrVendor ? (
                  <div className="md:col-span-2 rounded-lg border bg-muted/30 px-3 py-3 space-y-2 text-sm">
                    <p className="font-semibold text-foreground">ข้อมูลจาก PR (ใช้เปิด PO — ไม่แก้ที่นี่)</p>
                    <ul className="space-y-1.5 text-muted-foreground">
                      <li>
                        <span className="text-foreground font-medium">คู่ค้า:</span>{' '}
                        {selectedPrVendor.vendorName}{' '}
                        <span className="font-mono text-xs">({selectedPrVendor.vendorCode})</span>
                      </li>
                      <li>
                        <span className="text-foreground font-medium">ประเภทจ่าย:</span>{' '}
                        {(selectedPr.purchasePaymentType ?? 'CREDIT') === 'CASH'
                          ? 'เงินสด (CASH)'
                          : 'เงินเชื่อ (CREDIT)'}
                      </li>
                      <li>
                        <span className="text-foreground font-medium">แบบรายการ:</span>{' '}
                        {(selectedPr.lineEntryMode ?? 'INVENTORY') === 'INVENTORY'
                          ? 'แบบที่ 1 — จากทะเบียนคลัง (ตาม PR)'
                          : 'แบบที่ 2 — สั่งจ้าง / คีย์มือ (ตาม PR)'}
                      </li>
                    </ul>
                  </div>
                ) : selectedPr ? (
                  <p className="text-sm text-muted-foreground md:col-span-2">กำลังโหลดชื่อคู่ค้า…</p>
                ) : null}

                <div className="space-y-2 md:col-span-2">
                  <Label>วันที่เอกสาร PO (พิมพ์บนใบสั่งซื้อ)</Label>
                  <DatePickerThaiBE
                    className="h-11 max-w-full"
                    value={htmlDateValueToTimestampMs(newPurchase.purchaseDate)}
                    onChange={(ms) => setNewPurchase({ ...newPurchase, purchaseDate: timestampToHtmlDateValue(ms) })}
                  />
                  <p className="text-xs text-muted-foreground">
                    วันที่นี้เป็นวันที่แสดงบน PO เท่านั้น — รายการและยอดยังมาจาก PR
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>
                  ยกเลิก
                </Button>
                <Button
                  onClick={() => void handleCreate()}
                  className="bg-primary font-bold"
                  disabled={isCreating || !selectedPrId || !selectedPr?.vendorId?.trim()}
                >
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  เปิด PO และคัดลอกรายการจาก PR
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เลขที่ (Purchase No.)</TableHead>
                    <TableHead className="font-bold">คู่ค้า (Vendor)</TableHead>
                    <TableHead className="font-bold">วันที่ซื้อ</TableHead>
                    <TableHead className="font-bold">ประเภท</TableHead>
                    <TableHead className="font-bold text-right">ยอดรวมสุทธิ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    {showPoDeleteColumn && (
                      <TableHead className="w-14 px-2 text-center text-muted-foreground font-bold">ลบ</TableHead>
                    )}
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchasesFiltered.map((p) => {
                    const vendor = vendors?.find(v => v.id === p.vendorId);
                    const poTrashVisible =
                      showPoDeleteColumn &&
                      (p.status === 'DRAFT' || (showAdminDelete && p.status !== 'COMPLETED'));
                    return (
                      <TableRow 
                        key={p.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all" 
                        onClick={() => router.push(`/purchases/${p.id}`)}
                      >
                        <TableCell className="py-4 pl-6 font-bold text-primary font-mono">{p.purchaseNo}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {vendor?.vendorName || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatYmdLocalThaiBE(p.purchaseDate)}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline">{p.purchaseType}</Badge></TableCell>
                        <TableCell className="text-right font-black text-primary">
                          ฿ {p.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>{getStatusBadge(p.status)}</TableCell>
                        {showPoDeleteColumn && (
                          <TableCell
                            className="w-14 px-2 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {poTrashVisible ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                title={
                                  p.status === 'DRAFT'
                                    ? showAdminDelete
                                      ? 'ลบ PO ฉบับร่าง (ผู้ดูแลระบบ)'
                                      : 'ลบ PO ฉบับร่าง'
                                    : 'ลบ PO (ผู้ดูแลระบบ — เฉพาะเมื่อยังไม่มีการจ่าย)'
                                }
                                onClick={() => setDeleteTarget(p)}
                              >
                                <Trash2 className="h-5 w-5" />
                              </Button>
                            ) : null}
                          </TableCell>
                        )}
                        <TableCell
                          className="text-right pr-6"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button type="button" variant="ghost" size="icon" className="group-hover:text-primary" asChild>
                            <Link href={`/purchases/${p.id}`}>
                              <ChevronRight className="h-5 w-5" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {purchasesFiltered.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={showPoDeleteColumn ? 8 : 7}
                        className="text-center py-20 text-muted-foreground italic"
                      >
                        ไม่มีรายการซื้อในระบบ
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบรายการซื้อนี้?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget && (
                  <>
                    จะลบถาวรเลขที่ <span className="font-mono font-semibold">{deleteTarget.purchaseNo}</span> พร้อมรายการบรรทัด งวดชำระ
                    และเอกสารที่เกี่ยวข้อง (ถ้ามี) การกระทำนี้ไม่สามารถย้อนกลับได้
                    {showAdminDelete && deleteTarget.status !== 'DRAFT' ? (
                      <>
                        {' '}
                        <span className="font-medium text-amber-800">
                          (โหมดผู้ดูแลระบบ: อนุญาตเฉพาะเมื่อยังไม่มีการจ่ายตามใบรับวางบิลและงวดชำระ)
                        </span>
                      </>
                    ) : null}
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting} type="button">
                ยกเลิก
              </AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                onClick={() => void handleConfirmDeletePurchase()}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ลบ'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
