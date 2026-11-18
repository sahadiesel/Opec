'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Pencil, Loader2 } from 'lucide-react';
import type {
  Purchase,
  PurchaseVendorBill,
  User,
  VendorBillAdjustmentKind,
  VendorBillWhtPresetCategory,
} from '@/lib/types';
import {
  WHT_INCOME_CATEGORY_OPTIONS,
  supplierWhtCategoryDefaultRate,
} from '@/lib/ops/supplier-wht-category';
import {
  effectiveVendorBillWhtRatePercent,
  effectiveVendorBillWithholdingEnabled,
  roundMoney2,
  supplierWithholdingOnVendorBill,
} from '@/lib/ops/purchase-payment-milestones';
import {
  requestVendorBillPostPaymentAdjustment,
  settleVendorBillPostPaymentAdjustment,
} from '@/lib/services/vendor-bill-post-payment-adjustment-service';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { timestampToHtmlDateValue } from '@/lib/date-thai';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BankAccount } from '@/lib/types';

function canRequestAdjust(bill: PurchaseVendorBill): boolean {
  if (bill.postPaymentAdjustment?.status === 'PENDING_ACCOUNTING') return false;
  return bill.status === 'PAID' || bill.status === 'CLOSED';
}

export function VendorBillPostPaymentAdjustMenu({
  bill,
  purchase: purchaseProp,
  currentUser,
  size = 'sm',
}: {
  bill: PurchaseVendorBill;
  purchase?: Purchase | null;
  currentUser: User;
  size?: 'sm' | 'default';
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const purchaseRef = useMemoFirebase(
    () =>
      firestore && !purchaseProp && bill.purchaseId
        ? doc(firestore, 'purchases', bill.purchaseId)
        : null,
    [firestore, purchaseProp, bill.purchaseId],
  );
  const { data: purchaseLoaded } = useDoc<Purchase>(purchaseRef as any);
  const purchase = purchaseProp ?? purchaseLoaded ?? null;

  const [kind, setKind] = useState<VendorBillAdjustmentKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [grossInput, setGrossInput] = useState('');
  const [whtCategory, setWhtCategory] = useState<VendorBillWhtPresetCategory>('SERVICE');
  const [disableWht, setDisableWht] = useState(false);
  const [reason, setReason] = useState('');

  const preview = useMemo(() => {
    if (!purchase || !kind) return null;
    const gross =
      kind === 'AMOUNT'
        ? roundMoney2(Number(String(grossInput).replace(/,/g, '')) || 0)
        : roundMoney2(Number(bill.billAmount ?? purchase.totalAmount) || 0);
    const rate = disableWht ? 0 : supplierWhtCategoryDefaultRate(whtCategory);
    const br =
      rate > 0.005
        ? supplierWithholdingOnVendorBill(gross, rate, purchase, bill.billVatTreatment, {
            supplierWithholdingTaxBaseBill:
              kind === 'WHT_RATE' ? bill.supplierWithholdingTaxBaseBill : null,
          })
        : { wht: 0, netPaid: gross, baseBeforeVat: 0 };
    const origEnabled = effectiveVendorBillWithholdingEnabled(bill, purchase);
    const origRate = origEnabled ? effectiveVendorBillWhtRatePercent(bill, purchase) : 0;
    const origGross = roundMoney2(Number(bill.billAmount ?? purchase.totalAmount) || 0);
    const origBr =
      origRate > 0.005
        ? supplierWithholdingOnVendorBill(origGross, origRate, purchase, bill.billVatTreatment, bill)
        : { wht: 0, netPaid: origGross, baseBeforeVat: 0 };
    const delta = roundMoney2(br.netPaid - origBr.netPaid);
    return { gross, rate, br, origBr, delta };
  }, [purchase, kind, grossInput, disableWht, whtCategory, bill]);

  if (!canRequestAdjust(bill) || !purchase) return null;

  const openDialog = (k: VendorBillAdjustmentKind) => {
    const gross = roundMoney2(Number(bill.billAmount ?? purchase.totalAmount) || 0);
    setGrossInput(String(gross));
    const enabled = effectiveVendorBillWithholdingEnabled(bill, purchase);
    const cat =
      bill.vendorBillWhtPresetCategory ||
      purchase.supplierWithholdingCategory ||
      'SERVICE';
    setWhtCategory(cat === 'CONTRACT' ? 'SERVICE' : cat);
    setDisableWht(!enabled);
    setReason('');
    setKind(k);
  };

  const submit = async () => {
    if (!firestore || !kind) return;
    setBusy(true);
    try {
      const { adjustment } = await requestVendorBillPostPaymentAdjustment(firestore, bill.id, currentUser, {
        kind,
        reason,
        proposedGrossInclVat: kind === 'AMOUNT' ? Number(String(grossInput).replace(/,/g, '')) : undefined,
        proposedWhtCategory: disableWht ? null : whtCategory,
        disableWithholding: disableWht,
      });
      setKind(null);
      const dir =
        adjustment.settlementDirection === 'PAY_MORE'
          ? 'ส่งบัญชีแล้ว — ส่วนต่างอยู่ในเจ้าหนี้รอบจ่ายเพิ่ม'
          : adjustment.settlementDirection === 'REFUND'
            ? 'ส่งบัญชีแล้ว — ส่วนต่างอยู่ในลูกหนี้รอรับคืน'
            : 'บันทึกแล้ว (ไม่มีส่วนต่างเงินโอน)';
      toast({
        title: 'บันทึกคำขอปรับปรุงแล้ว',
        description: `${dir}${adjustment.whtCertificateAmended ? ' · แก้หนังสือหัก ณ ที่จ่ายฉบับเดิมแล้ว' : ''}`,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size={size === 'sm' ? 'sm' : 'default'}
            className={size === 'sm' ? 'h-7 gap-1 text-xs font-semibold' : 'gap-2 font-semibold'}
          >
            <Pencil className="h-3.5 w-3.5" />
            แก้ไข
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onClick={() => openDialog('AMOUNT')}>
            1. ปรับปรุงยอดจ่าย
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openDialog('WHT_RATE')}>
            2. ปรับปรุงอัตรา หัก ณ ที่จ่าย
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!kind} onOpenChange={(o) => !o && !busy && setKind(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {kind === 'AMOUNT' ? 'ปรับปรุงยอดจ่าย' : 'ปรับปรุงอัตรา หัก ณ ที่จ่าย'}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {kind === 'AMOUNT'
                ? 'แก้ยอดในใบและเลือกหัก ณ ที่จ่ายใหม่ แล้วส่งบัญชี — จ่ายเพิ่มไปเจ้าหนี้ · รับคืนไปลูกหนี้'
                : 'แก้ประเภท/อัตราหักบนเอกสารฉบับเดิม — ส่วนต่างเงินโอนส่งบัญชีเช่นกัน'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {kind === 'AMOUNT' ? (
              <div className="space-y-2">
                <Label htmlFor="adj-gross">ยอดในใบใหม่ (รวม VAT)</Label>
                <Input
                  id="adj-gross"
                  inputMode="decimal"
                  value={grossInput}
                  onChange={(e) => setGrossInput(e.target.value)}
                  disabled={busy}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>ประเภทหัก ณ ที่จ่าย</Label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={disableWht}
                    onChange={(e) => setDisableWht(e.target.checked)}
                    disabled={busy}
                  />
                  ไม่หัก ณ ที่จ่าย
                </label>
              </div>
              {!disableWht ? (
                <RadioGroup
                  value={whtCategory}
                  onValueChange={(v) => setWhtCategory(v as VendorBillWhtPresetCategory)}
                  className="gap-2"
                  disabled={busy}
                >
                  {WHT_INCOME_CATEGORY_OPTIONS.map((opt) => (
                    <label
                      key={opt.id}
                      className="flex cursor-pointer items-start gap-3 rounded-md border border-muted bg-muted/20 px-3 py-2.5 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem value={opt.id} id={`adj-wht-${opt.id}`} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-tight">{opt.title}</span>
                        <span className="text-xs text-muted-foreground">{opt.detail}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              ) : null}
            </div>

            {preview ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
                <p>
                  เดิม: สุทธิโอน ฿
                  {preview.origBr.netPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })} · หัก ฿
                  {preview.origBr.wht.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p>
                  ใหม่: สุทธิโอน ฿
                  {preview.br.netPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })} · หัก ฿
                  {preview.br.wht.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  {!disableWht ? ` (${preview.rate}%)` : ''}
                </p>
                <p className="font-semibold text-foreground">
                  ส่วนต่าง ฿
                  {Math.abs(preview.delta).toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                  {preview.delta > 0.005
                    ? '→ จ่ายเพิ่ม (เจ้าหนี้)'
                    : preview.delta < -0.005
                      ? '→ รับคืน (ลูกหนี้)'
                      : '→ ไม่มีเงินโอนเพิ่ม'}
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="adj-reason">เหตุผล *</Label>
              <Textarea
                id="adj-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น เลือกประเภทหักผิด / ยอดในใบกำกับจริงไม่ตรง"
                disabled={busy}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setKind(null)}>
              ยกเลิก
            </Button>
            <Button type="button" disabled={busy || !reason.trim()} onClick={() => void submit()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              ส่งบัญชี
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VendorBillPostPaymentSettlePanel({
  bill,
  currentUser,
  bankAccounts,
}: {
  bill: PurchaseVendorBill;
  currentUser: User;
  bankAccounts: BankAccount[] | null | undefined;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const adj = bill.postPaymentAdjustment;
  const [bankId, setBankId] = useState('');
  const [entryDate, setEntryDate] = useState(() => timestampToHtmlDateValue(Date.now()));
  const [busy, setBusy] = useState(false);

  if (!adj || adj.status !== 'PENDING_ACCOUNTING' || adj.settlementDirection === 'NONE') {
    return null;
  }

  const amount = Math.abs(adj.settlementDelta);
  const isPayMore = adj.settlementDirection === 'PAY_MORE';
  const activeBanks = (bankAccounts ?? []).filter((b) => !b.status || b.status === 'ACTIVE');

  const settle = async () => {
    if (!firestore) return;
    setBusy(true);
    try {
      const { cashbookEntryNo } = await settleVendorBillPostPaymentAdjustment(firestore, bill.id, currentUser, {
        bankAccountId: bankId,
        entryDate,
        amount,
      });
      toast({
        title: isPayMore ? 'บันทึกจ่ายเพิ่มแล้ว' : 'บันทึกรับคืนแล้ว',
        description: `Cashbook ${cashbookEntryNo}`,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'เคลียร์ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-300/80 bg-amber-50/60 p-4 space-y-3 dark:bg-amber-950/20">
      <div>
        <p className="text-sm font-bold text-amber-950 dark:text-amber-100">
          รอบัญชีเคลียร์ส่วนต่างหลังปรับปรุง
          {adj.kind === 'WHT_RATE' ? 'อัตราหัก ณ ที่จ่าย' : 'ยอดจ่าย'}
        </p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {adj.reason} · {isPayMore ? 'ต้องจ่ายเพิ่ม' : 'ต้องรับคืน'} ฿
          {amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          {adj.whtCertificateAmended ? ' · แก้หนังสือหักฉบับเดิมแล้ว' : ''}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>บัญชีธนาคาร</Label>
          <Select value={bankId || undefined} onValueChange={setBankId}>
            <SelectTrigger>
              <SelectValue placeholder="เลือกบัญชี..." />
            </SelectTrigger>
            <SelectContent>
              {activeBanks.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.bankName} · {b.accountName || b.accountNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="adj-settle-date">วันที่</Label>
          <Input
            id="adj-settle-date"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>
      <Button
        type="button"
        className="font-semibold"
        disabled={busy || !bankId || !entryDate}
        onClick={() => void settle()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {isPayMore ? 'ยืนยันจ่ายเพิ่มลง cashbook' : 'ยืนยันรับคืนลง cashbook'}
      </Button>
    </div>
  );
}
