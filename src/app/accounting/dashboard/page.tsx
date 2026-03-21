'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { 
  User, 
  BillingNote, 
  TaxInvoice, 
  AccountsReceivable, 
  AccountsPayable, 
  PayrollRun, 
  BankAccount
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit, orderBy } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';
import { isAdminUser } from '@/lib/auth-mapping';

export default function AccountingDashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isAccountingAuthorized = useMemo(() => {
    if (!currentUser) return false;
    const authRoles = ['accounting_manager', 'accounting_officer', 'system_admin'];
    return currentUser.roleIds?.some(r => authRoles.includes(r)) || isAdminUser(currentUser);
  }, [currentUser]);

  // --- Financial Data Queries ---
  
  const bnQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return query(collection(firestore, 'billing_notes'), where('status', 'in', ['ISSUED', 'SUBMITTED', 'PARTIALLY_PAID']), limit(20));
  }, [firestore, isAccountingAuthorized]);
  const { data: billingNotes } = useCollection<BillingNote>(bnQuery as any);

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

  const bankQuery = useMemoFirebase(() => {
    if (!firestore || !isAccountingAuthorized) return null;
    return collection(firestore, 'bank_accounts');
  }, [firestore, isAccountingAuthorized]);
  const { data: bankAccounts } = useCollection<BankAccount>(bankQuery as any);

  // --- Computed Stats ---

  const stats = useMemo(() => {
    return {
      pendingBilling: billingNotes?.length || 0,
      draftInvoices: draftInvoices?.length || 0,
      outstandingAR: arItems?.reduce((sum, item) => sum + item.outstandingAmount, 0) || 0,
      pendingAP: apItems?.reduce((sum, item) => sum + item.outstandingAmount, 0) || 0,
      payrollWaiting: pendingPayroll?.length || 0,
      totalCash: bankAccounts?.reduce((sum, acc) => sum + acc.currentBalance, 0) || 0,
    };
  }, [billingNotes, draftInvoices, arItems, apItems, pendingPayroll, bankAccounts]);

  const urgentTasks = useMemo(() => {
    const tasks: any[] = [];
    
    // Payroll Handoff
    pendingPayroll?.forEach(run => {
      tasks.push({
        id: run.id,
        type: 'Payroll Payment',
        label: `Authorize Payment: ${run.payrollRunNo}`,
        status: 'HR_APPROVED',
        link: `/payroll/batches`, // Updated to batches canonical list
        priority: 'high'
      });
    });

    // Overdue AR
    arItems?.filter(item => item.status === 'OVERDUE').forEach(item => {
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
    draftInvoices?.forEach(inv => {
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
  }, [pendingPayroll, arItems, draftInvoices]);

  if (isUserLoading || !currentUser) return null;

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
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Calculator className="h-8 w-8" /> แดชบอร์ดฝ่ายบัญชีและการเงิน (Accounting Dashboard)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามงานวางบิล ใบกำกับภาษี ลูกหนี้ เจ้าหนี้ การจ่ายเงิน และงานการเงินที่ต้องดำเนินการ (Monitor billing, invoicing, AR/AP, and payments).
          </p>
        </div>

        {/* Top KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard title="ลูกหนี้ค้างรับ" value={`฿${stats.outstandingAR.toLocaleString()}`} sub="Total AR Portfolio" icon={ArrowUpRight} colorClass="border-l-blue-600" />
          <StatCard title="เจ้าหนี้ค้างจ่าย" value={`฿${stats.pendingAP.toLocaleString()}`} sub="Total AP Liability" icon={ArrowDownLeft} colorClass="border-l-red-600" />
          <StatCard title="ใบวางบิลค้าง" value={stats.pendingBilling} sub="Pending Billing Notes" icon={Receipt} colorClass="border-l-amber-500" />
          <StatCard title="ใบกำกับภาษีร่าง" value={stats.draftInvoices} sub="Draft Tax Invoices" icon={FileBadge} colorClass="border-l-indigo-500" />
          <StatCard title="รอจ่ายเงินเดือน" value={stats.payrollWaiting} sub="Payroll Handoff" icon={Coins} colorClass="border-l-purple-600" />
          <StatCard title="ยอดเงินสดรวม" value={`฿${stats.totalCash.toLocaleString()}`} sub="All Bank Balances" icon={Wallet} colorClass="border-l-green-600" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Action Queue Section */}
          <div className="lg:col-span-2 space-y-6">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="shadow-md border-none overflow-hidden">
                <CardHeader className="bg-primary/5 border-b pb-4">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" /> รายการลูกหนี้ค้างชำระ (Recent AR)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {arItems?.slice(0, 5).map(item => (
                      <div key={item.id} className="p-3 flex items-center justify-between text-xs">
                        <div className="space-y-0.5">
                          <p className="font-bold">{item.documentNo}</p>
                          <p className="text-muted-foreground font-mono">Due: {item.dueDate}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-blue-700">฿{item.outstandingAmount.toLocaleString()}</p>
                          <Badge variant="outline" className="text-[8px] h-4">{item.status}</Badge>
                        </div>
                      </div>
                    ))}
                    {(!arItems || arItems.length === 0) && <p className="p-10 text-center text-xs text-muted-foreground italic">No outstanding AR</p>}
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
                    {apItems?.slice(0, 5).map(item => (
                      <div key={item.id} className="p-3 flex items-center justify-between text-xs">
                        <div className="space-y-0.5">
                          <p className="font-bold">{item.documentNo}</p>
                          <p className="text-muted-foreground font-mono">Due: {item.dueDate}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-red-600">฿{item.outstandingAmount.toLocaleString()}</p>
                          <Badge variant="outline" className="text-[8px] h-4">{item.status}</Badge>
                        </div>
                      </div>
                    ))}
                    {(!apItems || apItems.length === 0) && <p className="p-10 text-center text-xs text-muted-foreground italic">No outstanding AP</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
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
                <ShortcutItem href="/billing-notes" label="ใบวางบิลลูกหนี้" sub="Billing Notes" icon={FileText} />
                <ShortcutItem href="/tax-invoices" label="ใบกำกับภาษี" sub="Tax Invoices" icon={FileBadge} />
                <ShortcutItem href="/receipts" label="การรับชำระเงิน" sub="Customer Receipts" icon={Receipt} />
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
                กรุณาตรวจสอบความถูกต้องของ Billing Note ก่อนออก Tax Invoice ทุกครั้ง และตรวจสอบหัก ณ ที่จ่าย (WHT) ให้ตรงตามเงื่อนไขสัญญา
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
