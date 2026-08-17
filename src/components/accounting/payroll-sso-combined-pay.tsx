'use client';

import { useCallback, useMemo, useState } from 'react';
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
import { Loader2 } from 'lucide-react';
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
import type { BankAccount, User } from '@/lib/types';
import type { Firestore } from 'firebase/firestore';
import {
  recordExecutivePayrollSsoPayment,
  recordOfficePayrollSsoPayment,
  recordWorkerPayrollSsoPayment,
} from '@/lib/services/payroll-sso-payment-service';
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
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payBankId, setPayBankId] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payBusy, setPayBusy] = useState(false);

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
  }, [payTargets.length, operatingBankOptions, toast]);

  const patchLineAfterPay = useCallback(
    (rowKeys: string[], result: { cashbookEntryId: string; entryNo: string }, bankId: string) => {
      const now = Date.now();
      const keySet = new Set(rowKeys);
      onWorkerRowsChange((prev) =>
        prev.map((row) => {
          const key = `worker::${row.batch.id}::${row.line.id}`;
          if (!keySet.has(key)) return row;
          return { ...row, line: applyLocalCombinedSsoPaymentPatch(row.line, result, bankId, now) };
        }),
      );
      onOfficeRowsChange((prev) =>
        prev.map((row) => {
          const key = `office::${row.run.id}::${row.line.id}`;
          if (!keySet.has(key)) return row;
          return { ...row, line: applyLocalCombinedSsoPaymentPatch(row.line, result, bankId, now) };
        }),
      );
      onExecutiveRowsChange((prev) =>
        prev.map((row) => {
          const key = `executive::${row.run.id}::${row.line.id}`;
          if (!keySet.has(key)) return row;
          return { ...row, line: applyLocalCombinedSsoPaymentPatch(row.line, result, bankId, now) };
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
            });
            patchLineAfterPay(memberKeys, result, payBankId);
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
            });
            patchLineAfterPay(memberKeys, result, payBankId);
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
            });
            patchLineAfterPay(memberKeys, result, payBankId);
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

      <Dialog open={payDialogOpen} onOpenChange={(open) => !open && !payBusy && setPayDialogOpen(false)}>
        <DialogContent className="max-w-md">
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
                <SelectTrigger id="sso-combined-pay-bank">
                  <SelectValue placeholder="เลือกบัญชี ACTIVE" />
                </SelectTrigger>
                <SelectContent>
                  {operatingBankOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
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
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={payBusy} onClick={() => setPayDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={payBusy || !payBankId || payTargets.length === 0}
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
