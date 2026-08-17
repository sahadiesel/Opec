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
  PayrollSsoPayButton,
  fmtSsoBaht,
  type PayrollSsoTableRow,
} from '@/components/accounting/payroll-sso-list-table';
import {
  countSelectedPayable,
  payAmountForRow,
  applyLocalCombinedSsoPaymentPatch,
  selectableKeySig,
  type ExecutiveSsoRow,
  type OfficeSsoRow,
  type WorkerSsoRow,
} from '@/app/accounting/social-security-payroll/sso-section-utils';
import {
  AccountingFilterToolbarAction,
  AccountingFilterToolbarStat,
} from '@/components/accounting/accounting-filter-toolbar';
import type { BankAccount, User } from '@/lib/types';
import type { Firestore } from 'firebase/firestore';
import {
  recordExecutivePayrollSsoPayment,
  recordOfficePayrollSsoPayment,
  recordWorkerPayrollSsoPayment,
} from '@/lib/services/payroll-sso-payment-service';
import { useToast } from '@/hooks/use-toast';

export type SsoSectionKind = 'worker' | 'office' | 'executive';

type PayDialogState = true | null;

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

  const selectedPayCount = useMemo(
    () => countSelectedPayable(tableRows, selectedKeys),
    [tableRows, selectedKeys],
  );

  const payTargets = useMemo(() => {
    if (!payDialog) return [];
    return tableRows.filter(
      (r) =>
        r.isGroupLeader !== false &&
        selectedKeys.has(r.rowKey) &&
        (r.ssoPayable || r.employerPayable),
    );
  }, [payDialog, tableRows, selectedKeys]);

  const payDialogTotal = useMemo(
    () => payTargets.reduce((sum, r) => sum + payAmountForRow(r), 0),
    [payTargets],
  );

  const openPayDialog = useCallback(() => {
    if (selectedPayCount === 0) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีรายการที่พร้อมจ่าย',
        description: 'ต้องจ่ายค่าจ้างแล้วและยังไม่ได้จ่าย ปกส.+สมทบ ครบ',
      });
      return;
    }
    setPayDialog(true);
    setPayBankId((prev) =>
      prev && operatingBankOptions.some((b) => b.id === prev) ? prev : (operatingBankOptions[0]?.id ?? ''),
    );
    setPayDate(new Date().toISOString().slice(0, 10));
  }, [selectedPayCount, operatingBankOptions, toast]);

  const patchLineAfterPay = useCallback(
    (rowKeys: string[], result: { cashbookEntryId: string; entryNo: string }, bankId: string) => {
      const now = Date.now();
      const keySet = new Set(rowKeys);
      if (sectionKind === 'worker' && onWorkerRowsChange) {
        onWorkerRowsChange((prev) =>
          prev.map((row) => {
            const key = `worker::${row.batch.id}::${row.line.id}`;
            if (!keySet.has(key)) return row;
            return {
              ...row,
              line: applyLocalCombinedSsoPaymentPatch(row.line, result, bankId, now),
            };
          }),
        );
      } else if (sectionKind === 'office' && onOfficeRowsChange) {
        onOfficeRowsChange((prev) =>
          prev.map((row) => {
            const key = `office::${row.run.id}::${row.line.id}`;
            if (!keySet.has(key)) return row;
            return {
              ...row,
              line: applyLocalCombinedSsoPaymentPatch(row.line, result, bankId, now),
            };
          }),
        );
      } else if (sectionKind === 'executive' && onExecutiveRowsChange) {
        onExecutiveRowsChange((prev) =>
          prev.map((row) => {
            const key = `executive::${row.run.id}::${row.line.id}`;
            if (!keySet.has(key)) return row;
            return {
              ...row,
              line: applyLocalCombinedSsoPaymentPatch(row.line, result, bankId, now),
            };
          }),
        );
      }
    },
    [sectionKind, onWorkerRowsChange, onOfficeRowsChange, onExecutiveRowsChange],
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
        if (target.isGroupLeader === false) continue;
        try {
          const memberKeys = target.memberRowKeys?.length ? target.memberRowKeys : [target.rowKey];
          if (sectionKind === 'worker' && workerRows) {
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
          } else if (sectionKind === 'office' && officeRows) {
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
          } else if (sectionKind === 'executive' && executiveRows) {
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
          for (const k of memberKeys) paidKeys.add(k);
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
          title: 'บันทึกจ่าย ปกส.+สมทบ แล้ว',
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
              <div className="flex flex-wrap items-end gap-2 shrink-0">
                {canPay ? (
                  <AccountingFilterToolbarAction>
                    <PayrollSsoPayButton
                      canPay={canPay}
                      selectedCount={selectedPayCount}
                      onPay={openPayDialog}
                    />
                  </AccountingFilterToolbarAction>
                ) : null}
                <AccountingFilterToolbarStat
                  label="ยอด ปกส.+สมทบ รวม"
                  value={totalSsoLabel}
                  emphasize
                />
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
            <DialogTitle>จ่าย ปกส.+สมทบ</DialogTitle>
            <DialogDescription>
              ตัดจ่าย ปกส.+สมทบ รวมยอดเดียว — บันทึก cashbook 1 รายการต่อคน (ลูกจ้าง + สมทบนายจ้าง)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-md border bg-muted/30 p-3 space-y-1">
              <p className="font-medium">รายการที่เลือก {payTargets.length} รายการ</p>
              <p className="text-muted-foreground">
                ยอดรวม{' '}
                <span className="font-semibold text-primary tabular-nums">{fmtSsoBaht(payDialogTotal)}</span>
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
