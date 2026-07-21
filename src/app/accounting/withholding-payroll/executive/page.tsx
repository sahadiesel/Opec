'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, orderBy, query, limit, where } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  fmtBaht,
  mergeUniqueProofAttachments,
  ProofAttachmentZone,
  renderTaxStatusBadge,
  renderWageStatusBadge,
  WHT_LIST_TABLE_COLGROUP,
} from '@/components/accounting/withholding-wht-pay-tax-ui';
import { useFirestore, useCollection, useMemoFirebase, useFirebaseApp } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { useToast } from '@/hooks/use-toast';
import { ExternalLink, Loader2, Search, Briefcase, Printer, Banknote, Paperclip } from 'lucide-react';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import type {
  User,
  OfficePayrollRun,
  OfficePayrollLine,
  BankAccount,
  WhtTaxPaymentProofAttachment,
  OfficeStaff,
  ExecutivePayrollStaff,
} from '@/lib/types';
import { resolveStaffNationalId } from '@/app/accounting/social-security-payroll/sso-section-utils';
import { canView, canExecuteBankCashbookPayments } from '@/lib/permissions';
import { canViewHrPayrollFlowSubsection } from '@/lib/navigation/nav-access';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { usePermissions } from '@/hooks/use-permissions';
import { officePayrollLineTaxAmount, resolveOfficePayrollWhtPaymentDateYmd } from '@/lib/payroll/payroll-office-wht-model';
import {
  isOfficePayrollWagePaid,
  isOfficePayrollWhtTaxPaid,
  officeWageStatusLabel,
  whtTaxStatusLabel,
} from '@/lib/payroll/payroll-wht-tax-payment-model';
import { recordExecutivePayrollWhtTaxPayment, markExecutivePayrollWhtTaxPaidWithoutCashbook } from '@/lib/services/payroll-wht-tax-payment-service';
import { uploadPayrollWhtTaxPaymentProof } from '@/lib/storage/payroll-wht-tax-payment-proofs';
import {
  buildWithholdingExecutivePayrollListPrintHtml,
  capWithholdingPayrollListPrintRows,
  type WithholdingExecutivePayrollListPrintRow,
} from '@/lib/documents/withholding-payroll-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';

type ExecutiveWhtRow = {
  run: OfficePayrollRun;
  line: OfficePayrollLine;
  tax: number;
  paid: number;
  paymentYmd: string;
};

function officePayrollLinePaidAmount(line: OfficePayrollLine): number {
  return Number(line.netPay) || 0;
}

function executiveRowKey(runId: string, lineId: string): string {
  return `${runId}::${lineId}`;
}

function isExecutiveRowPayable(row: ExecutiveWhtRow): boolean {
  return isOfficePayrollWagePaid(row.run, row.line) && !isOfficePayrollWhtTaxPaid(row.line);
}

function executiveRowYm(r: ExecutiveWhtRow): string | null {
  if (r.paymentYmd && /^\d{4}-\d{2}-\d{2}$/.test(r.paymentYmd)) return r.paymentYmd.slice(0, 7);
  const pm = r.run.payrollMonth;
  if (pm && /^\d{4}-\d{2}/.test(String(pm).trim())) return String(pm).trim().slice(0, 7);
  return null;
}

const TH_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

function ymLabelTh(ym: string): string {
  const [y, m] = ym.split('-');
  const mi = Number(m);
  if (!y || !Number.isFinite(mi) || mi < 1 || mi > 12) return ym;
  return `${TH_MONTHS[mi - 1]} ${Number(y) + 543}`;
}

function describeExecutivePrintFilters(searchTerm: string, monthFilter: string): string[] {
  const lines: string[] = [];
  if (monthFilter !== 'ALL') {
    lines.push(`เดือน: ${ymLabelTh(monthFilter)} (${monthFilter})`);
  }
  if (searchTerm.trim()) {
    lines.push(`ค้นหา: "${searchTerm.trim()}"`);
  }
  return lines;
}

function buildExecutivePrintRows(
  rows: ExecutiveWhtRow[],
  nationalIdByStaffId?: ReadonlyMap<string, string>,
): WithholdingExecutivePayrollListPrintRow[] {
  return rows.map(({ run, line, tax, paid, paymentYmd }) => {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    return {
      wageStatus: officeWageStatusLabel(run.status),
      taxStatus: whtTaxStatusLabel(wagePaid, isOfficePayrollWhtTaxPaid(line)),
      runLabel: run.payrollRunNo || run.id,
      payrollMonth: run.payrollMonth || '—',
      earnerName: line.staffName || '—',
      earnerId: resolveStaffNationalId(line.staffId, nationalIdByStaffId),
      paymentDate: formatYmdLocalThaiBE(paymentYmd),
      paidLabel: fmtBaht(paid),
      amountLabel: fmtBaht(tax),
    };
  });
}

