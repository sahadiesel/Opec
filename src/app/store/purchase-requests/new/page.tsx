'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { addDoc, collection, doc, writeBatch } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import type {
  User,
  PurchaseLineEntryMode,
  PurchaseRequestVatTreatment,
  PurchaseType,
  PrPaymentMilestoneDraft,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VendorSearchSelect } from '@/components/store/vendor-search-select';
import {
  PurchaseRequestLinesEditor,
  newLine,
  parsePrDecimal,
  type PrLineDraft,
} from '@/components/store/purchase-request-lines-editor';
import { Switch } from '@/components/ui/switch';
import {
  PurchaseRequestWhtCard,
  parsePrWhtRatePercent,
  prWhtPersistFields,
} from '@/components/store/purchase-request-wht-card';
import { computePurchaseTotalsFromLines, sumLineAmounts } from '@/lib/purchase/pr-totals';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function NewPurchaseRequestPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [vendorId, setVendorId] = useState<string | undefined>(undefined);
  const [lineEntryMode, setLineEntryMode] = useState<PurchaseLineEntryMode>('SERVICE');
  const [lines, setLines] = useState<PrLineDraft[]>(() => [newLine()]);
  const [vatTreatment, setVatTreatment] = useState<PurchaseRequestVatTreatment>('EXCLUSIVE');
  const [purchasePaymentType, setPurchasePaymentType] = useState<PurchaseType>('CREDIT');
  const [paymentInstallmentsEnabled, setPaymentInstallmentsEnabled] = useState(false);
  const [milestones, setMilestones] = useState<PrPaymentMilestoneDraft[]>([
    { sequence: 1, label: 'งวดที่ 1', amount: 0 },
    { sequence: 2, label: 'งวดที่ 2', amount: 0 },
  ]);
  const [needByDate, setNeedByDate] = useState(timestampToHtmlDateValue(Date.now()));
  const [whtEnabled, setWhtEnabled] = useState(false);
  const [whtRateInput, setWhtRateInput] = useState('3');

  const ok = useMemo(
    () => !!currentUser && canView(currentUser, 'store_inventory'),
    [currentUser]
  );
  const vendorsQuery = useMemoFirebase(() => (firestore && ok ? collection(firestore, 'vendors') : null), [firestore, ok]);
  const { data: vendors } = useCollection(vendorsQuery as any);
  const storeItemsQuery = useMemoFirebase(() => (firestore && ok ? collection(firestore, 'store_items') : null), [firestore, ok]);
  const { data: storeItems } = useCollection(storeItemsQuery as any);

  const lineSum = useMemo(
    () => sumLineAmounts(lines.map((l) => ({ amount: l.amount }))),
    [lines]
  );
  const totals = useMemo(
    () => computePurchaseTotalsFromLines(lineSum, vatTreatment),
    [lineSum, vatTreatment]
  );

  const validateForSubmit = (submitForApproval: boolean): boolean => {
    if (!title.trim()) {
      toast({ variant: 'destructive', title: 'ระบุหัวข้อ' });
      return false;
    }
    if (submitForApproval && !vendorId) {
      toast({ variant: 'destructive', title: 'ระบุคู่ค้า', description: 'จำเป็นตอนส่งอนุมัติ' });
      return false;
    }
    const badLine = lines.find(
      (l) =>
        !l.itemDescription.trim() ||
        !(parsePrDecimal(l.quantity) > 0) ||
        parsePrDecimal(l.unitPrice) < 0 ||
        !(Number(l.amount) >= 0)
    );
    if (submitForApproval && badLine) {
      toast({
        variant: 'destructive',
        title: 'รายการไม่ครบ',
        description: 'ทุกบรรทัดต้องมีชื่อรายการ จำนวน > 0 และราคา/หน่วย',
      });
      return false;
    }
    if (submitForApproval && lineEntryMode === 'INVENTORY') {
      const unlinked = lines.find((l) => l.itemDescription.trim() && !l.storeItemId);
      if (unlinked) {
        toast({
          variant: 'destructive',
          title: 'ยังไม่เลือกสินค้าคลัง',
          description: 'โหมดจากคลัง — กด «ค้นหา» เลือก SKU ให้ครบทุกบรรทัด',
        });
        return false;
      }
    }
    if (
      submitForApproval &&
      purchasePaymentType === 'CREDIT' &&
      paymentInstallmentsEnabled
    ) {
      const ms = milestones.slice().sort((a, b) => a.sequence - b.sequence);
      const sum = roundMoney2(ms.reduce((s, m) => s + Number(m.amount || 0), 0));
      if (ms.some((m) => !m.label.trim())) {
        toast({ variant: 'destructive', title: 'ระบุชื่องวดทุกแถว' });
        return false;
      }
      if (Math.abs(sum - totals.totalAmount) > 0.02) {
        toast({
          variant: 'destructive',
          title: 'ยอดงวดไม่เท่ายอดสุทธิ',
          description: `ผลรวมงวด ฿${sum.toFixed(2)} ต้องเท่า ฿${totals.totalAmount.toFixed(2)}`,
        });
        return false;
      }
    }
    if (submitForApproval && lineEntryMode === 'SERVICE' && whtEnabled) {
      if (parsePrWhtRatePercent(whtRateInput) == null) {
        toast({
          variant: 'destructive',
          title: 'อัตราหัก ณ ที่จ่ายไม่ถูกต้อง',
          description: 'ระบุเปอร์เซ็นต์มากกว่า 0 และไม่เกิน 100 หรือปิดการหัก',
        });
        return false;
      }
    }
    return true;
  };

  const persist = async (submitForApproval: boolean) => {
    if (!firestore || !currentUser) return;
    if (!validateForSubmit(submitForApproval)) return;

    setSaving(true);
    try {
      const { code } = await generateNextDocumentCode(firestore, 'purchase_request', {
        actor: currentUser.displayName || currentUser.email,
      });
      const now = Date.now();
      const prRef = doc(collection(firestore, 'purchase_requests'));

      const milestonePayload =
        purchasePaymentType === 'CREDIT' && paymentInstallmentsEnabled
          ? milestones
              .slice()
              .sort((a, b) => a.sequence - b.sequence)
              .map((m, i) => ({
                sequence: i + 1,
                label: m.label.trim(),
                amount: roundMoney2(Number(m.amount) || 0),
                dueDate: m.dueDate?.trim() || undefined,
              }))
          : undefined;

      const whtFields = prWhtPersistFields(lineEntryMode, whtEnabled, whtRateInput);

      const batch = writeBatch(firestore);
      batch.set(prRef, {
        requestNo: code,
        title: title.trim(),
        notes: notes.trim() || null,
        vendorId: vendorId || null,
        estimatedAmount: totals.totalAmount,
        amountBeforeTax: totals.amountBeforeTax,
        vatAmount: totals.vatAmount,
        totalAmount: totals.totalAmount,
        lineEntryMode,
        vatTreatment,
        purchasePaymentType,
        paymentInstallmentsEnabled: purchasePaymentType === 'CREDIT' ? paymentInstallmentsEnabled : false,
        paymentMilestoneDrafts: milestonePayload || null,
        needByDate: needByDate || null,
        supplierWithholdingEnabled: whtFields.supplierWithholdingEnabled,
        supplierWithholdingRatePercent: whtFields.supplierWithholdingRatePercent,
        status: submitForApproval ? 'PENDING_APPROVAL' : 'DRAFT',
        requestedByUid: currentUser.id,
        requestedByName: currentUser.displayName || currentUser.email || '',
        submittedAt: submitForApproval ? now : null,
        createdAt: now,
        updatedAt: now,
      });

      lines.forEach((l) => {
        if (!l.itemDescription.trim() && !submitForApproval) return;
        if (!l.itemDescription.trim()) return;
        const lr = doc(collection(firestore, 'purchase_requests', prRef.id, 'lines'));
        batch.set(lr, {
          itemDescription: l.itemDescription.trim(),
          quantity: parsePrDecimal(l.quantity),
          unitPrice: roundMoney2(parsePrDecimal(l.unitPrice)),
          amount: roundMoney2(Number(l.amount) || 0),
          storeItemId: l.storeItemId || null,
          storeItemCode: l.storeItemCode || null,
          createdAt: now,
        });
      });

      await batch.commit();

      toast({
        title: submitForApproval ? 'ส่งขออนุมัติแล้ว' : 'บันทึกฉบับร่างแล้ว',
        description: code,
      });
      router.push(`/store/purchase-requests/${prRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ' });
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

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-5xl space-y-6 pb-16">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="icon" asChild>
            <Link href="/store/purchase-requests">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-primary">สร้าง PR</h1>
            <p className="text-sm text-muted-foreground">เลขที่ {getPreviewPattern('purchase_request')}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>หัวเอกสาร</CardTitle>
            <CardDescription>ข้อมูลคำขออนุมัติสั่งซื้อ — อนุมัติแล้วระบบจะใช้เป็นฐานสำหรับสร้าง PO (แก้รายการใน PO ไม่ได้)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>หัวข้อ (สรุปความต้องการ)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น อุปกรณ์ความปลอดภัย งวดเม.ย." />
            </div>
            <VendorSearchSelect vendors={vendors as any} value={vendorId} onChange={setVendorId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>วันที่ต้องการของ (อ้างอิง)</Label>
                <DatePickerThaiBE
                  className="h-11"
                  value={htmlDateValueToTimestampMs(needByDate)}
                  onChange={(ms) => setNeedByDate(timestampToHtmlDateValue(ms))}
                />
              </div>
              <div className="space-y-2">
                <Label>ภาษีมูลค่าเพิ่ม</Label>
                <Select value={vatTreatment} onValueChange={(v) => setVatTreatment(v as PurchaseRequestVatTreatment)}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">ไม่มี VAT</SelectItem>
                    <SelectItem value="EXCLUSIVE">มี VAT — ราคาบรรทัดยังไม่รวม VAT (+7%)</SelectItem>
                    <SelectItem value="INCLUSIVE">มี VAT — ราคาบรรทัดรวม VAT แล้ว</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>การชำระเงิน</Label>
                <Select
                  value={purchasePaymentType}
                  onValueChange={(v) => setPurchasePaymentType(v as PurchaseType)}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">เงินสด</SelectItem>
                    <SelectItem value="CREDIT">เครดิต</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {purchasePaymentType === 'CREDIT' && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="font-medium text-sm">แบ่งจ่ายหลายงวด</div>
                    <p className="text-xs text-muted-foreground">กำหนดยอดและวันครบกำหนดแต่ละงวด (ต้องรวมเท่ายอดสุทธิ)</p>
                  </div>
                  <Switch checked={paymentInstallmentsEnabled} onCheckedChange={setPaymentInstallmentsEnabled} />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>หมายเหตุ / เหตุผล</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </CardContent>
        </Card>

        {lineEntryMode === 'SERVICE' ? (
          <PurchaseRequestWhtCard
            enabled={whtEnabled}
            rateInput={whtRateInput}
            onEnabledChange={setWhtEnabled}
            onRateChange={setWhtRateInput}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>รายการและยอดเงิน</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <PurchaseRequestLinesEditor
              lineEntryMode={lineEntryMode}
              onLineEntryModeChange={setLineEntryMode}
              lines={lines}
              onLinesChange={setLines}
              storeItems={storeItems as any}
              readOnly={false}
            />

            <div className="flex flex-wrap justify-end gap-6 rounded-lg bg-muted/30 p-4 text-sm">
              <div className="text-right">
                <div className="text-muted-foreground">รวมบรรทัด (ฐานตามโหมด)</div>
                <div className="font-mono font-semibold text-lg">฿{lineSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              </div>
              <div className="text-right">
                <div className="text-muted-foreground">ภาษี 7%</div>
                <div className="font-mono font-semibold text-lg">฿{totals.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              </div>
              <div className="text-right">
                <div className="text-muted-foreground">ยอดสุทธิ</div>
                <div className="font-mono font-bold text-xl text-primary">
                  ฿{totals.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {purchasePaymentType === 'CREDIT' && paymentInstallmentsEnabled && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">แผนงวดชำระ (ร่าง)</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMilestones((prev) => [
                        ...prev,
                        { sequence: prev.length + 1, label: `งวดที่ ${prev.length + 1}`, amount: 0 },
                      ])
                    }
                  >
                    เพิ่มงวด
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">งวด</TableHead>
                      <TableHead>ชื่อเรียก</TableHead>
                      <TableHead className="w-36">ครบกำหนด</TableHead>
                      <TableHead className="w-36 text-right">ยอดงวด</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {milestones
                      .slice()
                      .sort((a, b) => a.sequence - b.sequence)
                      .map((m, idx) => (
                        <TableRow key={m.sequence}>
                          <TableCell>{idx + 1}</TableCell>
                          <TableCell>
                            <Input
                              value={m.label}
                              onChange={(e) =>
                                setMilestones((rows) =>
                                  rows.map((r) => (r.sequence === m.sequence ? { ...r, label: e.target.value } : r))
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="date"
                              value={m.dueDate || ''}
                              onChange={(e) =>
                                setMilestones((rows) =>
                                  rows.map((r) =>
                                    r.sequence === m.sequence ? { ...r, dueDate: e.target.value } : r
                                  )
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="text-right tabular-nums"
                              inputMode="decimal"
                              value={m.amount || ''}
                              onChange={(e) =>
                                setMilestones((rows) =>
                                  rows.map((r) =>
                                    r.sequence === m.sequence
                                      ? { ...r, amount: parseFloat(e.target.value) || 0 }
                                      : r
                                  )
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={milestones.length <= 1}
                              onClick={() => setMilestones((rows) => rows.filter((r) => r.sequence !== m.sequence))}
                            >
                              ×
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground">
                  ผลรวมยอดงวดต้องเท่า <span className="font-mono font-semibold">฿{totals.totalAmount.toFixed(2)}</span> ตอนส่งอนุมัติ
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={() => void persist(false)}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            บันทึกฉบับร่าง
          </Button>
          <Button type="button" className="font-bold" disabled={saving} onClick={() => void persist(true)}>
            ส่งขออนุมัติ
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
