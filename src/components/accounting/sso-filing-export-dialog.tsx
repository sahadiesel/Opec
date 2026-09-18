'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { NameTitleSelect } from '@/components/hr/name-title-select';
import { useToast } from '@/hooks/use-toast';
import type { Firestore } from 'firebase/firestore';
import { downloadSsoFilingWorkbook } from '@/lib/payroll/sso-filing-excel';
import {
  persistSsoFilingNames,
  ssoFilingMonthTitle,
  ssoFilingRowMissingName,
  type SsoFilingPersonRow,
  type SsoNameTitle,
} from '@/lib/payroll/sso-filing-name';

export function SsoFilingExportDialog({
  open,
  onOpenChange,
  firestore,
  yearCe,
  monthMm,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firestore: Firestore | null;
  yearCe: number;
  monthMm: string;
  rows: SsoFilingPersonRow[];
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<SsoFilingPersonRow[]>(rows);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setDraft(rows);
  }, [open, rows]);

  const patch = (key: string, next: Partial<SsoFilingPersonRow>) => {
    setDraft((cur) => cur.map((row) => (row.key === key ? { ...row, ...next } : row)));
  };

  const handleExport = async () => {
    if (!firestore) return;
    const missing = draft.filter(ssoFilingRowMissingName);
    if (missing.length > 0) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลชื่อไม่ครบ',
        description: `ยังขาดคำนำหน้า ชื่อ นามสกุล หรือเลขบัตร ${missing.length} คน — แก้ในตารางก่อนส่งออก`,
      });
      return;
    }
    setBusy(true);
    try {
      await persistSsoFilingNames(firestore, draft);
      downloadSsoFilingWorkbook({ yearCe, monthMm, rows: draft });
      toast({
        title: 'ส่งออกไฟล์แล้ว',
        description: 'จำคำนำหน้า ชื่อ และนามสกุลไว้ในทะเบียนแล้ว',
      });
      onOpenChange(false);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ส่งออกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const title = ssoFilingMonthTitle(yearCe, monthMm);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Export to XLSX</DialogTitle>
          <DialogDescription>
            {title} — แก้คำนำหน้า ชื่อ นามสกุลให้ตรงบัตรประชาชนก่อนส่งออก ระบบจะจำค่านี้ไว้ในทะเบียน
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr className="text-left">
                <th className="px-2 py-2 w-10">#</th>
                <th className="px-2 py-2">เลขบัตรประชาชน</th>
                <th className="px-2 py-2 w-36">คำนำหน้า</th>
                <th className="px-2 py-2">ชื่อ</th>
                <th className="px-2 py-2">สกุล</th>
                <th className="px-2 py-2 text-right">ค่าจ้าง</th>
                <th className="px-2 py-2 text-right">สมทบ 5%</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((row, index) => {
                const missing = ssoFilingRowMissingName(row);
                return (
                  <tr key={row.key} className={missing ? 'bg-amber-50/80' : undefined}>
                    <td className="px-2 py-1.5 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{row.nationalId || '—'}</td>
                    <td className="px-2 py-1.5">
                      <NameTitleSelect
                        className="h-8"
                        value={row.nameTitle}
                        onChange={(nameTitle: SsoNameTitle | '') => patch(row.key, { nameTitle })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8"
                        value={row.firstName}
                        onChange={(e) => patch(row.key, { firstName: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8"
                        value={row.lastName}
                        onChange={(e) => patch(row.key, { lastName: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.wage.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.contrib.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button type="button" disabled={busy || draft.length === 0} onClick={() => void handleExport()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Export to XLSX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