export default function AccountingWithholdingPayrollExecutivePage() {
  const { currentUser, isLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { toast } = useToast();
  const payTaxProofInputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [executiveRows, setExecutiveRows] = useState<ExecutiveWhtRow[]>([]);
  const [loadingExecutiveLines, setLoadingExecutiveLines] = useState(false);
  const [executiveLinesErr, setExecutiveLinesErr] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [payTaxOpen, setPayTaxOpen] = useState(false);
  const [payTaxBankId, setPayTaxBankId] = useState('');
  const [payTaxDate, setPayTaxDate] = useState(() => new Date().toISOString().slice(0, 10));
  /** true = บันทึกสถานะจ่ายแล้วเท่านั้น (ไม่ตัดบัญชี / ไม่ลง cashbook) */
  const [payTaxStatusOnly, setPayTaxStatusOnly] = useState(false);
  const [payTaxBusy, setPayTaxBusy] = useState(false);
  const [payTaxAttachments, setPayTaxAttachments] = useState<WhtTaxPaymentProofAttachment[]>([]);
  const [attachProofBusy, setAttachProofBusy] = useState(false);
  const [sessionProofAttachments, setSessionProofAttachments] = useState<WhtTaxPaymentProofAttachment[]>([]);

  const canPayWhtTax = useMemo(() => canExecuteBankCashbookPayments(currentUser), [currentUser]);
  /** บันทึกสถานะจ่ายแล้วโดยไม่ตัดบัญชี — เฉพาะ Admin */
  const canMarkWhtStatusOnly = useMemo(
    () => isSystemAdmin(currentUser) || isSimpleAdmin(currentUser),
    [currentUser],
  );

  const bankAccountsQuery = useMemoFirebase(
    () =>
      firestore && canPayWhtTax
        ? query(collection(firestore, 'bank_accounts'), where('status', '==', 'ACTIVE'))
        : null,
    [firestore, canPayWhtTax],
  );
  const { data: bankAccounts } = useCollection<BankAccount>(bankAccountsQuery as any);
  const operatingBankOptions = useMemo(() => {
    const list = (bankAccounts ?? []).filter((a) => String(a.accountType) !== 'PETTY_CASH');
    list.sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || '', 'th', { numeric: true }));
    return list;
  }, [bankAccounts]);

  const executiveRunsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'executive_payroll_runs'), orderBy('updatedAt', 'desc'), limit(80));
  }, [firestore]);

  const {
    data: executiveRuns,
    isLoading: loadingExecutiveRuns,
    error: executiveRunsErr,
  } = useCollection<OfficePayrollRun>(executiveRunsQuery as any);

  const officeStaffQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'office_staff');
  }, [firestore]);

  const executiveStaffQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'executive_payroll_staff');
  }, [firestore]);

  const { data: officeStaffRegistry } = useCollection<OfficeStaff>(officeStaffQuery as any);
  const { data: executiveStaffRegistry } = useCollection<ExecutivePayrollStaff>(executiveStaffQuery as any);

  const nationalIdByOfficeStaffId = useMemo(() => {
    const map = new Map<string, string>();
    for (const staff of officeStaffRegistry ?? []) {
      const id = staff.nationalId?.trim();
      if (id) map.set(staff.id, id);
    }
    return map;
  }, [officeStaffRegistry]);

  const nationalIdByExecutiveStaffId = useMemo(() => {
    const map = new Map<string, string>();
    for (const staff of executiveStaffRegistry ?? []) {
      let id = staff.nationalId?.trim();
      if (!id && staff.linkedOfficeStaffId) {
        id = nationalIdByOfficeStaffId.get(staff.linkedOfficeStaffId)?.trim();
      }
      if (id) map.set(staff.id, id);
    }
    return map;
  }, [executiveStaffRegistry, nationalIdByOfficeStaffId]);

  useEffect(() => {
    if (!firestore || executiveRuns === undefined) return;
    let cancelled = false;
    setLoadingExecutiveLines(true);
    setExecutiveLinesErr(null);
    void (async () => {
      try {
        const rows: ExecutiveWhtRow[] = [];
        const list = executiveRuns ?? [];
        for (const run of list) {
          if (cancelled) return;
          const snap = await getDocs(collection(firestore, 'executive_payroll_runs', run.id, 'lines'));
          snap.forEach((d) => {
            const line = { id: d.id, ...d.data() } as OfficePayrollLine;
            const tax = officePayrollLineTaxAmount(line);
            if (tax <= 0.005) return;
            const payYmd = resolveOfficePayrollWhtPaymentDateYmd(run);
            rows.push({
              run,
              line,
              tax,
              paid: officePayrollLinePaidAmount(line),
              paymentYmd: payYmd && /^\d{4}-\d{2}-\d{2}$/.test(payYmd) ? payYmd : '—',
            });
          });
        }
        rows.sort((a, b) => (b.run.updatedAt ?? 0) - (a.run.updatedAt ?? 0));
        if (!cancelled) setExecutiveRows(rows);
      } catch (e) {
        if (!cancelled) setExecutiveLinesErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingExecutiveLines(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, executiveRuns]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of executiveRows) {
      const ym = executiveRowYm(r);
      if (ym) set.add(ym);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [executiveRows]);

  const executiveRowsBySearch = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return executiveRows;
    return executiveRows.filter(({ run, line, paymentYmd }) => {
      const name = (line.staffName || '').toLowerCase();
      const rn = (run.payrollRunNo || '').toLowerCase();
      const rid = run.id.toLowerCase();
      const lid = line.id.toLowerCase();
      const sid = line.staffId.toLowerCase();
      const nid = (nationalIdByExecutiveStaffId.get(line.staffId) || '').toLowerCase();
      const ym = (run.payrollMonth || '').toLowerCase();
      return (
        name.includes(t) ||
        rn.includes(t) ||
        rid.includes(t) ||
        lid.includes(t) ||
        sid.includes(t) ||
        nid.includes(t) ||
        ym.includes(t) ||
        paymentYmd.includes(t)
      );
    });
  }, [executiveRows, q, nationalIdByExecutiveStaffId]);

  const filteredExecutive = useMemo(() => {
    if (monthFilter === 'ALL') return executiveRowsBySearch;
    return executiveRowsBySearch.filter((r) => executiveRowYm(r) === monthFilter);
  }, [executiveRowsBySearch, monthFilter]);

  const payableRows = useMemo(() => filteredExecutive.filter(isExecutiveRowPayable), [filteredExecutive]);

  const payableKeySig = useMemo(
    () => payableRows.map((r) => executiveRowKey(r.run.id, r.line.id)).sort().join('|'),
    [payableRows],
  );

  useEffect(() => {
    const keys = payableKeySig ? payableKeySig.split('|') : [];
    setSelectedKeys(new Set(keys));
  }, [payableKeySig]);

  const selectedPayRows = useMemo(
    () => payableRows.filter((r) => selectedKeys.has(executiveRowKey(r.run.id, r.line.id))),
    [payableRows, selectedKeys],
  );

  const selectedTaxTotal = useMemo(
    () => selectedPayRows.reduce((sum, { tax }) => sum + tax, 0),
    [selectedPayRows],
  );

  const displayedProofAttachments = useMemo(() => {
    const fromRows = executiveRows.flatMap((r) => r.line.whtTaxPaymentProofAttachments ?? []);
    return mergeUniqueProofAttachments(fromRows, sessionProofAttachments);
  }, [executiveRows, sessionProofAttachments]);

  const removableProofIds = useMemo(
    () => new Set(sessionProofAttachments.map((a) => a.id)),
    [sessionProofAttachments],
  );

  const executiveTotalTax = useMemo(
    () => filteredExecutive.reduce((sum, { tax }) => sum + tax, 0),
    [filteredExecutive],
  );

  const allExecutiveTotalTax = useMemo(
    () => executiveRows.reduce((sum, { tax }) => sum + tax, 0),
    [executiveRows],
  );

  const runExecutivePrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? filteredExecutive : executiveRows;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามตัวกรอง — ปรับตัวกรองหรือเลือกพิมพ์ทั้งหมด'
              : 'ยังไม่มีรายการหัก ภ.ง.ด.1 / ภ.ง.ด.2 ผู้บริหารในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const printRows = buildExecutivePrintRows(source, nationalIdByExecutiveStaffId);
        const { rows, truncated } = capWithholdingPayrollListPrintRows(printRows);
        const totalTax = source.reduce((sum, { tax }) => sum + tax, 0);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines = scope === 'filtered' ? describeExecutivePrintFilters(q, monthFilter) : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';

        const body = buildWithholdingExecutivePayrollListPrintHtml({
          rows,
          scopeTitle,
          filterLines,
          totalLabel: fmtBaht(totalTax),
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Withholding-Executive-List',
          suggestedFileName: `Withholding-Executive-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!ok) {
          toast({
            variant: 'destructive',
            title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
            description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
          });
          return;
        }
        setPrintDialogOpen(false);
      } finally {
        setPrintBusy(false);
      }
    },
    [
      filteredExecutive,
      executiveRows,
      nationalIdByExecutiveStaffId,
      q,
      monthFilter,
      currentUser?.displayName,
      toast,
    ],
  );

  const openPayTaxDialog = useCallback(() => {
    if (payableRows.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีรายการที่พร้อมจ่ายภาษี',
        description: 'ต้องจ่ายเงินเดือนแล้วและยังไม่ได้จ่ายภาษีหัก ณ ที่จ่าย',
      });
      return;
    }
    setSelectedKeys((prev) => {
      const payableIds = new Set(payableRows.map((r) => executiveRowKey(r.run.id, r.line.id)));
      const kept = [...prev].filter((id) => payableIds.has(id));
      return kept.length > 0 ? new Set(kept) : new Set(payableIds);
    });
    setPayTaxOpen(true);
    setPayTaxStatusOnly(false);
    setPayTaxBankId((prev) =>
      prev && operatingBankOptions.some((b) => b.id === prev) ? prev : (operatingBankOptions[0]?.id ?? ''),
    );
    setPayTaxDate(new Date().toISOString().slice(0, 10));
    setPayTaxAttachments([...sessionProofAttachments]);
  }, [payableRows, operatingBankOptions, sessionProofAttachments, toast]);

  const handleAttachPayTaxProof = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || !firebaseApp || !currentUser) return;
      setAttachProofBusy(true);
      try {
        const uploaded: WhtTaxPaymentProofAttachment[] = [];
        for (const file of Array.from(files)) {
          const attachment = await uploadPayrollWhtTaxPaymentProof(
            firebaseApp,
            'executive',
            currentUser.id,
            file,
            currentUser.displayName || currentUser.email || currentUser.id,
          );
          uploaded.push(attachment);
        }
        setPayTaxAttachments((prev) => {
          const next = [...prev];
          for (const a of uploaded) {
            if (!next.some((x) => x.id === a.id)) next.push(a);
          }
          setSessionProofAttachments(next);
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
        if (payTaxProofInputRef.current) payTaxProofInputRef.current.value = '';
      }
    },
    [firebaseApp, currentUser, toast],
  );

  const handleRemovePayTaxProof = useCallback((attachmentId: string) => {
    setPayTaxAttachments((prev) => {
      const next = prev.filter((a) => a.id !== attachmentId);
      setSessionProofAttachments(next);
      return next;
    });
  }, []);

  const handleRemoveSectionProof = useCallback(
    (attachmentId: string) => {
      setSessionProofAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      setPayTaxAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    },
    [],
  );

  const handleConfirmPayWhtTax = useCallback(async () => {
    if (!firestore || !currentUser) return;
    if (selectedPayRows.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้เลือกรายการ',
        description: 'ติ๊กเลือกคนที่ต้องการจ่ายภาษีอย่างน้อย 1 รายการ',
      });
      return;
    }

    if (payTaxStatusOnly) {
      if (!canMarkWhtStatusOnly) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีสิทธิ์',
          description: 'บันทึกสถานะจ่ายภาษีโดยไม่ตัดบัญชีได้เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น',
        });
        return;
      }
    } else {
      if (!payTaxBankId.trim()) {
        toast({ variant: 'destructive', title: 'กรุณาเลือกบัญชีธนาคาร' });
        return;
      }
      if (payTaxAttachments.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ยังไม่ได้แนบเอกสาร',
          description: 'กรุณาแนบหลักฐานการโอนก่อนยืนยันจ่ายภาษี',
        });
        return;
      }
    }

    setPayTaxBusy(true);
    let success = 0;
    const errors: string[] = [];
    const paidKeys = new Set<string>();
    const lineUpdates = new Map<string, Partial<OfficePayrollLine>>();

    try {
      for (const row of selectedPayRows) {
        try {
          const { run, line, tax } = row;
          const key = executiveRowKey(run.id, line.id);
          const now = Date.now();
          if (payTaxStatusOnly) {
            await markExecutivePayrollWhtTaxPaidWithoutCashbook(firestore, currentUser as User, {
              run,
              line,
            });
            paidKeys.add(key);
            lineUpdates.set(key, {
              whtTaxPaidAt: now,
              whtTaxPaidWithoutCashbook: true,
              whtTaxPaidByUid: currentUser.id,
              whtTaxPaidByName: currentUser.displayName || currentUser.email || currentUser.id,
            });
          } else {
            const result = await recordExecutivePayrollWhtTaxPayment(firestore, currentUser as User, {
              run,
              line,
              taxAmount: tax,
              bankAccountId: payTaxBankId,
              entryDate: payTaxDate,
              earnerName: line.staffName || line.staffId,
              proofAttachments: payTaxAttachments,
            });
            paidKeys.add(key);
            lineUpdates.set(key, {
              whtTaxCashbookEntryId: result.cashbookEntryId,
              whtTaxCashbookEntryNo: result.entryNo,
              whtTaxPaidAt: now,
              whtTaxPaymentBankAccountId: payTaxBankId,
              whtTaxPaymentProofAttachments: mergeUniqueProofAttachments(
                line.whtTaxPaymentProofAttachments ?? [],
                payTaxAttachments,
              ),
            });
          }
          success += 1;
        } catch (e) {
          const name = row.line.staffName || row.line.staffId;
          errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (paidKeys.size > 0) {
        setExecutiveRows((prev) =>
          prev.map((row) => {
            const key = executiveRowKey(row.run.id, row.line.id);
            const patch = lineUpdates.get(key);
            if (!patch) return row;
            return { ...row, line: { ...row.line, ...patch } };
          }),
        );
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          for (const key of paidKeys) next.delete(key);
          return next;
        });
      }

      if (errors.length === 0) {
        toast({
          title: payTaxStatusOnly ? 'บันทึกสถานะจ่ายภาษีแล้ว' : 'บันทึกจ่ายภาษีหัก ณ ที่จ่ายแล้ว',
          description: payTaxStatusOnly
            ? `อัปเดตสถานะ ${success} รายการ · ไม่ตัดบัญชีและไม่ลง cashbook`
            : `จ่ายสำเร็จ ${success} รายการ · ตัดบัญชีและบันทึก cashbook เรียบร้อย`,
        });
        if (!payTaxStatusOnly) {
          setSessionProofAttachments([]);
          setPayTaxAttachments([]);
        }
        setPayTaxOpen(false);
        setPayTaxStatusOnly(false);
      } else if (success > 0) {
        toast({
          variant: 'destructive',
          title: `จ่ายสำเร็จ ${success} รายการ · ล้มเหลว ${errors.length} รายการ`,
          description: errors.slice(0, 3).join(' · '),
        });
      } else {
        toast({
          variant: 'destructive',
          title: payTaxStatusOnly ? 'บันทึกสถานะไม่สำเร็จ' : 'จ่ายภาษีไม่สำเร็จ',
          description: errors.slice(0, 3).join(' · '),
        });
      }
    } finally {
      setPayTaxBusy(false);
    }
  }, [
    firestore,
    currentUser,
    payTaxBankId,
    payTaxDate,
    payTaxStatusOnly,
    canMarkWhtStatusOnly,
    selectedPayRows,
    payTaxAttachments,
    toast,
  ]);

  if (isLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const user = currentUser as User;
  const admin = isSystemAdmin(user) || isSimpleAdmin(user);
  const canOpenExecutiveWht =
    canView(user, 'executive_payroll', profile) || canViewHrPayrollFlowSubsection(user, profile, admin);
  if (!canOpenExecutiveWht) {
    return (
      <AppShell user={user} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าถึงเอกสารหัก ณ ที่จ่ายผู้บริหาร
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="w-full max-w-[min(100%,96rem)] mx-auto space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Briefcase className="h-7 w-7 shrink-0 text-primary" />
            2. เอกสาร หัก ณ ที่จ่าย (ผู้บริหาร)
          </h1>
          <p className="text-muted-foreground mt-1">
            รายการหนังสือรับรองหัก ณ ที่จ่าย ภ.ง.ด.1 (เงินเดือน/เบี้ยประชุม) และ ภ.ง.ด.2 (เงินปันผล) ของผู้บริหาร
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ค้นหาและกรองเดือน</CardTitle>
            <CardDescription className="sr-only">
              ชื่อผู้มีเงินได้ เลขที่งวดผู้บริหาร รหัสบรรทัด หรือวันที่จ่าย — กรองเดือนใช้เดือนอ้างอิง (วันที่จ่าย หรืองวดเงินเดือน)
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[14rem] sm:max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-10 pl-9"
                    placeholder="พิมพ์คำค้น..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    aria-label="ค้นหารายการหัก ณ ที่จ่ายผู้บริหาร"
                  />
                </div>
                <Select value={monthFilter} onValueChange={setMonthFilter}>
                  <SelectTrigger
                    id="wht-exec-month-filter"
                    className="h-10 w-[min(100%,13rem)] shrink-0 bg-background"
                    aria-label="กรองตามเดือน"
                  >
                    <SelectValue placeholder="เลือกเดือน" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกเดือน</SelectItem>
                    {monthOptions.map((ym) => (
                      <SelectItem key={ym} value={ym}>
                        {ymLabelTh(ym)} ({ym})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-end gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-2 whitespace-nowrap"
                  disabled={
                    printBusy ||
                    loadingExecutiveRuns ||
                    loadingExecutiveLines ||
                    executiveRows.length === 0
                  }
                  onClick={() => setPrintDialogOpen(true)}
                >
                  <Printer className="h-4 w-4 shrink-0" />
                  พิมพ์รายการ
                </Button>
                {!loadingExecutiveRuns && !loadingExecutiveLines && !executiveLinesErr ? (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="text-xs font-medium text-muted-foreground whitespace-nowrap">ยอดหักรวม (ในตาราง)</p>
                    <div className="flex h-10 min-w-[11rem] items-center justify-end rounded-md border border-primary/30 bg-primary/5 px-4">
                      <p className="text-lg font-bold tabular-nums tracking-tight text-primary">{fmtBaht(executiveTotalTax)}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการหัก ณ ที่จ่าย (ผู้บริหาร)</DialogTitle>
              <DialogDescription>งวดเงินเดือนผู้บริหาร — สูงสุด 500 รายการต่อครั้ง</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {describeExecutivePrintFilters(q, monthFilter).length > 0 ? (
                    describeExecutivePrintFilters(q, monthFilter).map((line) => (
                      <li key={line}>{line}</li>
                    ))
                  ) : (
                    <li>ทุกเดือน — ไม่มีคำค้น</li>
                  )}
                </ul>
                <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredExecutive.length} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">
                ข้อมูลทั้งหมดในระบบ: {executiveRows.length} รายการ · รวม {fmtBaht(allExecutiveTotalTax)}
              </p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filteredExecutive.length === 0}
                onClick={() => void runExecutivePrint('filtered')}
              >
                {printBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
                พิมพ์ตามตัวกรอง ({filteredExecutive.length})
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={printBusy || executiveRows.length === 0}
                onClick={() => void runExecutivePrint('all')}
              >
                {printBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
                พิมพ์ทั้งหมด ({executiveRows.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {executiveRunsErr ? (
          <p className="text-sm text-destructive">
            โหลดหัวงวดผู้บริหารไม่สำเร็จ — {String((executiveRunsErr as Error)?.message || executiveRunsErr)}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Briefcase className="h-5 w-5 shrink-0 text-muted-foreground" />
                  ผู้บริหาร / Executive payroll
                </CardTitle>
                <CardDescription>
                  แสดงเฉพาะบรรทัดที่มียอดภาษีหักในงวดเงินเดือนผู้บริหาร — เปิดเพื่อพิมพ์ใบหัก
                </CardDescription>
              </div>
              {!loadingExecutiveRuns && !loadingExecutiveLines && !executiveLinesErr ? (
                <div className="flex flex-wrap items-end gap-2 shrink-0">
                  {canPayWhtTax && payableRows.length > 0 ? (
                    <Button
                      type="button"
                      className="h-10 bg-emerald-600 hover:bg-emerald-700 text-white gap-2 px-4 whitespace-nowrap"
                      onClick={openPayTaxDialog}
                    >
                      <Banknote className="h-4 w-4 shrink-0" />
                      จ่ายภาษี ({selectedPayRows.length})
                    </Button>
                  ) : null}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="text-xs font-medium text-muted-foreground whitespace-nowrap">ยอดหักรวม (ในตาราง)</p>
                    <div className="flex h-10 items-center justify-end rounded-md border border-primary/25 bg-primary/5 px-4 shadow-sm sm:min-w-[180px]">
                      <p className="text-lg font-bold tabular-nums tracking-tight text-primary">{fmtBaht(executiveTotalTax)}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <ProofAttachmentZone
              attachments={displayedProofAttachments}
              onRemove={canPayWhtTax ? handleRemoveSectionProof : undefined}
              removableIds={canPayWhtTax ? removableProofIds : undefined}
            />
            {executiveLinesErr ? (
              <p className="text-sm text-destructive">{executiveLinesErr}</p>
            ) : loadingExecutiveRuns || loadingExecutiveLines ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredExecutive.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {executiveRows.length === 0
                  ? 'ยังไม่มีบรรทัดที่มียอดหักภาษีในงวดผู้บริหารล่าสุด'
                  : 'ไม่พบรายการที่ตรงกับคำค้นหรือเดือนที่เลือก'}
              </p>
            ) : (
              <div className="rounded-md border">
                <Table className="table-fixed w-full">
                  {WHT_LIST_TABLE_COLGROUP(canPayWhtTax)}
                  <TableHeader>
                    <TableRow>
                      {canPayWhtTax ? (
                        <TableHead className="w-11 pl-3">
                          <Checkbox
                            checked={
                              payableRows.length > 0 &&
                              payableRows.every((r) => selectedKeys.has(executiveRowKey(r.run.id, r.line.id)))
                            }
                            onCheckedChange={(v) => {
                              if (v === true) {
                                setSelectedKeys(
                                  new Set(payableRows.map((r) => executiveRowKey(r.run.id, r.line.id))),
                                );
                              } else {
                                setSelectedKeys(new Set());
                              }
                            }}
                            aria-label="เลือกทั้งหมดที่พร้อมจ่ายภาษี"
                          />
                        </TableHead>
                      ) : null}
                      <TableHead>งวด</TableHead>
                      <TableHead>ผู้มีเงินได้</TableHead>
                      <TableHead>วันที่จ่าย</TableHead>
                      <TableHead className="text-right">ยอดจ่าย</TableHead>
                      <TableHead>สถานะจ่ายเงินเดือน</TableHead>
                      <TableHead className="text-right">ยอดหัก</TableHead>
                      <TableHead>สถานะจ่ายภาษี</TableHead>
                      <TableHead className="text-right pr-3"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredExecutive.map(({ run, line, tax, paid, paymentYmd }) => {
                      const wagePaid = isOfficePayrollWagePaid(run, line);
                      const taxPaid = isOfficePayrollWhtTaxPaid(line);
                      const wageLabel = officeWageStatusLabel(run.status);
                      const rowKey = executiveRowKey(run.id, line.id);
                      const payable = isExecutiveRowPayable({ run, line, tax, paid, paymentYmd });
                      return (
                        <TableRow key={rowKey}>
                          {canPayWhtTax ? (
                            <TableCell className="w-11 pl-3 align-middle">
                              {taxPaid ? (
                                <span className="text-muted-foreground text-xs" title="จ่ายภาษีแล้ว">
                                  ✓
                                </span>
                              ) : payable ? (
                                <Checkbox
                                  checked={selectedKeys.has(rowKey)}
                                  onCheckedChange={(v) => {
                                    const on = v === true;
                                    setSelectedKeys((prev) => {
                                      const next = new Set(prev);
                                      if (on) next.add(rowKey);
                                      else next.delete(rowKey);
                                      return next;
                                    });
                                  }}
                                  aria-label={`เลือก ${line.staffName || line.staffId}`}
                                />
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                          ) : null}
                          <TableCell className="text-xs">
                            <div className="font-mono truncate" title={run.payrollRunNo || run.id}>
                              {run.payrollRunNo || run.id}
                            </div>
                            <div className="truncate text-muted-foreground">{run.payrollMonth || '—'}</div>
                          </TableCell>
                          <TableCell className="max-w-0">
                            <div className="truncate font-medium" title={line.staffName || '—'}>
                              {line.staffName || '—'}
                            </div>
                            <div
                              className="truncate text-xs text-muted-foreground font-mono"
                              title={resolveStaffNationalId(line.staffId, nationalIdByExecutiveStaffId)}
                            >
                              {resolveStaffNationalId(line.staffId, nationalIdByExecutiveStaffId)}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatYmdLocalThaiBE(paymentYmd)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmtBaht(paid)}</TableCell>
                          <TableCell>{renderWageStatusBadge(wageLabel, wagePaid)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-primary">
                            {fmtBaht(tax)}
                          </TableCell>
                          <TableCell>{renderTaxStatusBadge(wagePaid, taxPaid)}</TableCell>
                          <TableCell className="text-right pr-3">
                            <Link
                              href={`/accounting/withholding-payroll/executive/${encodeURIComponent(run.id)}/${encodeURIComponent(line.id)}`}
                              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                              เปิด
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={payTaxOpen}
          onOpenChange={(open) => {
            if (!open && !payTaxBusy) {
              setPayTaxOpen(false);
              setPayTaxStatusOnly(false);
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>จ่ายภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1 / ภ.ง.ด.2) — ผู้บริหาร</DialogTitle>
              <DialogDescription>
                {payTaxStatusOnly
                  ? 'บันทึกสถานะ «จ่ายแล้ว» เท่านั้น — ไม่ตัดบัญชีธนาคารและไม่ลง cashbook'
                  : 'เลือกบัญชีธนาคารสำหรับตัดจ่ายภาษี — ระบบจะบันทึกรายการ cashbook แยกตามรายการที่เลือก'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-medium">รายการที่เลือก {selectedPayRows.length} รายการ</p>
                <p className="text-muted-foreground">
                  ยอดภาษีหัก ณ ที่จ่ายรวม{' '}
                  <span className="font-semibold text-primary tabular-nums">{fmtBaht(selectedTaxTotal)}</span>
                </p>
              </div>
              {canMarkWhtStatusOnly ? (
                <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/30 cursor-pointer">
                  <Checkbox
                    checked={payTaxStatusOnly}
                    onCheckedChange={(v) => setPayTaxStatusOnly(v === true)}
                    disabled={payTaxBusy}
                    className="mt-0.5"
                  />
                  <span className="space-y-0.5">
                    <span className="block font-medium text-amber-950 dark:text-amber-100">
                      บันทึกสถานะอย่างเดียว (ไม่ตัดบัญชี)
                    </span>
                    <span className="block text-[11px] text-amber-900/80 dark:text-amber-200/80 leading-snug">
                      ใช้เมื่อจ่ายภาษีไปแล้วช่วงระบบยังไม่สมบูรณ์ — อัปเดตเป็น «จ่ายแล้ว» โดยไม่ลง cashbook
                      · เฉพาะ Admin · มีบันทึกใน audit log
                    </span>
                  </span>
                </label>
              ) : null}
              {!payTaxStatusOnly ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="wht-exec-pay-bank">บัญชีธนาคารที่ตัดจ่าย</Label>
                    <Select value={payTaxBankId} onValueChange={setPayTaxBankId}>
                      <SelectTrigger id="wht-exec-pay-bank">
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
                    <Label htmlFor="wht-exec-pay-date">วันที่ตัดบัญชี</Label>
                    <Input
                      id="wht-exec-pay-date"
                      type="date"
                      value={payTaxDate}
                      onChange={(e) => setPayTaxDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>เอกสารการโอน (บังคับแนบ)</Label>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      แนบสลิปหรือหลักฐานการโอนภาษีหัก ณ ที่จ่าย — รองรับ PDF หรือรูปภาพ (สูงสุด 10 MB ต่อไฟล์)
                    </p>
                    <input
                      ref={payTaxProofInputRef}
                      type="file"
                      multiple
                      accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
                      className="hidden"
                      onChange={(e) => void handleAttachPayTaxProof(e.target.files)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      disabled={attachProofBusy || payTaxBusy}
                      onClick={() => payTaxProofInputRef.current?.click()}
                    >
                      {attachProofBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                      แนบเอกสาร
                    </Button>
                    {payTaxAttachments.length > 0 ? (
                      <ul className="rounded-md border bg-muted/20 px-3 py-2 space-y-1.5">
                        {payTaxAttachments.map((a) => (
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
                              disabled={attachProofBusy || payTaxBusy}
                              onClick={() => handleRemovePayTaxProof(a.id)}
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
                </>
              ) : null}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                disabled={payTaxBusy}
                onClick={() => {
                  setPayTaxOpen(false);
                  setPayTaxStatusOnly(false);
                }}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={
                  payTaxBusy ||
                  attachProofBusy ||
                  selectedPayRows.length === 0 ||
                  (!payTaxStatusOnly && (!payTaxBankId || payTaxAttachments.length === 0))
                }
                onClick={() => void handleConfirmPayWhtTax()}
              >
                {payTaxBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {payTaxStatusOnly
                  ? `บันทึกสถานะจ่ายแล้ว (${selectedPayRows.length})`
                  : `ยืนยันจ่ายภาษี (${selectedPayRows.length})`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
