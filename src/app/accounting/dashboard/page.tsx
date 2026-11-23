'use client';

import { useMemo, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  Coins, 
  Receipt, 
  FileBadge, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Wallet, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  History, 
  ChevronRight, 
  ArrowRight,
  ShieldAlert,
  Info,
  Calendar,
  Calculator,
  Building2,
  FileText
} from 'lucide-react';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import { 
  User, 
  CommercialInvoice,
  TaxInvoice, 
  AccountsReceivable, 
  AccountsPayable, 
  PayrollRun, 
  BankAccount,
  PurchaseVendorBill,
  Purchase,
  RentalPayable,
  OfficePayrollRun,
  OfficePayrollLine,
  PayrollBatch,
  PayrollBatchLine,
  PayrollPeriod,
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, documentId, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { reconcileAllStaleArEntries } from '@/lib/services/reconcile-stale-ar-from-receipts';
import { resolveArEffectiveStatus } from '@/lib/accounts-receivable/ar-effective-status';
import {
  buildSupersededCommercialInvoiceIds,
  filterSupersededCommercialArEntries,
} from '@/lib/accounts-receivable/ar-list-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';
import { canSeeAccountingPillarUi, canViewBankAccountSensitiveDetails } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { useAppUser } from '@/hooks/use-app-user';
import { YearMonthScopeSelects } from '@/components/accounting/year-month-scope-selects';
import {
  buildYearCeOptions,
  currentMonthMm,
  currentYearCe,
  resolveYearMonthScopeSet,
  ymMatchesYearMonthScope,
} from '@/lib/date/year-month-scope-filter';
import { computeDashboardMonitorTotals } from '@/lib/accounting/dashboard-monitor-totals';
import {
  cancelledVendorBillApKeys,
  isApFromCancelledVendorBill,
} from '@/lib/accounts-payable/cancelled-vendor-bill-ap';
import { cashOnHandExcludingOd } from '@/lib/bank-account-od';

export default function AccountingDashboardPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const staleArReconcileRan = useRef(false);
  const [yearFilterCe, setYearFilterCe] = useState(() => currentYearCe());
  const [monthScope, setMonthScope] = useState(() => currentMonthMm());

  const isAccountingAuthorized = useMemo(() => {
    return isSystemAdmin(currentUser) || canSeeAccountingPillarUi(currentUser, null);
  }, [currentUser]);

  // --- Financial Data Queries ---
  
  const commercialDraftQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return query(
      collection(firestore, 'commercial_invoices'),
      where('status', 'in', ['DRAFT', 'PENDING_CUSTOMER']),
      limit(30),
    );
  }, [firestore, isAccountingAuthorized]);
  const { data: commercialDrafts } = useCollection<CommercialInvoice>(commercialDraftQuery as any);

  const invQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return query(collection(firestore, 'tax_invoices'), where('status', '==', 'DRAFT'), limit(20));
  }, [firestore, isAccountingAuthorized]);
  const { data: draftInvoices } = useCollection<TaxInvoice>(invQuery as any);

  const arQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return query(collection(firestore, 'accounts_receivable'), where('status', 'in', ['OPEN', 'PARTIALLY_PAID', 'OVERDUE']));
  }, [firestore, isAccountingAuthorized]);
  const { data: arItems } = useCollection<AccountsReceivable>(arQuery as any);

  const issuedTaxForArQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return query(collection(firestore, 'tax_invoices'), where('status', '==', 'ISSUED'), limit(200));
  }, [firestore, isAccountingAuthorized]);
  const { data: issuedTaxForAr } = useCollection<TaxInvoice>(issuedTaxForArQuery as any);

  const visibleArItems = useMemo(() => {
    const superseded = buildSupersededCommercialInvoiceIds({ taxInvoices: issuedTaxForAr ?? undefined });
    return filterSupersededCommercialArEntries(arItems ?? [], superseded);
  }, [arItems, issuedTaxForAr]);

  const apQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return query(collection(firestore, 'accounts_payable'), where('status', 'in', ['OPEN', 'PARTIALLY_PAID', 'OVERDUE']));
  }, [firestore, isAccountingAuthorized]);
  const { data: apItems } = useCollection<AccountsPayable>(apQuery as any);

  const prQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return query(collection(firestore, 'payroll_runs'), where('status', '==', 'HR_APPROVED'), limit(10));
  }, [firestore, isAccountingAuthorized]);
  const { data: pendingPayroll } = useCollection<PayrollRun>(prQuery as any);

  const yearOptionsCe = useMemo(() => {
    const keys: string[] = [];
    for (const item of commercialDrafts ?? []) keys.push(String(item.issueDate || '').slice(0, 7));
    for (const item of draftInvoices ?? []) keys.push(String(item.issueDate || '').slice(0, 7));
    for (const item of visibleArItems) keys.push(String(item.issueDate || '').slice(0, 7));
    for (const item of apItems ?? []) keys.push(String(item.billDate || '').slice(0, 7));
    for (const item of pendingPayroll ?? []) keys.push(String(item.payrollPeriodStart || '').slice(0, 7));
    return buildYearCeOptions(keys);
  }, [commercialDrafts, draftInvoices, visibleArItems, apItems, pendingPayroll]);

  const scopedCommercialDrafts = useMemo(
    () =>
      (commercialDrafts ?? []).filter((item) =>
        ymMatchesYearMonthScope(String(item.issueDate || '').slice(0, 7), yearFilterCe, monthScope),
      ),
    [commercialDrafts, yearFilterCe, monthScope],
  );
  const scopedDraftInvoices = useMemo(
    () =>
      (draftInvoices ?? []).filter((item) =>
        ymMatchesYearMonthScope(String(item.issueDate || '').slice(0, 7), yearFilterCe, monthScope),
      ),
    [draftInvoices, yearFilterCe, monthScope],
  );
  const scopedArItems = useMemo(
    () =>
      visibleArItems.filter((item) =>
        ymMatchesYearMonthScope(String(item.issueDate || '').slice(0, 7), yearFilterCe, monthScope),
      ),
    [visibleArItems, yearFilterCe, monthScope],
  );
  const scopedApItems = useMemo(
    () =>
      (apItems ?? []).filter((item) =>
        ymMatchesYearMonthScope(String(item.billDate || '').slice(0, 7), yearFilterCe, monthScope),
      ),
    [apItems, yearFilterCe, monthScope],
  );
  const scopedPayroll = useMemo(
    () =>
      (pendingPayroll ?? []).filter((item) =>
        ymMatchesYearMonthScope(String(item.payrollPeriodStart || '').slice(0, 7), yearFilterCe, monthScope),
      ),
    [pendingPayroll, yearFilterCe, monthScope],
  );

  const canViewBankBalances = useMemo(
    () => canViewBankAccountSensitiveDetails(currentUser),
    [currentUser],
  );

  const bankQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized || !canViewBankBalances) return null;
    return collection(firestore, 'bank_accounts');
  }, [firestore, isAccountingAuthorized, canViewBankBalances]);
  const { data: bankAccounts } = useCollection<BankAccount>(bankQuery as any);

  const issuedSalesQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return query(collection(firestore, 'tax_invoices'), where('status', '==', 'ISSUED'), limit(400));
  }, [firestore, isAccountingAuthorized]);
  const { data: issuedSalesInvoices, isLoading: issuedSalesLoading } = useCollection<TaxInvoice>(issuedSalesQuery as any);

  const vendorBillsQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return query(collection(firestore, 'purchase_vendor_bills'), orderBy('createdAt', 'desc'));
  }, [firestore, isAccountingAuthorized]);
  const { data: vendorBills, isLoading: vendorBillsLoading } = useCollection<PurchaseVendorBill>(vendorBillsQuery as any);
  const cancelledApKeys = useMemo(() => cancelledVendorBillApKeys(vendorBills ?? []), [vendorBills]);
  const openScopedApItems = useMemo(
    () => scopedApItems.filter((item) => !isApFromCancelledVendorBill(item, cancelledApKeys)),
    [scopedApItems, cancelledApKeys],
  );

  const rentalPayablesQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return collection(firestore, 'rental_payables');
  }, [firestore, isAccountingAuthorized]);
  const { data: rentalPayables, isLoading: rentalPayablesLoading } = useCollection<RentalPayable>(rentalPayablesQuery as any);

  const [purchaseById, setPurchaseById] = useState<Record<string, Purchase>>({});
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const purchaseIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const bill of vendorBills ?? []) {
      if (bill.cancellationSettlement || bill.status === 'DRAFT' || bill.status === 'CANCELLED') continue;
      if (bill.purchaseId) ids.add(bill.purchaseId);
    }
    return [...ids].sort().join('|');
  }, [vendorBills]);

  useEffect(() => {
    if (!firestore || !purchaseIdsKey) {
      setPurchaseById({});
      setPurchasesLoading(false);
      return;
    }
    const ids = purchaseIdsKey.split('|');
    let cancelled = false;
    setPurchasesLoading(true);
    void (async () => {
      const found: Record<string, Purchase> = {};
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        const snap = await getDocs(query(collection(firestore, 'purchases'), where(documentId(), 'in', chunk)));
        snap.forEach((row) => {
          found[row.id] = { id: row.id, ...(row.data() as Purchase) };
        });
      }
      if (!cancelled) setPurchaseById(found);
    })()
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!cancelled) setPurchasesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [firestore, purchaseIdsKey]);

  const [officePayrollLines, setOfficePayrollLines] = useState<
    { run: OfficePayrollRun; line: OfficePayrollLine; kind?: 'office' | 'executive' }[]
  >([]);
  const [workerPayrollLines, setWorkerPayrollLines] = useState<{ batch: PayrollBatch; line: PayrollBatchLine }[]>([]);
  const [payrollMonitorLoading, setPayrollMonitorLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !isAccountingAuthorized) {
      setPayrollMonitorLoading(false);
      return;
    }
    const months = [...resolveYearMonthScopeSet(yearFilterCe, monthScope)];
    let cancelled = false;
    setPayrollMonitorLoading(true);
    void (async () => {
      const periodSnap = await getDocs(collection(firestore, 'payroll_periods'));
      const periodIds = periodSnap.docs
        .filter((row) => {
          const period = row.data() as PayrollPeriod;
          const ym = String(period.endDate || period.startDate || '').slice(0, 7);
          return months.includes(ym);
        })
        .map((row) => row.id);

      const batches: PayrollBatch[] = [];
      for (let i = 0; i < periodIds.length; i += 10) {
        const chunk = periodIds.slice(i, i + 10);
        const snap = await getDocs(
          query(collection(firestore, 'payroll_batches'), where('payrollPeriodId', 'in', chunk)),
        );
        snap.forEach((row) => {
          batches.push({ id: row.id, ...(row.data() as PayrollBatch) });
        });
      }

      const workerLines: { batch: PayrollBatch; line: PayrollBatchLine }[] = [];
      await Promise.all(
        batches.map(async (batch) => {
          const snap = await getDocs(collection(firestore, 'payroll_batches', batch.id, 'lines'));
          snap.forEach((row) => {
            workerLines.push({ batch, line: { id: row.id, ...(row.data() as PayrollBatchLine) } });
          });
        }),
      );

      const loadPayrollRunLines = async (collectionName: 'office_payroll_runs' | 'executive_payroll_runs', kind: 'office' | 'executive') => {
        const runs: OfficePayrollRun[] = [];
        for (let i = 0; i < months.length; i += 10) {
          const chunk = months.slice(i, i + 10);
          const snap = await getDocs(
            query(collection(firestore, collectionName), where('payrollMonth', 'in', chunk)),
          );
          snap.forEach((row) => {
            runs.push({ id: row.id, ...(row.data() as OfficePayrollRun) });
          });
        }
        const lines: { run: OfficePayrollRun; line: OfficePayrollLine; kind: 'office' | 'executive' }[] = [];
        await Promise.all(
          runs.map(async (run) => {
            const snap = await getDocs(collection(firestore, collectionName, run.id, 'lines'));
            snap.forEach((row) => {
              lines.push({ run, kind, line: { id: row.id, ...(row.data() as OfficePayrollLine) } });
            });
          }),
        );
        return lines;
      };
      const [officeOnlyLines, executiveLines] = await Promise.all([
        loadPayrollRunLines('office_payroll_runs', 'office'),
        loadPayrollRunLines('executive_payroll_runs', 'executive'),
      ]);
      const officeLines = [...officeOnlyLines, ...executiveLines];

      if (!cancelled) {
        setWorkerPayrollLines(workerLines);
        setOfficePayrollLines(officeLines);
      }
    })()
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!cancelled) setPayrollMonitorLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [firestore, isAccountingAuthorized, yearFilterCe, monthScope]);

  const monitorTotals = useMemo(
    () =>
      computeDashboardMonitorTotals({
        yearCe: yearFilterCe,
        monthScope,
        issuedTaxInvoices: issuedSalesInvoices ?? [],
        vendorBills: vendorBills ?? [],
        purchasesById: purchaseById,
        rentalPayables: rentalPayables ?? [],
        officeLines: officePayrollLines,
        workerLines: workerPayrollLines,
      }),
    [
      yearFilterCe,
      monthScope,
      issuedSalesInvoices,
      vendorBills,
      purchaseById,
      rentalPayables,
      officePayrollLines,
      workerPayrollLines,
    ],
  );

  const yearOptionsForFilter = useMemo(() => {
    const keys: string[] = yearOptionsCe.map((year) => `${year}-01`);
    for (const item of issuedSalesInvoices ?? []) keys.push(String(item.issueDate || '').slice(0, 7));
    for (const item of vendorBills ?? []) keys.push(String(item.billingReceivedDate || item.rentalPeriodMonth || '').slice(0, 7));
    for (const item of rentalPayables ?? []) keys.push(String(item.periodMonth || '').slice(0, 7));
    for (const item of officePayrollLines) keys.push(String(item.run.payrollMonth || '').slice(0, 7));
    for (const item of workerPayrollLines) keys.push(String(item.line.periodEndDate || item.line.periodStartDate || '').slice(0, 7));
    return buildYearCeOptions(keys);
  }, [yearOptionsCe, issuedSalesInvoices, vendorBills, rentalPayables, officePayrollLines, workerPayrollLines]);

  const tradeMonitorLoading = issuedSalesLoading || vendorBillsLoading || rentalPayablesLoading || purchasesLoading;

  // --- Computed Stats ---

  const stats = useMemo(() => {
    return {
      pendingBilling: scopedCommercialDrafts.length,
      draftInvoices: scopedDraftInvoices.length,
      outstandingAR: scopedArItems.reduce((sum, item) => sum + item.outstandingAmount, 0),
      pendingAP: openScopedApItems.reduce((sum, item) => sum + item.outstandingAmount, 0),
      payrollWaiting: scopedPayroll.length,
      totalCash: bankAccounts?.reduce((sum, acc) => sum + cashOnHandExcludingOd(acc), 0) || 0,
    };
  }, [scopedCommercialDrafts, scopedDraftInvoices, scopedArItems, openScopedApItems, scopedPayroll, bankAccounts]);

  const urgentTasks = useMemo(() => {
    const tasks: any[] = [];
    
    // Payroll Handoff
    scopedPayroll.forEach(run => {
      tasks.push({
        id: run.id,
        type: 'Payroll Payment',
        label: `Authorize Payment: ${run.payrollRunNo}`,
        status: 'HR_APPROVED',
        link: `/payroll/batches`, // Updated to batches canonical list
        priority: 'high'
      });
    });

    // Overdue AR (derive จาก dueDate — ไม่พึ่ง status ที่ค้างเป็น OPEN ใน Firestore)
    scopedArItems.filter((item) => resolveArEffectiveStatus(item) === 'OVERDUE').forEach((item) => {
      tasks.push({
        id: item.id,
        type: 'Collection',
        label: `Overdue AR: ${item.documentNo}`,
        sub: `฿${item.outstandingAmount.toLocaleString()}`,
        status: 'OVERDUE',
        link: '/accounts-receivable',
        priority: 'high'
      });
    });

    // Draft Invoices
    scopedDraftInvoices.forEach(inv => {
      tasks.push({
        id: inv.id,
        type: 'Tax Invoice',
        label: `Confirm Draft: ${inv.taxInvoiceNo}`,
        status: 'DRAFT',
        link: `/tax-invoices/${inv.id}`,
        priority: 'medium'
      });
    });

    return tasks;
  }, [scopedPayroll, scopedArItems, scopedDraftInvoices]);

  useEffect(() => {
    if (!firestore || !isAccountingAuthorized || staleArReconcileRan.current) return;
    staleArReconcileRan.current = true;
    void reconcileAllStaleArEntries(firestore).catch((e) => {
      console.error('Batch AR reconcile failed', e);
    });
  }, [firestore, isAccountingAuthorized]);

  if (userLoading || !currentUser) return null;

  if (!isAccountingAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">This dashboard is reserved for Accounting and Finance personnel.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-8 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Calculator className="h-8 w-8" /> แดชบอร์ดฝ่ายบัญชีและการเงิน (Accounting Dashboard)
            </h1>
            <p className="text-muted-foreground text-lg italic">
              ติดตามงานวางบิล ใบกำกับภาษี ลูกหนี้ เจ้าหนี้ การจ่ายเงิน และงานการเงินที่ต้องดำเนินการ (Monitor billing, invoicing, AR/AP, and payments).
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <YearMonthScopeSelects
              idPrefix="accounting-dashboard"
              yearCe={yearFilterCe}
              monthScope={monthScope}
              yearOptionsCe={yearOptionsForFilter}
              onYearCeChange={setYearFilterCe}
              onMonthScopeChange={setMonthScope}
              yearTriggerClassName="h-11 w-[7.5rem]"
              monthTriggerClassName="h-11 w-[9.5rem]"
            />
          </div>
        </div>

        {/* Top KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard title="ลูกหนี้ค้างรับ" value={`฿${stats.outstandingAR.toLocaleString()}`} sub="Total AR Portfolio" icon={ArrowUpRight} colorClass="border-l-blue-600" />
          <StatCard title="เจ้าหนี้ค้างจ่าย" value={`฿${stats.pendingAP.toLocaleString()}`} sub="Total AP Liability" icon={ArrowDownLeft} colorClass="border-l-red-600" />
          <StatCard title="ใบแจ้งหนี้ค้าง" value={stats.pendingBilling} sub="Draft / รอลูกค้า" icon={Receipt} colorClass="border-l-amber-500" />
          <StatCard title="ใบกำกับภาษีร่าง" value={stats.draftInvoices} sub="Draft Tax Invoices" icon={FileBadge} colorClass="border-l-indigo-500" />
          <StatCard title="รอจ่ายเงินเดือน" value={stats.payrollWaiting} sub="Payroll Handoff" icon={Coins} colorClass="border-l-purple-600" />
          <StatCard
            title="ยอดเงินสดรวม"
            value={canViewBankBalances ? `฿${stats.totalCash.toLocaleString()}` : '—'}
            sub={canViewBankBalances ? 'ไม่รวมวงเงิน OD' : 'เฉพาะผู้จัดการบัญชี'}
            icon={Wallet}
            colorClass="border-l-green-600"
          />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <StatCard title="ยอดขาย" value={monitorBaht(monitorTotals.salesBeforeTax, tradeMonitorLoading)} sub="ก่อนภาษี · ใบกำกับที่ออกแล้ว" icon={Receipt} colorClass="border-l-blue-600" />
            <StatCard title="ภาษีขาย" value={monitorBaht(monitorTotals.salesVat, tradeMonitorLoading)} sub="ภาษีมูลค่าเพิ่มขาออก" icon={FileBadge} colorClass="border-l-indigo-500" />
            <StatCard title="ยอดซื้อ" value={monitorBaht(monitorTotals.purchaseBeforeTax, tradeMonitorLoading)} sub="สินค้า · ค่าเช่า · ใบสั่งซื้อ · เหมา" icon={ArrowDownLeft} colorClass="border-l-amber-500" />
            <StatCard title="ภาษีซื้อ" value={monitorBaht(monitorTotals.purchaseVat, tradeMonitorLoading)} sub="ภาษีมูลค่าเพิ่มขาเข้า" icon={FileText} colorClass="border-l-orange-500" />
            <StatCard title="หัก ณ ที่จ่ายคู่ค้า" value={monitorBaht(monitorTotals.whtWithheldFromVendors, tradeMonitorLoading)} sub="ยอดที่เราหักคู่ค้า" icon={Coins} colorClass="border-l-rose-500" />
            <StatCard title="ถูกหัก ณ ที่จ่าย" value={monitorBaht(monitorTotals.whtWithheldFromUs, tradeMonitorLoading)} sub="ยอดที่ลูกค้าหักเรา" icon={ArrowUpRight} colorClass="border-l-sky-600" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <StatCard title="เงินเดือนออฟฟิศ" value={monitorBaht(monitorTotals.officeSalary, payrollMonitorLoading)} sub="พนักงานออฟฟิศ + ผู้บริหาร · ก่อนหัก" icon={Building2} colorClass="border-l-violet-600" />
            <StatCard title="เงินเดือนลูกจ้าง" value={monitorBaht(monitorTotals.workerSalary, payrollMonitorLoading)} sub="บริษัท + เหมา · ก่อนหัก" icon={Coins} colorClass="border-l-fuchsia-600" />
            <StatCard title="ประกันสังคม" value={monitorBaht(monitorTotals.socialSecurity, payrollMonitorLoading)} sub="ลูกจ้าง + นายจ้าง" icon={Wallet} colorClass="border-l-teal-600" />
            <StatCard title="หัก ณ ที่จ่าย" value={monitorBaht(monitorTotals.payrollWht, payrollMonitorLoading)} sub="เงินเดือนออฟฟิศ + ลูกจ้าง" icon={FileBadge} colorClass="border-l-red-600" />
            <StatCard title="หักเข้ากองทุน" value={monitorBaht(monitorTotals.assistanceFund, payrollMonitorLoading)} sub="กองทุนสงเคราะห์ลูกจ้าง" icon={History} colorClass="border-l-slate-600" />
            <StatCard
              title="ส่วนต่างภาษี"
              value={monitorBaht(monitorTotals.vatDifference, tradeMonitorLoading)}
              sub="ภาษีขาย − ภาษีซื้อ"
              icon={Calculator}
              colorClass={monitorTotals.vatDifference < 0 ? 'border-l-red-600' : 'border-l-green-600'}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Action Queue Section */}
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="shadow-md border-none overflow-hidden">
                <CardHeader className="bg-primary/5 border-b pb-4">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" /> รายการลูกหนี้ค้างชำระ (Recent AR)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {scopedArItems.slice(0, 5).map(item => (
                      <div key={item.id} className="p-3 flex items-center justify-between text-xs">
                        <div className="space-y-0.5">
                          <p className="font-bold">{item.documentNo}</p>
                          <p className="text-muted-foreground font-mono">Due: {formatYmdLocalThaiBE(item.dueDate)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-blue-700">฿{item.outstandingAmount.toLocaleString()}</p>
                          <Badge variant="outline" className="text-[8px] h-4">{item.status}</Badge>
                        </div>
                      </div>
                    ))}
                    {scopedArItems.length === 0 && <p className="p-10 text-center text-xs text-muted-foreground italic">No outstanding AR</p>}
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-md border-none overflow-hidden">
                <CardHeader className="bg-primary/5 border-b pb-4">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <History className="h-4 w-4 text-red-600" /> รายการเจ้าหนี้ค้างชำระ (Recent AP)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {openScopedApItems.slice(0, 5).map(item => (
                      <div key={item.id} className="p-3 flex items-center justify-between text-xs">
                        <div className="space-y-0.5">
                          <p className="font-bold">{item.documentNo}</p>
                          <p className="text-muted-foreground font-mono">Due: {formatYmdLocalThaiBE(item.dueDate)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-red-600">฿{item.outstandingAmount.toLocaleString()}</p>
                          <Badge variant="outline" className="text-[8px] h-4">{item.status}</Badge>
                        </div>
                      </div>
                    ))}
                    {openScopedApItems.length === 0 && <p className="p-10 text-center text-xs text-muted-foreground italic">No outstanding AP</p>}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" /> งานที่ต้องดำเนินการ (Accounting Action Queue)
                    </CardTitle>
                    <CardDescription>รายการด่วนที่ฝ่ายบัญชีและการเงินต้องตรวจสอบหรืออนุมัติ</CardDescription>
                  </div>
                  <Badge variant="secondary" className="font-bold">{urgentTasks.length} รายการ</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {urgentTasks.length > 0 ? (
                  <div className="divide-y">
                    {urgentTasks.map(task => (
                      <Link key={task.id} href={task.link} className="block hover:bg-slate-50 transition-colors group">
                        <div className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className={`p-2 rounded-lg ${task.priority === 'high' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                              {task.type.includes('Payroll') ? <Coins className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                            </div>
                            <div className="space-y-0.5">
                              <p className="font-bold text-primary group-hover:text-blue-600 transition-colors">{task.label}</p>
                              <div className="flex items-center gap-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground">
                                <span>{task.type}</span>
                                {task.sub && <span>• {task.sub}</span>}
                                <span>•</span>
                                <span className={task.priority === 'high' ? 'text-red-500' : ''}>{task.status}</span>
                              </div>
                            </div>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-30 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="py-20 text-center space-y-4">
                    <CheckCircle2 className="h-12 w-12 mx-auto text-green-500/20" />
                    <p className="text-muted-foreground italic">ไม่มีงานค้างที่ต้องดำเนินการในขณะนี้ (No pending finance tasks)</p>
                  </div>
                )}
              </CardContent>
              <CardFooter className="bg-muted/30 p-3 flex justify-center border-t">
                <Button variant="link" className="text-xs text-muted-foreground" asChild>
                  <Link href="/cashbook">ดูความเคลื่อนไหวเงินสดทั้งหมด <ArrowRight className="h-3 w-3 ml-1" /></Link>
                </Button>
              </CardFooter>
            </Card>
          </div>

          {/* Sidebar Section */}
          <div className="space-y-6">
            <Card className="shadow-md border-none">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                  <ShieldAlert className="h-4 w-4" /> ทางลัดงานบัญชี (Accounting Shortcuts)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-2">
                <ShortcutItem href="/draft-invoices" label="การออกใบแจ้งหนี้ (Invoice)" sub="Timesheet หรือ PO ใบเสนอราคา" icon={FileText} />
                <ShortcutItem
                  href="/tax-invoices"
                  label="ใบกำกับภาษีขาย"
                  sub="แยกจากใบเสร็จ — ออกรับเงินทีหลัง"
                  icon={FileBadge}
                />
                <ShortcutItem href="/accounts-receivable" label="ลูกหนี้การค้า (AR)" sub="AR Aging" icon={ArrowUpRight} />
                <ShortcutItem href="/accounts-payable" label="เจ้าหนี้การค้า (AP)" sub="AP Tracking" icon={ArrowDownLeft} />
                <ShortcutItem href="/cashbook" label="สมุดรายรับรายจ่าย" sub="Cashbook Entries" icon={History} />
                <ShortcutItem href="/bank-accounts" label="บัญชีธนาคาร" sub="Bank Accounts" icon={Wallet} />
              </CardContent>
            </Card>

            <Card className="bg-blue-50 border-blue-100 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-blue-800 flex items-center gap-2">
                  <Info className="h-3 w-3" /> Billing Cycle reminder
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-blue-700 leading-relaxed">
                ตรวจยอด «รายการใบแจ้งหนี้ (เรียกเก็บ)» ก่อนออกใบกำกับภาษี และตรวจหัก ณ ที่จ่าย (WHT) ให้ตรงตามเงื่อนไขสัญญา
              </CardContent>
            </Card>

            <Card className="bg-amber-50 border-amber-100 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-3 w-3" /> Liquidity Alert
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-amber-700 leading-relaxed">
                ติดตามลูกหนี้เกินกำหนด (Overdue AR) เพื่อรักษาสภาพคล่อง และวางแผนจ่ายเจ้าหนี้ (AP) ตามวันครบกำหนด
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function monitorBaht(amount: number, loading: boolean): string {
  if (loading) return '…';
  return `฿${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm bg-white`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-30 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-xl font-black text-primary truncate">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1 uppercase tracking-tighter">{sub}</p>
      </CardContent>
    </Card>
  );
}

function ShortcutItem({ href, label, sub, icon: Icon }: any) {
  return (
    <Link href={href} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-50 transition-colors group">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
        <div className="flex flex-col">
          <span className="text-xs font-bold text-primary">{label}</span>
          <span className="text-[9px] text-muted-foreground uppercase">{sub}</span>
        </div>
      </div>
      <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all translate-x-[-4px] group-hover:translate-x-0" />
    </Link>
  );
}
