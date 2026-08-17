'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Paperclip } from 'lucide-react';
import {
  fmtSsoBaht,
  type PayrollSsoTableRow,
} from '@/components/accounting/payroll-sso-list-table';
import {
  payAmountForRow,
  applyLocalCombinedSsoPaymentPatch,
  type ExecutiveSsoRow,
  type OfficeSsoRow,
  type WorkerSsoRow,
} from '@/app/accounting/social-security-payroll/sso-section-utils';
import type { BankAccount, User, WhtTaxPaymentProofAttachment } from '@/lib/types';
import type { Firestore } from 'firebase/firestore';
import {
  recordExecutivePayrollSsoPayment,
  recordOfficePayrollSsoPayment,
  recordWorkerPayrollSsoPayment,
} from '@/lib/services/payroll-sso-payment-service';
import { uploadPayrollSsoPaymentProof } from '@/lib/storage/payroll-wht-tax-payment-proofs';
import { useFirebaseApp } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

function payableTableRows(...groups: PayrollSsoTableRow[][]): PayrollSsoTableRow[] {
  return groups.flat().filter((r) => r.isGroupLeader !== false && (r.ssoPayable || r.employerPayable));
}

export function PayrollSsoCombinedPayButton({
  canPay,
  loading,
  firestore,
  currentUser,
  operatingBankOptions,
  workerTableRows,
  officeTableRows,
  executiveTableRows,
  workerRows,
  officeRows,
  executiveRows,
  onWorkerRowsChange,
  onOfficeRowsChange,
  onExecutiveRowsChange,
}: {
  canPay: boolean;
  loading: boolean;
  firestore: Firestore | null;
  currentUser: User | null;
  operatingBankOptions: BankAccount[];
  workerTableRows: PayrollSsoTableRow[];
  officeTableRows: PayrollSsoTableRow[];
  executiveTableRows: PayrollSsoTableRow[];
  workerRows: WorkerSsoRow[];
  officeRows: OfficeSsoRow[];
  executiveRows: ExecutiveSsoRow[];
  onWorkerRowsChange: (updater: (prev: WorkerSsoRow[]) => WorkerSsoRow[]) => void;
  onOfficeRowsChange: (updater: (prev: OfficeSsoRow[]) => OfficeSsoRow[]) => void;
  onExecutiveRowsChange: (updater: (prev: ExecutiveSsoRow[]) => ExecutiveSsoRow[]) => void;
}) {
  const { toast } = useToast();
  const firebaseApp = useFirebaseApp();
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payBankId, setPayBankId] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payBusy, setPayBusy] = useState(false);
  const [payAttachments, setPayAttachments] = useState<WhtTaxPaymentProofAttachment[]>([]);
  const [attachProofBusy, setAttachProofBusy] = useState(false);

  const payTargets = useMemo(
    () => payableTableRows(workerTableRows, officeTableRows, executiveTableRows),
    [workerTableRows, officeTableRows, executiveTableRows],
  );

  const payDialogTotal = useMemo(
    () => payTargets.reduce((sum, r) => sum + payAmountForRow(r), 0),
    [payTargets],
  );

  const openPayDialog = useCallback(() => {
    if (payTargets.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีรายการที่พร้อมจ่าย',
        description: 'ต้องจ่ายค่าจ้างแล้วและยังไม่ได้จ่าย ปกส.+สมทบ ครบ — หรือปรับตัวกรอง',
      });
      return;
    }
    setPayDialogOpen(true);
    setPayBankId((prev) =>
      prev && operatingBankOptions.some((b) => b.id === prev) ? prev : (operatingBankOptions[0]?.id ?? ''),
    );
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayAttachments([]);
  }, [payTargets.length, operatingBankOptions, toast]);

  const handleAttachProof = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || !firebaseApp || !currentUser) return;
      setAttachProofBusy(true);
      try {
        const uploaded: WhtTaxPaymentProofAttachment[] = [];
        for (const file of Array.from(files)) {
          const attachment = await uploadPayrollSsoPaymentProof(
            firebaseApp,
            currentUser.id,
            file,
            currentUser.displayName || currentUser.email || currentUser.id,
          );
          uploaded.push(attachment);
        }
        setPayAttachments((prev) => {
          const next = [...prev];
          for (const a of uploaded) {
            if (!next.some((x) => x.id === a.id)) next.push(a);
          }
          return next;
        });
        toast({
          title: 'แนบเอกสารแล้ว',
          description: uploaded.length > 1 ? `อัปโหลด ${uploaded.length} ไฟล์` : uploaded[0]?.fileName,
        });
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'แนบเอกสารไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setAttachProofBusy(false);
        if (proofInputRef.current) proofInputRef.current.value = '';
      }
    },
    [firebaseApp, currentUser, toast],
  );

  const handleRemoveProof = useCallback((attachmentId: string) => {
    setPayAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }, []);

  const patchLineAfterPay = useCallback(
    (
      rowKeys: string[],
      result: { cashbookEntryId: string; entryNo: string },
      bankId: string,
      proofs: WhtTaxPaymentProofAttachment[],
    ) => {
      const now = Date.now();
      const keySet = new Set(rowKeys);
      onWorkerRowsChange((prev) =>
        prev.map((row) => {
          const key = `worker::${row.batch.id}::${row.line.id}`;
          if (!keySet.has(key)) return row;
          return {
            ...row,
            line: applyLocalCombinedSsoPaymentPatch(row.line, result, bankId, now, proofs),
          };
        }),
      );
      onOfficeRowsChange((prev) =>
        prev.map((row) => {
          const key = `office::${row.run.id}::${row.line.id}`;
          if (!keySet.has(key)) return row;
          return {
            ...row,
            line: applyLocalCombinedSsoPaymentPatch(row.line, result, bankId, now, proofs),
          };
        }),
      );
      onExecutiveRowsChange((prev) =>
        prev.map((row) => {
          const key = `executive::${row.run.id}::${row.line.id}`;
          if (!keySet.has(key)) return row;
          return {
            ...row,
            line: applyLocalCombinedSsoPaymentPatch(row.line, result, bankId, now, proofs),
          };
        }),
      );
    },
    [onWorkerRowsChange, onOfficeRowsChange, onExecutiveRowsChange],
  );

  const handleConfirmPay = useCallback(async () => {
    if (!firestore || !currentUser || !payDialogOpen) return;
    if (!payBankId.trim()) {
      toast({ variant: 'destructive', title: 'กรุณาเลือกบัญชีธนาคาร' });
      return;
    }
    if (payAttachments.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้แนบเอกสาร',
        description: 'กรุณาแนบหลักฐานการโอนก่อนยืนยันจ่าย ปกส.+สมทบ',
      });
      return;
    }
    if (payTargets.length === 0) {
      toast({ variant: 'destructive', title: 'ยังไม่ได้เลือกรายการ' });
      return;
    }

    setPayBusy(true);
    let success = 0;
    const errors: string[] = [];

    try {
      for (const target of payTargets) {
        if (target.isGroupLeader === false) continue;
        try {
          const memberKeys = target.memberRowKeys?.length ? target.memberRowKeys : [target.rowKey];
          if (target.rowKey.startsWith('worker::')) {
            const row = workerRows.find((r) => `worker::${r.batch.id}::${r.line.id}` === target.rowKey);
            if (!row) continue;
            const companions = workerRows
              .filter((r) => {
                const k = `worker::${r.batch.id}::${r.line.id}`;
                return memberKeys.includes(k) && k !== target.rowKey;
              })
              .map((r) => ({ batch: r.batch, line: r.line }));
            const result = await recordWorkerPayrollSsoPayment(firestore, currentUser, {
              batch: row.batch,
              line: row.line,
              employeeSsoAmount: target.sso,
              bankAccountId: payBankId,
              entryDate: payDate,
              earnerName: row.line.workerNameSnapshot || row.line.workerId,
              companionLines: companions,
              proofAttachments: payAttachments,
            });
            patchLineAfterPay(memberKeys, result, payBankId, payAttachments);
          } else if (target.rowKey.startsWith('office::')) {
            const row = officeRows.find((r) => `office::${r.run.id}::${r.line.id}` === target.rowKey);
            if (!row) continue;
            const companions = officeRows
              .filter((r) => {
                const k = `office::${r.run.id}::${r.line.id}`;
                return memberKeys.includes(k) && k !== target.rowKey;
              })
              .map((r) => ({ run: r.run, line: r.line }));
            const result = await recordOfficePayrollSsoPayment(firestore, currentUser, {
              run: row.run,
              line: row.line,
              employeeSsoAmount: target.sso,
              bankAccountId: payBankId,
              entryDate: payDate,
              earnerName: row.line.staffName || row.line.staffId,
              companionLines: companions,
              proofAttachments: payAttachments,
            });
            patchLineAfterPay(memberKeys, result, payBankId, payAttachments);
          } else if (target.rowKey.startsWith('executive::')) {
            const row = executiveRows.find((r) => `executive::${r.run.id}::${r.line.id}` === target.rowKey);
            if (!row) continue;
            const companions = executiveRows
              .filter((r) => {
                const k = `executive::${r.run.id}::${r.line.id}`;
                return memberKeys.includes(k) && k !== target.rowKey;
              })
              .map((r) => ({ run: r.run, line: r.line }));
            const result = await recordExecutivePayrollSsoPayment(firestore, currentUser, {
              run: row.run,
              line: row.line,
              employeeSsoAmount: target.sso,
              bankAccountId: payBankId,
              entryDate: payDate,
              earnerName: row.line.staffName || row.line.staffId,
              companionLines: companions,
              proofAttachments: payAttachments,
            });
            patchLineAfterPay(memberKeys, result, payBankId, payAttachments);
          }
          success += 1;
        } catch (e) {
          errors.push(`${target.earnerName}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (errors.length === 0) {
        toast({
          title: 'บันทึกจ่าย ปกส.+สมทบ แล้ว',
          description: `จ่ายสำเร็จ ${success} รายการ (ลูกจ้าง+ออฟฟิศ+ผู้บริหาร) · ตัดบัญชีและบันทึก cashbook เรียบร้อย`,
        });
        setPayAttachments([]);
        setPayDialogOpen(false);
      } else if (success > 0) {
        toast({
          variant: 'destructive',
          title: `จ่ายสำเร็จ ${success} รายการ · ล้มเหลว ${errors.length} รายการ`,
          description: errors.slice(0, 3).join(' · '),
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'จ่ายไม่สำเร็จ',
          description: errors.slice(0, 3).join(' · '),
        });
      }
    } finally {
      setPayBusy(false);
    }
  }, [
    firestore,
    currentUser,
    payDialogOpen,
    payBankId,
    payDate,
    payAttachments,
    payTargets,
    workerRows,
    officeRows,
    executiveRows,
    patchLineAfterPay,
    toast,
  ]);

  if (!canPay || loading) return null;

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        className="h-10 shrink-0 gap-2 whitespace-nowrap"
        disabled={payTargets.length === 0}
        onClick={openPayDialog}
      >
        จ่าย ปกส.+สมทบ ({payTargets.length})
      </Button>

      <Dialog
        open={payDialogOpen}
        onOpenChange={(open) => {
          if (!open && !payBusy && !attachProofBusy) {
            setPayDialogOpen(false);
            setPayAttachments([]);
          }
        }}
      >
        <DialogContent className="max-w-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>จ่าย ปกส.+สมทบ (รวม 3 หมวด)</DialogTitle>
            <DialogDescription>
              ลูกจ้าง · ออฟฟิศ · ผู้บริหาร — ตามตัวกรองปัจจุบัน · cashbook 1 รายการต่อคน (ปกส.+สมทบ)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-md border bg-muted/30 p-3 space-y-1">
              <p className="font-medium">รายการที่พร้อมจ่าย {payTargets.length} รายการ</p>
              <p className="text-muted-foreground">
                ยอดรวม{' '}
                <span className="font-semibold text-destructive tabular-nums">{fmtSsoBaht(payDialogTotal)}</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sso-combined-pay-bank">บัญชีธนาคารที่ตัดจ่าย</Label>
              <Select value={payBankId} onValueChange={setPayBankId}>
                <SelectTrigger
                  id="sso-combined-pay-bank"
                  className="h-auto min-h-11 py-2 [&>span]:line-clamp-none [&>span]:whitespace-normal [&>span]:text-left"
                >
                  <SelectValue placeholder="เลือกบัญชี ACTIVE" />
                </SelectTrigger>
                <SelectContent className="max-w-[min(100vw-2rem,42rem)]">
                  {operatingBankOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="whitespace-normal">
                      {b.bankName} · {b.accountName} [{b.accountCode}]
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sso-combined-pay-date">วันที่ตัดบัญชี</Label>
              <Input
                id="sso-combined-pay-date"
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>เอกสารการโอน (บังคับแนบ)</Label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                แนบสลิปหรือหลักฐานการโอน ปกส.+สมทบ — รองรับ PDF หรือรูปภาพ (สูงสุด 10 MB ต่อไฟล์)
              </p>
              <input
                ref={proofInputRef}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
                className="hidden"
                onChange={(e) => void handleAttachProof(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={attachProofBusy || payBusy}
                onClick={() => proofInputRef.current?.click()}
              >
                {attachProofBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
                แนบเอกสาร
              </Button>
              {payAttachments.length > 0 ? (
                <ul className="rounded-md border bg-muted/20 px-3 py-2 space-y-1.5">
                  {payAttachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 min-w-0 text-xs">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" title={a.fileName}>
                        {a.fileName}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2"
                        disabled={attachProofBusy || payBusy}
                        onClick={() => handleRemoveProof(a.id)}
                      >
                        ลบ
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-amber-800 dark:text-amber-200/90">
                  ยังไม่มีเอกสารแนบ — ต้องแนบก่อนจึงจะกดยืนยันจ่ายได้
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={payBusy || attachProofBusy}
              onClick={() => {
                setPayDialogOpen(false);
                setPayAttachments([]);
              }}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                payBusy ||
                attachProofBusy ||
                !payBankId ||
                payAttachments.length === 0 ||
                payTargets.length === 0
              }
              onClick={() => void handleConfirmPay()}
            >
              {payBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              ยืนยันจ่าย ({payTargets.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
