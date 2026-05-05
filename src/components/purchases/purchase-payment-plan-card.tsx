'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import type { Firestore } from 'firebase/firestore';
import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  updateDoc,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import type {
  Purchase,
  PurchasePaymentMilestone,
  PurchaseRequest,
  PurchaseVendorBill,
  PurchaseVendorBillStatus,
  User,
  Vendor,
} from '@/lib/types';
import {
  milestoneStatusLabelTh,
  milestonesCoverTotal,
  roundMoney2,
  supplierWithholdingOnMilestone,
  syncPurchasePaymentClosure,
} from '@/lib/ops/purchase-payment-milestones';
import { formatDateThaiBE, timestampToHtmlDateValue } from '@/lib/date-thai';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import Link from 'next/link';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Wallet, Loader2, FileText } from 'lucide-react';

function addDaysToHtmlDateValue(ymd: string, days: number): string {
  const parts = ymd.split('-').map((x) => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return timestampToHtmlDateValue(dt.getTime());
}

function dueDisplay(ymd: string | undefined): string {
  if (!ymd?.trim()) return '—';
  return formatDateThaiBE(`${ymd}T12:00:00`);
}

function vendorBillStatusTh(s: PurchaseVendorBillStatus): string {
  if (s === 'DRAFT') return 'ร่าง';
  if (s === 'SUBMITTED') return 'แจ้งบัญชีแล้ว';
  return 'จ่ายแล้ว';
}

export interface PurchasePaymentPlanCardProps {
  firestore: Firestore;
  purchaseId: string;
  purchase: Purchase;
  purchaseRef: DocumentReference;
  vendor: Vendor | undefined;
  milestones: PurchasePaymentMilestone[] | null | undefined;
  /** ใบรับวางบิลที่ผูกกับ PO นี้ (query purchaseId) */
  vendorBills: PurchaseVendorBill[] | null | undefined;
  canEdit: boolean;
  /** สร้างใบรับวางบิลจากงวด — สโตร์หรือผู้แก้ไข purchases */
  canCreateVendorBill: boolean;
  currentUser: User | null;
}

export function PurchasePaymentPlanCard({
  firestore,
  purchaseId,
  purchase,
  purchaseRef,
  vendor,
  milestones,
  vendorBills,
  canEdit,
  canCreateVendorBill,
  currentUser,
}: PurchasePaymentPlanCardProps) {
  const { toast } = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [cashConfirmOpen, setCashConfirmOpen] = useState(false);
  const [creditConfirmOpen, setCreditConfirmOpen] = useState(false);
  const [customSubmitConfirmOpen, setCustomSubmitConfirmOpen] = useState(false);
  const [editPlanConfirmOpen, setEditPlanConfirmOpen] = useState(false);
  const pendingCustomRowsRef = useRef<{ label: string; amount: number }[] | null>(null);

  const list = useMemo(
    () => (milestones || []).slice().sort((a, b) => a.sequence - b.sequence),
    [milestones]
  );

  const planEditable =
    (purchase.status === 'DRAFT' || purchase.status === 'RETURNED_FOR_REVISION') && canEdit;

  const showPaymentCard =
    purchase.totalAmount > 0 && purchase.status !== 'CANCELLED' && purchase.status !== 'REJECTED';

  const hasLocked = list.some((m) => m.status === 'PAID' || m.status === 'WAIVED');
  const sumOk = list.length > 0 && milestonesCoverTotal(list, purchase.totalAmount);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusyKey(key);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: 'ลองใหม่หรือตรวจสิทธิ์' });
    } finally {
      setBusyKey(null);
    }
  };

  const createMilestoneRows = async (
    rows: { label: string; amount: number; dueDate?: string }[]
  ) => {
    const col = collection(firestore, 'purchases', purchaseId, 'payment_milestones');
    const now = Date.now();
    const batch = writeBatch(firestore);
    const created: PurchasePaymentMilestone[] = [];
    rows.forEach((r, i) => {
      const ref = doc(col);
      const amount = roundMoney2(r.amount);
      const payload: Record<string, unknown> = {
        id: ref.id,
        purchaseId,
        sequence: i + 1,
        label: r.label,
        amount,
        status: 'OPEN',
        createdAt: now,
        updatedAt: now,
      };
      if (r.dueDate?.trim()) payload.dueDate = r.dueDate.trim();
      batch.set(ref, payload);
      created.push({
        id: ref.id,
        purchaseId,
        sequence: i + 1,
        label: r.label,
        amount,
        status: 'OPEN',
        ...(r.dueDate?.trim() ? { dueDate: r.dueDate.trim() } : {}),
        createdAt: now,
        updatedAt: now,
      } as PurchasePaymentMilestone);
    });
    await batch.commit();
    await syncPurchasePaymentClosure(firestore, purchaseRef, purchase, created);
    toast({ title: 'สร้างแผนงวดชำระแล้ว', description: `${created.length} งวด` });
  };

  const execPresetCash = () =>
    run('preset-cash', () =>
      createMilestoneRows([
        {
          label: 'ชำระเต็มจำนวน (เงินสด)',
          amount: purchase.totalAmount,
        },
      ])
    );

  const execPresetCredit = () =>
    run('preset-credit', () => {
      const base = purchase.purchaseDate?.trim() || timestampToHtmlDateValue(Date.now());
      const days = Number(vendor?.creditDays) > 0 ? Number(vendor?.creditDays) : 30;
      return createMilestoneRows([
        {
          label: `ครบกำหนดตามเครดิต (${days} วัน)`,
          amount: purchase.totalAmount,
          dueDate: addDaysToHtmlDateValue(base, days),
        },
      ]);
    });

  const [customPlanOpen, setCustomPlanOpen] = useState(false);
  const [instCount, setInstCount] = useState(2);
  const [prefixPctInputs, setPrefixPctInputs] = useState<string[]>(['30']);

  useEffect(() => {
    if (!customPlanOpen) return;
    const need = Math.max(0, instCount - 1);
    setPrefixPctInputs((prev) => {
      const out = prev.slice(0, need);
      while (out.length < need) out.push('');
      return out;
    });
  }, [customPlanOpen, instCount]);

  const validateAndQueueCustomPercentPlan = (): boolean => {
    const n = instCount;
    const total = roundMoney2(purchase.totalAmount);
    const parsed = prefixPctInputs.slice(0, n - 1).map((s) => {
      const x = parseFloat(String(s).replace(',', '.'));
      return Number.isFinite(x) ? x : NaN;
    });
    if (parsed.some((x) => !Number.isFinite(x) || x < 0)) {
      toast({
        variant: 'destructive',
        title: 'กรอกเปอร์เซ็นต์ไม่ถูกต้อง',
        description: 'ใช้ตัวเลขเท่านั้น (เช่น 30 หรือ 20.5)',
      });
      return false;
    }
    const sumPct = roundMoney2(parsed.reduce((s, p) => s + p, 0));
    if (sumPct >= 99.999) {
      toast({
        variant: 'destructive',
        title: 'ผลรวมงวดแรกต้องน้อยกว่า 100%',
        description: `ตอนนี้รวม ${sumPct}% — งวดสุดท้ายต้องมีเหลือให้คำนวณ`,
      });
      return false;
    }
    const lastPct = roundMoney2(100 - sumPct);
    const rows: { label: string; amount: number }[] = [];
    let sumAmt = 0;
    for (let i = 0; i < n - 1; i++) {
      const pct = parsed[i];
      const amt = roundMoney2(total * (pct / 100));
      sumAmt += amt;
      rows.push({ label: `งวดที่ ${i + 1} (${pct}%)`, amount: amt });
    }
    rows.push({
      label: `งวดที่ ${n} (${lastPct}% — คำนวณอัตโนมัติ)`,
      amount: roundMoney2(total - sumAmt),
    });
    pendingCustomRowsRef.current = rows;
    return true;
  };

  const executeQueuedCustomPercentPlan = () => {
    const rows = pendingCustomRowsRef.current;
    if (!rows?.length) return;
    void run('custom-pct', async () => {
      await createMilestoneRows(rows);
      setCustomPlanOpen(false);
      setCustomSubmitConfirmOpen(false);
      pendingCustomRowsRef.current = null;
    });
  };

  const whtRate =
    purchase.supplierWithholdingEnabled && (purchase.supplierWithholdingRatePercent ?? 0) > 0
      ? Number(purchase.supplierWithholdingRatePercent)
      : 0;

  const clearAllOpen = () =>
    run('clear', async () => {
      if (!planEditable) return;
      if (list.some((m) => m.vendorBillId)) {
        toast({
          variant: 'destructive',
          title: 'ลบแผนไม่ได้',
          description: 'มีงวดที่ผูกใบรับวางบิลแล้ว — ลบหรือยกเลิกใบร่างที่เมนูวางบิลก่อน',
        });
        return;
      }
      if (list.some((m) => m.status !== 'OPEN')) return;
      const batch = writeBatch(firestore);
      for (const m of list) {
        batch.delete(doc(firestore, 'purchases', purchaseId, 'payment_milestones', m.id));
      }
      await batch.commit();
      if (purchase.status === 'COMPLETED') {
        await updateDoc(purchaseRef, {
          status: 'ISSUED',
          paymentStatus: 'UNPAID',
          updatedAt: Date.now(),
        });
      } else {
        await updateDoc(purchaseRef, { paymentStatus: 'UNPAID', updatedAt: Date.now() });
      }
      toast({ title: 'ลบแผนงวดแล้ว' });
    });

  const ensureVendorBillForMilestone = async (m: PurchasePaymentMilestone, opts?: { silentToast?: boolean }) => {
    if (!currentUser) return;
    if (m.vendorBillId) return;
    const { code } = await generateNextDocumentCode(firestore, 'purchase_vendor_bill', {
      actor: currentUser.displayName || currentUser.email || '',
    });
    const now = Date.now();
    let purchaseRequestNo: string | undefined;
    if (purchase.purchaseRequestId) {
      const prSnap = await getDoc(doc(firestore, 'purchase_requests', purchase.purchaseRequestId));
      if (prSnap.exists()) {
        const rn = (prSnap.data() as Pick<PurchaseRequest, 'requestNo'>).requestNo?.trim();
        if (rn) purchaseRequestNo = rn;
      }
    }
    const baseDate = m.dueDate?.trim() || purchase.purchaseDate || timestampToHtmlDateValue(now);
    const ref = await addDoc(collection(firestore, 'purchase_vendor_bills'), {
        receiptNo: code,
        purchaseId,
        purchaseNo: purchase.purchaseNo,
        ...(purchaseRequestNo ? { purchaseRequestNo } : {}),
        purchaseType: purchase.purchaseType,
        vendorId: purchase.vendorId,
      milestoneId: m.id,
      billAmount: roundMoney2(m.amount),
      billingReceivedDate: baseDate,
      plannedPaymentDate: baseDate,
      status: 'DRAFT' as PurchaseVendorBillStatus,
      notes: `งวด ${m.sequence}: ${m.label}`,
      createdAt: now,
      updatedAt: now,
    });
    await updateDoc(doc(firestore, 'purchases', purchaseId, 'payment_milestones', m.id), {
      vendorBillId: ref.id,
      updatedAt: now,
    });
    if (!opts?.silentToast) {
      toast({
        title: 'สร้างใบรับวางบิลร่างแล้ว',
        description: `${code} — แผนกบัญชีเห็นได้ที่เมนูคลัง → รับวางบิล`,
      });
    }
  };

  const createVendorBillForMilestone = (m: PurchasePaymentMilestone) =>
    run(`vb-${m.id}`, async () => {
      await ensureVendorBillForMilestone(m);
    });

  const markPaid = (m: PurchasePaymentMilestone) =>
    run(`paid-${m.id}`, async () => {
      const ref = doc(firestore, 'purchases', purchaseId, 'payment_milestones', m.id);
      const name = currentUser?.displayName || currentUser?.email || '';
      const now = Date.now();
      await updateDoc(ref, {
        status: 'PAID',
        paidAt: now,
        paidByUid: currentUser?.id,
        paidByName: name,
        updatedAt: now,
      });
      const next = list.map((x) =>
        x.id === m.id
          ? {
              ...x,
              status: 'PAID' as const,
              paidAt: now,
              paidByUid: currentUser?.id,
              paidByName: name,
            }
          : x
      );
      await syncPurchasePaymentClosure(firestore, purchaseRef, purchase, next);
      toast({ title: 'บันทึกชำระแล้ว' });
    });

  const markWaived = (m: PurchasePaymentMilestone) =>
    run(`waive-${m.id}`, async () => {
      if (m.vendorBillId) {
        const b = vendorBills?.find((x) => x.id === m.vendorBillId);
        if (b?.status === 'SUBMITTED' || b?.status === 'PAID') {
          toast({
            variant: 'destructive',
            title: 'ยกเว้นงวดไม่ได้',
            description: 'มีใบรับวางบิลที่ส่งบัญชีหรือจ่ายแล้ว',
          });
          return;
        }
        if (b?.status === 'DRAFT') {
          await deleteDoc(doc(firestore, 'purchase_vendor_bills', m.vendorBillId));
        }
      }
      const ref = doc(firestore, 'purchases', purchaseId, 'payment_milestones', m.id);
      const name = currentUser?.displayName || currentUser?.email || '';
      const now = Date.now();
      await updateDoc(ref, {
        status: 'WAIVED',
        waivedAt: now,
        waivedByUid: currentUser?.id,
        waivedByName: name,
        vendorBillId: deleteField(),
        updatedAt: now,
      });
      const next = list.map((x) =>
        x.id === m.id
          ? {
              ...x,
              status: 'WAIVED' as const,
              waivedAt: now,
              waivedByUid: currentUser?.id,
              waivedByName: name,
              vendorBillId: undefined,
            }
          : x
      );
      await syncPurchasePaymentClosure(firestore, purchaseRef, purchase, next);
      toast({ title: 'ยกเว้นงวดนี้แล้ว' });
    });

  const reopenMilestone = (m: PurchasePaymentMilestone) =>
    run(`open-${m.id}`, async () => {
      if (m.vendorBillId) {
        const b = vendorBills?.find((x) => x.id === m.vendorBillId);
        if (b && b.status !== 'DRAFT') {
          toast({
            variant: 'destructive',
            title: 'ยกเลิกสถานะงวดไม่ได้',
            description: 'ใบรับวางบิลงวดนี้ส่งบัญชีหรือจ่ายแล้ว — จัดการที่เมนูวางบิล/เจ้าหนี้ก่อน',
          });
          return;
        }
        if (b?.status === 'DRAFT') {
          await deleteDoc(doc(firestore, 'purchase_vendor_bills', m.vendorBillId));
        }
      }
      const ref = doc(firestore, 'purchases', purchaseId, 'payment_milestones', m.id);
      await updateDoc(ref, {
        status: 'OPEN',
        paidAt: deleteField(),
        paidByUid: deleteField(),
        paidByName: deleteField(),
        waivedAt: deleteField(),
        waivedByUid: deleteField(),
        waivedByName: deleteField(),
        vendorBillId: deleteField(),
        updatedAt: Date.now(),
      });
      const next = list.map((x) =>
        x.id === m.id
          ? {
              ...x,
              status: 'OPEN' as const,
              paidAt: undefined,
              paidByUid: undefined,
              paidByName: undefined,
              waivedAt: undefined,
              waivedByUid: undefined,
              waivedByName: undefined,
              vendorBillId: undefined,
            }
          : x
      );
      await syncPurchasePaymentClosure(firestore, purchaseRef, purchase, next);
      toast({ title: 'ปรับกลับเป็นรอชำระ' });
    });

  if (!showPaymentCard) return null;

  const canEditPlanStructure =
    planEditable &&
    list.length > 0 &&
    list.every((m) => m.status === 'OPEN' && !m.vendorBillId);

  if (purchase.status === 'COMPLETED' && list.length === 0) {
    return (
      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="text-base">แผนงวดชำระเงิน (PO)</CardTitle>
          <CardDescription>
            PO นี้ปิดแล้วโดยยังไม่มีแผนงวดในระบบ (ข้อมูลก่อนเพิ่มฟีเจอร์นี้) — หากต้องการใช้งานงวดในอนาคตให้ติดต่อผู้ดูแลข้อมูล
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200/60 shadow-md max-w-4xl mx-auto w-full">
      <CardHeader className="border-b bg-amber-50/40">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-5 w-5 text-amber-800" /> แผนงวดชำระเงิน (PO)
        </CardTitle>
        <CardDescription>
          สร้างงวดให้รวมเท่ายอดสุทธิ PO — กำหนดได้เฉพาะตอนสถานะ <b>ฉบับร่าง</b> หรือ <b>ส่งกลับแก้ไข</b> ก่อนส่งขออนุมัติ — หลังส่งอนุมัติแล้วแผนงวดจะถูกล็อก
          เมื่อทุกงวดชำระหรือยกเว้นครบ ระบบจะตั้งสถานะ PO เป็น <b>COMPLETED</b> และ <b>paymentStatus = PAID</b> อัตโนมัติ — การยืนยันแต่ละงวดทำผ่าน
          <b>ใบรับวางบิล</b> (สโตร์ส่งบัญชี = ถือว่าตรวจรับสินค้า/งานแล้ว)
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {!planEditable && list.length > 0 && (
          <p className="text-sm text-amber-900/80 bg-amber-100/50 border border-amber-200 rounded-md px-3 py-2 print:hidden">
            แผนงวดนี้ล็อกแล้ว — แก้ไขได้เฉพาะเมื่อ PO อยู่ในสถานะฉบับร่างหรือส่งกลับแก้ไข
          </p>
        )}
        {planEditable && canEditPlanStructure && (
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!!busyKey}
              onClick={() => setEditPlanConfirmOpen(true)}
            >
              แก้ไขแผนงวด
            </Button>
          </div>
        )}
        {list.length === 0 && planEditable && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              ยังไม่มีงวด — เลือกแม่แบบหรือกำหนดตาม % (ต้องครบยอดสุทธิก่อนส่งขออนุมัติ)
            </p>
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!!busyKey}
                onClick={() => setCashConfirmOpen(true)}
              >
                {busyKey === 'preset-cash' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                เงินสด งวดเดียว (100%)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!!busyKey}
                onClick={() => setCreditConfirmOpen(true)}
              >
                {busyKey === 'preset-credit' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                เครดิต งวดเดียว (100%)
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={!!busyKey}
                onClick={() => setCustomPlanOpen(true)}
              >
                กำหนดงวดตาม % (มัดจำหลายงวด)
              </Button>
            </div>
          </div>
        )}
        {list.length === 0 && !planEditable && purchase.totalAmount > 0 && (
          <p className="text-sm text-muted-foreground">
            {purchase.status === 'PENDING_APPROVAL'
              ? 'รอแผนงวดจากจัดซื้อ — หากยังว่าง อาจเป็นข้อมูลก่อนอัปเดตระบบ หรือส่งกลับแก้ไขเพื่อให้กำหนดงวด'
              : 'ยังไม่มีแผนงวดในระบบ'}
          </p>
        )}

        <Dialog open={customPlanOpen} onOpenChange={setCustomPlanOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>กำหนดจำนวนงวดและเปอร์เซ็นต์</DialogTitle>
              <DialogDescription>
                ระบุเปอร์เซ็นต์ของงวดที่ 1 ถึงงวดก่อนสุดท้าย — งวดสุดท้ายคำนวณให้อัตโนมัติให้ครบ 100% และปรับยอดเงินให้เท่ายอดสุทธิ PO
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>จำนวนงวดทั้งหมด</Label>
                <Select value={String(instCount)} onValueChange={(v) => setInstCount(parseInt(v, 10) || 2)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 11 }, (_, i) => i + 2).map((k) => (
                      <SelectItem key={k} value={String(k)}>
                        {k} งวด
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {Array.from({ length: Math.max(0, instCount - 1) }, (_, idx) => (
                <div key={idx} className="space-y-1">
                  <Label>งวดที่ {idx + 1} (% ของยอดสุทธิ)</Label>
                  <Input
                    inputMode="decimal"
                    value={prefixPctInputs[idx] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPrefixPctInputs((prev) => {
                        const next = [...prev];
                        next[idx] = v;
                        return next;
                      });
                    }}
                    placeholder="เช่น 30"
                  />
                </div>
              ))}
              <p className="text-sm font-medium text-primary">
                งวดที่ {instCount}:{' '}
                {(() => {
                  const parsed = prefixPctInputs.slice(0, instCount - 1).map((s) => {
                    const x = parseFloat(String(s).replace(',', '.'));
                    return Number.isFinite(x) ? x : 0;
                  });
                  const sum = roundMoney2(parsed.reduce((a, b) => a + b, 0));
                  return sum < 100 ? `${roundMoney2(100 - sum)}% (อัตโนมัติ)` : '—';
                })()}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCustomPlanOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                type="button"
                disabled={!!busyKey}
                onClick={() => {
                  if (validateAndQueueCustomPercentPlan()) {
                    setCustomPlanOpen(false);
                    setCustomSubmitConfirmOpen(true);
                  }
                }}
              >
                ตกลงตามนี้…
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={cashConfirmOpen} onOpenChange={setCashConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยืนยันแผนงวดชำระเงิน</AlertDialogTitle>
              <AlertDialogDescription>
                สร้าง 1 งวดชำระเต็มจำนวน (เงินสด) 100% ของยอดสุทธิ PO — ตกลงตามนี้หรือไม่?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setCashConfirmOpen(false);
                  void execPresetCash();
                }}
              >
                ตกลงตามนี้
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={creditConfirmOpen} onOpenChange={setCreditConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยืนยันแผนงวดชำระเงิน</AlertDialogTitle>
              <AlertDialogDescription>
                สร้าง 1 งวดตามเครดิตคู่ค้า (กำหนดวันครบกำหนดอัตโนมัติ) — ตกลงตามนี้หรือไม่?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setCreditConfirmOpen(false);
                  void execPresetCredit();
                }}
              >
                ตกลงตามนี้
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={customSubmitConfirmOpen} onOpenChange={setCustomSubmitConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยืนยันแผนงวดตามเปอร์เซ็นต์</AlertDialogTitle>
              <AlertDialogDescription>
                ระบบจะสร้างงวดตามที่คำนวณให้ครบยอดสุทธิ PO — ตกลงตามนี้หรือยกเลิก?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => (pendingCustomRowsRef.current = null)}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  executeQueuedCustomPercentPlan();
                }}
              >
                ตกลงตามนี้
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={editPlanConfirmOpen} onOpenChange={setEditPlanConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>แก้ไขแผนงวด</AlertDialogTitle>
              <AlertDialogDescription>
                จะลบแผนงวดเดิมทั้งหมด แล้วให้เลือกแม่แบบใหม่ — ดำเนินการต่อหรือไม่?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setEditPlanConfirmOpen(false);
                  void clearAllOpen();
                }}
              >
                ตกลง ลบแล้วเริ่มใหม่
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {list.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className={sumOk ? 'text-green-700 font-medium' : 'text-destructive font-medium'}>
                รวมงวด: ฿{roundMoney2(list.reduce((s, m) => s + m.amount, 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })} / ยอดสุทธิ PO ฿
                {purchase.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                {sumOk ? '✓' : '(ต้องเท่ากัน)'}
              </span>
              {planEditable && list.length > 0 && !hasLocked && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive print:hidden" disabled={!!busyKey} onClick={() => void clearAllOpen()}>
                  {busyKey === 'clear' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  ลบแผนงวด
                </Button>
              )}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>งวด</TableHead>
                  <TableHead>รายละเอียด</TableHead>
                  <TableHead>ครบกำหนด</TableHead>
                  <TableHead className="text-right">จำนวนเงิน</TableHead>
                  {whtRate > 0 ? (
                    <>
                      <TableHead className="text-right">หัก ณ ที่จ่าย ({whtRate}%)</TableHead>
                      <TableHead className="text-right">เงินสุทธิจ่าย</TableHead>
                    </>
                  ) : null}
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="text-right min-w-[200px] print:hidden">ใบวางบิล / จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((m) => {
                  const linkedBill = m.vendorBillId ? vendorBills?.find((b) => b.id === m.vendorBillId) : undefined;
                  const { wht: whtAmt, netPaid: netPay } =
                    whtRate > 0
                      ? supplierWithholdingOnMilestone(m.amount, whtRate, purchase)
                      : { wht: 0, netPaid: m.amount };
                  return (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.sequence}</TableCell>
                    <TableCell className="font-medium">{m.label}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{dueDisplay(m.dueDate)}</TableCell>
                    <TableCell className="text-right font-bold">
                      ฿{m.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    {whtRate > 0 ? (
                      <>
                        <TableCell className="text-right text-muted-foreground">
                          ฿{whtAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-primary">
                          ฿{netPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                      </>
                    ) : null}
                    <TableCell>
                      <Badge variant={m.status === 'PAID' ? 'default' : m.status === 'WAIVED' ? 'secondary' : 'outline'}>
                        {milestoneStatusLabelTh(m.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right align-top print:hidden">
                      <div className="flex flex-col items-end gap-1">
                        {linkedBill ? (
                          <div className="flex flex-col items-end gap-1 text-xs">
                            <Badge variant="outline" className="font-normal">
                              {vendorBillStatusTh(linkedBill.status)}
                            </Badge>
                            <Link
                              href={`/store/vendor-bills/${linkedBill.id}`}
                              className="text-primary font-semibold inline-flex items-center gap-1 hover:underline"
                            >
                              <FileText className="h-3 w-3" />
                              {linkedBill.receiptNo}
                            </Link>
                          </div>
                        ) : null}
                        {m.status === 'OPEN' && canCreateVendorBill && !m.vendorBillId && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="mt-1"
                            disabled={!!busyKey}
                            onClick={() => void createVendorBillForMilestone(m)}
                          >
                            {busyKey === `vb-${m.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                            สร้างใบรับวางบิล
                          </Button>
                        )}
                        <div className="flex flex-wrap justify-end gap-1 mt-1">
                          {canEdit && m.status === 'OPEN' && (
                            <>
                              <Button type="button" size="sm" variant="default" disabled={!!busyKey} onClick={() => void markPaid(m)}>
                                ชำระแล้ว
                              </Button>
                              <Button type="button" size="sm" variant="outline" disabled={!!busyKey} onClick={() => void markWaived(m)}>
                                ยกเว้น
                              </Button>
                            </>
                          )}
                          {canEdit && (m.status === 'PAID' || m.status === 'WAIVED') && (
                            <Button type="button" size="sm" variant="ghost" disabled={!!busyKey} onClick={() => void reopenMilestone(m)}>
                              ยกเลิก
                            </Button>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          </>
        )}

        {purchase.paymentStatus && (
          <p className="text-xs text-muted-foreground print:hidden">
            paymentStatus ปัจจุบัน: <span className="font-mono font-semibold">{purchase.paymentStatus}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
