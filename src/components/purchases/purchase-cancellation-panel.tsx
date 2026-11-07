'use client';

import { useState } from 'react';
import { Ban, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useFirestore } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  approvePurchaseCancellation,
  canDecidePurchaseCancellation,
  canRequestPurchaseCancellation,
  rejectPurchaseCancellation,
  requestPurchaseCancellation,
} from '@/lib/purchases/purchase-cancellation';
import type { Purchase, PurchaseCancellationRefundMode, User } from '@/lib/types';

export function PurchaseCancellationPanel({
  purchase,
  currentUser,
  canEdit,
  canApprove,
}: {
  purchase: Purchase;
  currentUser: User;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [approverNote, setApproverNote] = useState('');
  const [refundMode, setRefundMode] = useState<PurchaseCancellationRefundMode>('REFUND_REQUIRED');
  const [busy, setBusy] = useState(false);

  const pending = purchase.cancellationRequestStatus === 'PENDING';
  const showRequest = canEdit && canRequestPurchaseCancellation(purchase);
  const showDecision = canDecidePurchaseCancellation(currentUser, purchase, canApprove);
  const waitingOthers = pending && !showDecision;
  const showRejected =
    purchase.cancellationRequestStatus === 'REJECTED' &&
    purchase.status !== 'PENDING_CANCELLATION' &&
    purchase.status !== 'CANCELLED';
  const showPendingCancel = purchase.status === 'PENDING_CANCELLATION';
  const showSettled = purchase.status === 'CANCELLED' && !!purchase.cancellationSettledAt;

  if (!showRequest && !pending && !showRejected && !showPendingCancel && !showSettled) return null;

  const run = async (fn: () => Promise<void>, ok: string) => {
    if (!firestore) return;
    setBusy(true);
    try {
      await fn();
      toast({ title: ok });
      setReason('');
      setRejectReason('');
      setApproverNote('');
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ทำรายการไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Ban className="h-4 w-4" /> ยกเลิกใบสั่งซื้อ
        </CardTitle>
        <CardDescription>
          คำขอเข้าคิวอนุมัติใบสั่งซื้อ เมื่ออนุมัติแล้วสถานะเป็นรอยกเลิกและส่งต่อแผนกบัญชี
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showPendingCancel && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 space-y-1">
            <p className="font-semibold">รอยกเลิก — รอแผนกบัญชีปิดเรื่อง</p>
            <p>
              {purchase.cancellationRefundMode === 'REFUND_REQUIRED'
                ? 'ต้องรับเงินคืนจากคู่ค้า — รายการอยู่ในลูกหนี้การค้า บันทึกรับเงินเข้าบัญชีโดยไม่ออกใบเสร็จ'
                : 'ไม่ต้องรับเงินคืน — ใบวางบิลยอด 0 อยู่ในรายการจ่ายเจ้าหนี้ รอผู้ตรวจสอบกดยืนยัน'}
            </p>
            {purchase.cancellationApproverNote ? (
              <p className="text-xs">เหตุผลผู้อนุมัติ: {purchase.cancellationApproverNote}</p>
            ) : null}
          </div>
        )}

        {showSettled && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <p className="font-semibold">ยกเลิกแล้ว</p>
            {purchase.cancellationReceivedAmount != null ? (
              <p>
                รับเงินคืน ฿{purchase.cancellationReceivedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                {purchase.cancellationCashbookEntryNo ? ` · สมุด ${purchase.cancellationCashbookEntryNo}` : ''}
                {' '}— ไม่ออกใบเสร็จ
              </p>
            ) : (
              <p>ปิดเรื่องโดยไม่รับเงินคืน</p>
            )}
            {purchase.cancellationSettledByName ? (
              <p className="text-xs text-muted-foreground">
                โดย {purchase.cancellationSettledByName}
                {purchase.cancellationSettledAt
                  ? ` · ${new Date(purchase.cancellationSettledAt).toLocaleString('th-TH')}`
                  : ''}
              </p>
            ) : null}
          </div>
        )}

        {showRejected && purchase.cancellationRejectReason ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-semibold text-destructive">คำขอยกเลิกไม่ผ่าน</p>
            <p>{purchase.cancellationRejectReason}</p>
          </div>
        ) : null}

        {pending && purchase.cancellationReason ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <p className="font-semibold">รออนุมัติเพื่อยกเลิก</p>
            <p className="whitespace-pre-wrap">{purchase.cancellationReason}</p>
            <p className="text-xs text-muted-foreground">
              {purchase.cancellationRequestedByName || '—'}
              {purchase.cancellationRequestedAt
                ? ` · ${new Date(purchase.cancellationRequestedAt).toLocaleString('th-TH')}`
                : ''}
            </p>
          </div>
        ) : null}

        {waitingOthers && (
          <p className="text-sm text-amber-900">คำขออยู่ในคิวอนุมัติใบสั่งซื้อ — รอผู้จัดการพิจารณา</p>
        )}

        {showRequest && (
          <div className="space-y-2">
            <Label htmlFor="po-cancel-reason">เหตุผลในการขอยกเลิก</Label>
            <Textarea
              id="po-cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="ระบุเหตุผลที่ต้องยกเลิกใบสั่งซื้อนี้"
            />
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() =>
                void run(
                  () => requestPurchaseCancellation(firestore!, currentUser, purchase.id, reason),
                  'ส่งคำขอยกเลิกแล้ว — อยู่ในคิวอนุมัติใบสั่งซื้อ',
                )
              }
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              ขอยกเลิกใบสั่งซื้อ
            </Button>
          </div>
        )}

        {showDecision && (
          <div className="space-y-3 border-t pt-3">
            <p className="text-sm font-semibold">อนุมัติเพื่อยกเลิก — เลือกทางปิดเรื่องอย่างใดอย่างหนึ่ง</p>
            <RadioGroup
              value={refundMode}
              onValueChange={(v) => setRefundMode(v as PurchaseCancellationRefundMode)}
              className="space-y-2"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="REFUND_REQUIRED" id="po-cancel-refund" />
                <Label htmlFor="po-cancel-refund" className="font-normal leading-snug">
                  1. ต้องรับเงินคืนจาก supplier — ส่งไปรายลูกหนี้
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="NO_REFUND" id="po-cancel-norefund" />
                <Label htmlFor="po-cancel-norefund" className="font-normal leading-snug">
                  2. ไม่ต้องรับเงินคืน — ระบุเหตุผล แล้วส่งใบวางบิลยอด 0 ให้บัญชียืนยัน
                </Label>
              </div>
            </RadioGroup>
            {refundMode === 'NO_REFUND' ? (
              <div className="space-y-2">
                <Label htmlFor="po-cancel-approver-note">เหตุผลที่ไม่ต้องรับเงินคืน</Label>
                <Textarea
                  id="po-cancel-approver-note"
                  value={approverNote}
                  onChange={(e) => setApproverNote(e.target.value)}
                  rows={3}
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="bg-green-600 hover:bg-green-700"
                disabled={busy || (refundMode === 'NO_REFUND' && !approverNote.trim())}
                onClick={() =>
                  void run(
                    () =>
                      approvePurchaseCancellation(firestore!, currentUser, purchase, refundMode, approverNote),
                    'อนุมัติยกเลิกแล้ว — สถานะเป็นรอยกเลิก และส่งต่อแผนกบัญชี',
                  )
                }
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                อนุมัติยกเลิก
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-cancel-reject">เหตุผลที่ไม่อนุมัติคำขอยกเลิก</Label>
              <Textarea
                id="po-cancel-reject"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy || !rejectReason.trim()}
                onClick={() =>
                  void run(
                    () => rejectPurchaseCancellation(firestore!, currentUser, purchase.id, rejectReason),
                    'ไม่อนุมัติคำขอยกเลิก — ใบสั่งซื้อยังคงสถานะเดิม',
                  )
                }
              >
                <XCircle className="h-4 w-4" /> ไม่อนุมัติคำขอยกเลิก
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
