'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Loader2 } from 'lucide-react';
import {
  PayrollSsoListTable,
  PayrollSsoPayButtons,
  type PayrollSsoPayKind,
  type PayrollSsoTableRow,
} from '@/components/accounting/payroll-sso-list-table';
import { fmtBaht } from '@/components/accounting/withholding-wht-pay-tax-ui';
import {
  countSelectedForKind,
  selectableKeySig,
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

export type SsoSectionKind = 'worker' | 'office' | 'executive';

type PayDialogState = { kind: PayrollSsoPayKind } | null;

export function PayrollSsoSectionCard({
  title,
  description,
  icon,
  loading,
  error,
  emptyFiltered,
  emptyAll,
  tableRows,
  totalSsoLabel,
  canPay,
  firestore,
  currentUser,
  operatingBankOptions,
  sectionKind,
  workerRows,
  officeRows,
  executiveRows,
  onWorkerRowsChange,
  onOfficeRowsChange,
  onExecutiveRowsChange,
}: {
  title: ReactNode;
  description: string;
  icon: ReactNode;
  loading: boolean;
  error: string | null;
  emptyFiltered: string;
  emptyAll: string;
  tableRows: PayrollSsoTableRow[];
  totalSsoLabel: string;
  canPay: boolean;
  firestore: Firestore | null;
  currentUser: User | null;
  operatingBankOptions: BankAccount[];
  sectionKind: SsoSectionKind;
  workerRows?: WorkerSsoRow[];
  officeRows?: OfficeSsoRow[];
  executiveRows?: ExecutiveSsoRow[];
  onWorkerRowsChange?: (updater: (prev: WorkerSsoRow[]) => WorkerSsoRow[]) => void;
  onOfficeRowsChange?: (updater: (prev: OfficeSsoRow[]) => OfficeSsoRow[]) => void;
  onExecutiveRowsChange?: (updater: (prev: ExecutiveSsoRow[]) => ExecutiveSsoRow[]) => void;
}) {
  const { toast } = useToast();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [payDialog, setPayDialog] = useState<PayDialogState>(null);
  const [payBankId, setPayBankId] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payBusy, setPayBusy] = useState(false);

  const keySig = useMemo(() => selectableKeySig(tableRows), [tableRows]);

  useEffect(() => {
    const keys = keySig ? keySig.split('|') : [];
    setSelectedKeys(new Set(keys));
  }, [keySig]);

  const selectedSsoCount = useMemo(
    () => countSelectedForKind(tableRows, selectedKeys, 'sso_remit'),
    [tableRows, selectedKeys],
  );
  const selectedEmployerCount = useMemo(
    () => countSelectedForKind(tableRows, selectedKeys, 'employer_contrib'),
    [tableRows, selectedKeys],
  );

  const payTargets = useMemo(() => {
    if (!payDialog) return [];
    return tableRows.filter((r) => {
      if (!selectedKeys.has(r.rowKey)) return false;
      return payDialog.kind === 'sso_remit' ? r.ssoPayable : r.employerPayable;
    });
  }, [payDialog, tableRows, selectedKeys]);

  const payDialogTotal = useMemo(
    () =>
      payTargets.reduce(
        (sum, r) => sum + (payDialog?.kind === 'sso_remit' ? r.sso : r.employerContrib),
        0,
      ),
    [payTargets, payDialog],
  );

  const openPayDialog = useCallback(
    (kind: PayrollSsoPayKind) => {
      const count = kind === 'sso_remit' ? selectedSsoCount : selectedEmployerCount;
      if (count === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการที่พร้อมจ่าย',
          description:
            kind === 'sso_remit'
              ? 'ต้องจ่ายค่าจ้างแล้วและยังไม่ได้จ่ายประกันสังคม'
              : 'ต้องจ่ายค่าจ้างแล้วและยังไม่ได้จ่ายเงินสมทบ',
        });
        return;
      }
      setPayDialog({ kind });
      setPayBankId((prev) =>
        prev && operatingBankOptions.some((b) => b.id === prev) ? prev : (operatingBankOptions[0]?.id ?? ''),
      );
      setPayDate(new Date().toISOString().slice(0, 10));
    },
    [selectedSsoCount, selectedEmployerCount, operatingBankOptions, toast],
  );

  const patchLineAfterPay = useCallback(
    (rowKey: string, kind: PayrollSsoPayKind, result: { cashbookEntryId: string; entryNo: string }, bankId: string) => {
      const now = Date.now();
      const ssoPatch =
        kind === 'sso_remit'
          ? {
              ssoRemitCashbookEntryId: result.cashbookEntryId,
              ssoRemitCashbookEntryNo: result.entryNo,
              ssoRemitPaidAt: now,
              ssoRemitPaymentBankAccountId: bankId,
            }
          : {
              ssoEmployerContribCashbookEntryId: result.cashbookEntryId,
              ssoEmployerContribCashbookEntryNo: result.entryNo,
              ssoEmployerContribPaidAt: now,
              ssoEmployerContribPaymentBankAccountId: bankId,
            };

      if (sectionKind === 'worker' && onWorkerRowsChange && workerRows) {
        onWorkerRowsChange((prev) =>
          prev.map((row) => {
            const key = `worker::${row.batch.id}::${row.line.id}`;
            if (key !== rowKey) return row;
            return { ...row, line: { ...row.line, ...ssoPatch } };
          }),
        );
      } else if (sectionKind === 'office' && onOfficeRowsChange && officeRows) {
        onOfficeRowsChange((prev) =>
          prev.map((row) => {
            const key = `office::${row.run.id}::${row.line.id}`;
            if (key !== rowKey) return row;
            return { ...row, line: { ...row.line, ...ssoPatch } };
          }),
        );
      } else if (sectionKind === 'executive' && onExecutiveRowsChange && executiveRows) {
        onExecutiveRowsChange((prev) =>
          prev.map((row) => {
            const key = `executive::${row.run.id}::${row.line.id}`;
            if (key !== rowKey) return row;
            return { ...row, line: { ...row.line, ...ssoPatch } };
          }),
        );
      }
    },
    [sectionKind, onWorkerRowsChange, onOfficeRowsChange, onExecutiveRowsChange, workerRows, officeRows, executiveRows],
  );

  const handleConfirmPay = useCallback(async () => {
    if (!firestore || !currentUser || !payDialog) return;
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
    const paidKeys = new Set<string>();

    try {
      for (const target of payTargets) {
        try {
          if (sectionKind === 'worker' && workerRows) {
            const row = workerRows.find((r) => `worker::${r.batch.id}::${r.line.id}` === target.rowKey);
            if (!row) continue;
            const result = await recordWorkerPayrollSsoPayment(firestore, currentUser, {
              batch: row.batch,
              line: row.line,
              kind: payDialog.kind,
              employeeSsoAmount: row.sso,
              bankAccountId: payBankId,
              entryDate: payDate,
              earnerName: row.line.workerNameSnapshot || row.line.workerId,
            });
            patchLineAfterPay(target.rowKey, payDialog.kind, result, payBankId);
          } else if (sectionKind === 'office' && officeRows) {
            const row = officeRows.find((r) => `office::${r.run.id}::${r.line.id}` === target.rowKey);
            if (!row) continue;
            const result = await recordOfficePayrollSsoPayment(firestore, currentUser, {
              run: row.run,
              line: row.line,
              kind: payDialog.kind,
              employeeSsoAmount: row.sso,
              bankAccountId: payBankId,
              entryDate: payDate,
              earnerName: row.line.staffName || row.line.staffId,
            });
            patchLineAfterPay(target.rowKey, payDialog.kind, result, payBankId);
          } else if (sectionKind === 'executive' && executiveRows) {
            const row = executiveRows.find((r) => `executive::${r.run.id}::${r.line.id}` === target.rowKey);
            if (!row) continue;
            const result = await recordExecutivePayrollSsoPayment(firestore, currentUser, {
              run: row.run,
              line: row.line,
              kind: payDialog.kind,
              employeeSsoAmount: row.sso,
              bankAccountId: payBankId,
              entryDate: payDate,
              earnerName: row.line.staffName || row.line.staffId,
            });
            patchLineAfterPay(target.rowKey, payDialog.kind, result, payBankId);
          }
          paidKeys.add(target.rowKey);
          success += 1;
        } catch (e) {
          errors.push(`${target.earnerName}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (paidKeys.size > 0) {
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          for (const key of paidKeys) next.delete(key);
          return next;
        });
      }

      if (errors.length === 0) {
        toast({
          title: payDialog.kind === 'sso_remit' ? 'บันทึกจ่ายประกันสังคมแล้ว' : 'บันทึกจ่ายเงินสมทบแล้ว',
          description: `จ่ายสำเร็จ ${success} รายการ · ตัดบัญชีและบันทึก cashbook เรียบร้อย`,
        });
        setPayDialog(null);
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
    payDialog,
    payBankId,
    payDate,
    payTargets,
    sectionKind,
    workerRows,
    officeRows,
    executiveRows,
    patchLineAfterPay,
    toast,
  ]);

  const hasRows = tableRows.length > 0;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-lg">
                {icon}
                {title}
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
            {!loading && !error ? (
              <div className="flex flex-wrap items-stretch gap-2 shrink-0">
                <PayrollSsoPayButtons
                  canPay={canPay}
                  selectedSsoCount={selectedSsoCount}
                  selectedEmployerCount={selectedEmployerCount}
                  onPaySso={() => openPayDialog('sso_remit')}
                  onPayEmployer={() => openPayDialog('employer_contrib')}
                />
                <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-right shadow-sm sm:min-w-[180px]">
                  <p className="text-xs font-medium text-muted-foreground">ยอด ปส. รวม (ในตาราง)</p>
                  <p className="text-xl font-bold tabular-nums tracking-tight text-primary">{totalSsoLabel}</p>
                </div>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !hasRows ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{emptyFiltered || emptyAll}</p>
          ) : (
            <PayrollSsoListTable
              rows={tableRows}
              canPay={canPay}
              selectedKeys={selectedKeys}
              onSelectedKeysChange={setSelectedKeys}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!payDialog} onOpenChange={(open) => !open && !payBusy && setPayDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {payDialog?.kind === 'sso_remit' ? 'จ่ายประกันสังคม' : 'จ่ายเงินสมทบนายจ้าง'}
            </DialogTitle>
            <DialogDescription>
              เลือกบัญชีธนาคารสำหรับตัดจ่าย — ระบบจะบันทึกรายการ cashbook แยกตามรายการที่เลือก
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-md border bg-muted/30 p-3 space-y-1">
              <p className="font-medium">รายการที่เลือก {payTargets.length} รายการ</p>
              <p className="text-muted-foreground">
                ยอดรวม{' '}
                <span className="font-semibold text-primary tabular-nums">{fmtBaht(payDialogTotal)}</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`sso-pay-bank-${sectionKind}`}>บัญชีธนาคารที่ตัดจ่าย</Label>
              <Select value={payBankId} onValueChange={setPayBankId}>
                <SelectTrigger id={`sso-pay-bank-${sectionKind}`}>
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
              <Label htmlFor={`sso-pay-date-${sectionKind}`}>วันที่ตัดบัญชี</Label>
              <Input
                id={`sso-pay-date-${sectionKind}`}
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={payBusy} onClick={() => setPayDialog(null)}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="secondary"
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
