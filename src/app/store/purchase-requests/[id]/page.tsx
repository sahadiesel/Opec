'use client';

import { use, useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, CheckCircle, Loader2, XCircle, PackageSearch, Send, Ban } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { collection, doc, updateDoc } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canApprovePurchaseAsManager } from '@/lib/permissions';
import { PurchaseRequest, User, Vendor, Purchase, PurchaseRequestStatus } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function statusLabel(s: PurchaseRequestStatus) {
  const m: Record<PurchaseRequestStatus, string> = {
    DRAFT: 'ฉบับร่าง',
    PENDING_APPROVAL: 'รออนุมัติ',
    APPROVED: 'อนุมัติแล้ว',
    REJECTED: 'ไม่อนุมัติ',
    CANCELLED: 'ยกเลิก',
  };
  return m[s] || s;
}

export default function PurchaseRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [vendorId, setVendorId] = useState<string | undefined>(undefined);
  const [estStr, setEstStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const okStore = useMemo(
    () => !!currentUser && canView(currentUser, 'store_inventory'),
    [currentUser]
  );
  const canApprove = useMemo(() => canApprovePurchaseAsManager(currentUser), [currentUser]);
  const ok = okStore || canApprove;

  const prRef = useMemoFirebase(
    () => (firestore && ok ? doc(firestore, 'purchase_requests', id) : null),
    [firestore, id, ok]
  );
  const { data: pr, isLoading } = useDoc<PurchaseRequest>(prRef as any);

  const poRef = useMemoFirebase(
    () => (firestore && pr?.linkedPurchaseId ? doc(firestore, 'purchases', pr.linkedPurchaseId) : null),
    [firestore, pr?.linkedPurchaseId]
  );
  const { data: linkedPo } = useDoc<Purchase>(poRef as any);

  const vendorsQuery = useMemoFirebase(() => (firestore && ok ? collection(firestore, 'vendors') : null), [firestore, ok]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  useEffect(() => {
    if (!pr) return;
    setTitle(pr.title || '');
    setNotes(pr.notes || '');
    setVendorId(pr.vendorId);
    setEstStr(
      pr.estimatedAmount != null && pr.estimatedAmount > 0
        ? String(pr.estimatedAmount)
        : ''
    );
  }, [pr?.id, pr?.updatedAt]);

  const saveDraft = async () => {
    if (!okStore) return;
    if (!firestore || !pr || pr.status !== 'DRAFT' || !prRef) return;
    const t = title.trim();
    if (!t) {
      toast({ variant: 'destructive', title: 'ระบุหัวข้อ' });
      return;
    }
    setSaving(true);
    try {
      const est = parseFloat(estStr.replace(/,/g, ''));
      await updateDoc(prRef, {
        title: t,
        notes: notes.trim() || null,
        vendorId: vendorId || null,
        estimatedAmount: Number.isFinite(est) && est > 0 ? est : null,
        updatedAt: Date.now(),
      });
      toast({ title: 'บันทึกแล้ว' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const submitForApproval = async () => {
    if (!okStore) return;
    if (!firestore || !pr || pr.status !== 'DRAFT' || !prRef) return;
    const t = title.trim();
    if (!t) {
      toast({ variant: 'destructive', title: 'ระบุหัวข้อ' });
      return;
    }
    if (!vendorId) {
      toast({ variant: 'destructive', title: 'ระบุคู่ค้า', description: 'ก่อนส่งอนุมัติ' });
      return;
    }
    setSaving(true);
    try {
      const est = parseFloat(estStr.replace(/,/g, ''));
      const now = Date.now();
      await updateDoc(prRef, {
        title: t,
        notes: notes.trim() || null,
        vendorId,
        estimatedAmount: Number.isFinite(est) && est > 0 ? est : null,
        status: 'PENDING_APPROVAL' as PurchaseRequestStatus,
        submittedAt: now,
        updatedAt: now,
      });
      toast({ title: 'ส่งขออนุมัติแล้ว' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ส่งไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!firestore || !pr || pr.status !== 'PENDING_APPROVAL' || !prRef || !currentUser) return;
    setSaving(true);
    try {
      const now = Date.now();
      const name = currentUser.displayName || currentUser.email || '';
      await updateDoc(prRef, {
        status: 'APPROVED' as PurchaseRequestStatus,
        decidedAt: now,
        decidedByUid: currentUser.id,
        decidedByName: name,
        updatedAt: now,
      });
      toast({ title: 'อนุมัติ PR แล้ว', description: 'ฝ่ายคลังสามารถสร้างใบสั่งซื้ออ้างอิง PR นี้' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'อนุมัติไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const reject = async () => {
    if (!firestore || !pr || pr.status !== 'PENDING_APPROVAL' || !prRef || !currentUser) return;
    const r = rejectReason.trim();
    if (r.length < 3) {
      toast({ variant: 'destructive', title: 'ระบุเหตุผล' });
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      const name = currentUser.displayName || currentUser.email || '';
      await updateDoc(prRef, {
        status: 'REJECTED' as PurchaseRequestStatus,
        decidedAt: now,
        decidedByUid: currentUser.id,
        decidedByName: name,
        rejectionReason: r,
        updatedAt: now,
      });
      setRejectOpen(false);
      setRejectReason('');
      toast({ title: 'บันทึกผลไม่อนุมัติ' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (!okStore) return;
    if (!firestore || !pr || (pr.status !== 'DRAFT' && pr.status !== 'PENDING_APPROVAL') || !prRef) return;
    setSaving(true);
    try {
      await updateDoc(prRef, {
        status: 'CANCELLED' as PurchaseRequestStatus,
        updatedAt: Date.now(),
      });
      toast({ title: 'ยกเลิก PR' });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (isUserLoading || userLoading || !currentUser) {
    return (
      <div className="flex min-h-[50vh] w-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }
  if (!ok) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <p className="p-8 text-center text-muted-foreground">คุณไม่มีสิทธิ์</p>
      </AppShell>
    );
  }
  if (isLoading || !pr) {
    return (
      <div className="flex min-h-[50vh] w-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const v = vendors?.find((x) => x.id === pr.vendorId);
  const isDraft = pr.status === 'DRAFT';
  const draftEditable = isDraft && okStore;
  const showPoLink = pr.status === 'APPROVED' && !pr.linkedPurchaseId;
  const showPO = pr.linkedPurchaseId && linkedPo;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon" asChild>
              <Link href="/store/purchase-requests">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-mono font-bold text-primary">{pr.requestNo}</h1>
              <p className="text-sm text-muted-foreground">คำขออนุมัติสั่งซื้อ</p>
            </div>
          </div>
          <Badge
            className={
              pr.status === 'APPROVED'
                ? 'bg-green-100 text-green-900'
                : pr.status === 'PENDING_APPROVAL'
                  ? 'bg-amber-100 text-amber-900'
                  : pr.status === 'REJECTED'
                    ? 'bg-red-100 text-red-900'
                    : ''
            }
          >
            {statusLabel(pr.status)}
          </Badge>
        </div>

        {showPO && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base">ใบสั่งซื้อที่อ้างอิง</CardTitle>
              <CardDescription>
                <Button type="button" variant="link" className="h-auto p-0 text-base font-mono" asChild>
                  <Link href={`/purchases/${linkedPo.id}`}>{linkedPo.purchaseNo}</Link>
                </Button>
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {showPoLink && okStore && (
          <Card className="border-emerald-200 bg-emerald-50/40">
            <CardContent className="pt-4">
              <p className="mb-3 text-sm text-emerald-900">
                PR อนุมัติแล้ว — ไปสร้างใบสั่งซื้อโดยเลือก PR นี้ในเมนู การซื้อ
              </p>
              <Button className="font-bold" asChild>
                <Link href="/purchases">
                  <PackageSearch className="mr-2 h-4 w-4" /> สร้างใบสั่งซื้อ
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>รายละเอียด</CardTitle>
            {pr.status === 'PENDING_APPROVAL' && v && (
              <CardDescription>รออนุมัติ — คู่ค้าเสนอ: {v.vendorName}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>หัวข้อ</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                readOnly={!draftEditable}
                disabled={!draftEditable}
              />
            </div>
            {draftEditable && (
              <div className="space-y-2">
                <Label>คู่ค้า (เสนอ)</Label>
                <Select
                  value={vendorId || ''}
                  onValueChange={(v) => setVendorId(v || undefined)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือก" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors?.map((ven) => (
                      <SelectItem key={ven.id} value={ven.id}>
                        {ven.vendorName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!draftEditable && v && (
              <div>
                <Label>คู่ค้า (เสนอ)</Label>
                <p className="pt-1 font-medium">{v.vendorName}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>งบประมาณโดยประมาณ</Label>
              {draftEditable ? (
                <Input
                  value={estStr}
                  onChange={(e) => setEstStr(e.target.value)}
                  inputMode="decimal"
                />
              ) : (
                <p>
                  {pr.estimatedAmount != null && pr.estimatedAmount > 0
                    ? `฿${pr.estimatedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                    : '—'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>รายละเอียด</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                readOnly={!draftEditable}
                rows={4}
                disabled={!draftEditable}
              />
            </div>

            {pr.status === 'REJECTED' && pr.rejectionReason && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-foreground">
                {pr.rejectionReason}
              </div>
            )}

            {isDraft && !okStore && (
              <p className="text-sm text-muted-foreground">
                ฉบับร่าง — แก้ไข/ส่งอนุมัติได้เฉพาะฝ่ายคลัง/จัดซื้อ
              </p>
            )}

            {pr.status === 'DRAFT' && okStore && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void saveDraft()}
                  disabled={saving}
                >
                  บันทึกฉบับร่าง
                </Button>
                <Button
                  type="button"
                  className="font-bold"
                  onClick={() => void submitForApproval()}
                  disabled={saving}
                >
                  <Send className="mr-2 h-4 w-4" /> ส่งขออนุมัติ
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void cancel()}
                  disabled={saving}
                >
                  <Ban className="mr-2 h-4 w-4" /> ยกเลิก
                </Button>
              </div>
            )}

            {pr.status === 'PENDING_APPROVAL' && canApprove && (
              <div className="flex flex-wrap gap-2">
                <Button
                  className="bg-green-600 font-bold hover:bg-green-700"
                  onClick={() => void approve()}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                  อนุมัติ
                </Button>
                <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={saving}>
                  <XCircle className="mr-2 h-4 w-4" /> ไม่อนุมัติ
                </Button>
              </div>
            )}

            {pr.status === 'PENDING_APPROVAL' && canApprove && (
              <p className="text-xs text-muted-foreground">คุณกำลังอนุมัติในฐานะผู้จัดการฝ่ายปฏิบัติการ</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ไม่อนุมัติ PR นี้</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>เหตุผล (ส่งถึงผู้ขอ)</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectOpen(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button type="button" variant="destructive" onClick={() => void reject()} disabled={saving}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
