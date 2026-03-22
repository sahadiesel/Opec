'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users, 
  ShieldCheck,
  ClipboardList,
  ShoppingCart,
  UserPlus,
  CircleDollarSign,
  Clock,
  Warehouse,
  ShieldAlert,
  FileText,
  Activity,
  HardHat,
  Waves,
  Truck,
  Store,
  CreditCard,
  Receipt,
  Coins,
  ArrowUpRight,
  ArrowDownLeft,
  BookOpen,
  UserSearch,
  FileBadge,
  PackageSearch,
  Inbox,
  LockKeyhole,
  Grid,
  SearchCheck,
  Settings,
  FileSignature,
  Hash,
  Scale,
  Calculator,
  CalendarDays,
  UserCheck,
  ClipboardCheck,
  History,
  Grid3X3,
  Lock,
  FileBarChart
} from 'lucide-react';
import { 
  Sidebar, 
  SidebarContent, 
  SidebarGroup, 
  SidebarGroupContent, 
  SidebarGroupLabel, 
  SidebarHeader, 
  SidebarMenu, 
  SidebarMenuButton, 
  SidebarMenuItem 
} from '@/components/ui/sidebar';
import { User, PermissionProfile } from '@/lib/types';
import { ModuleKey, canView } from '@/lib/permissions';
import { isAdminUser } from '@/lib/auth-mapping';
import { UI_LABELS } from '@/lib/constants/labels';

interface NavItem {
  key: ModuleKey;
  title: string;
  href: string;
  icon: any;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'ภาพรวม (Overview)',
    items: [
      { key: 'overview_dashboard', title: UI_LABELS.DASHBOARD, href: '/', icon: LayoutDashboard },
    ]
  },
  {
    label: 'งานขายและสัญญา (Commercial)',
    items: [
      { key: 'customers', title: UI_LABELS.CUSTOMERS, href: '/customers', icon: Users },
      { key: 'quotations', title: UI_LABELS.QUOTATIONS, href: '/quotations', icon: FileSignature },
      { key: 'main_contracts', title: UI_LABELS.MAIN_CONTRACTS, href: '/main-contracts', icon: ClipboardList },
      { key: 'sales_contract_terms', title: 'เงื่อนไขการขาย (Sales Terms)', href: '/sales-terms', icon: Scale },
      { key: 'customer_pos', title: UI_LABELS.CUSTOMER_POS, href: '/purchase-orders', icon: ShoppingCart },
    ]
  },
  {
    label: 'บุคคลและเงินเดือน (HR & Payroll)',
    items: [
      { key: 'timesheets', title: 'ลงเวลาแบบกลุ่ม (Wave Daily Board)', href: '/timesheets/wave-board', icon: Grid3X3 },
      { key: 'timesheets', title: 'ประวัติลงเวลารายวัน (History)', href: '/timesheets/daily', icon: Clock },
      { key: 'worker_payroll', title: 'งวดการจ่ายเงิน (Payroll Batches)', href: '/payroll/batches', icon: Coins },
      { key: 'worker_payroll', title: 'จัดการรอบบัญชี (Periods)', href: '/payroll/periods', icon: CalendarDays },
      { key: 'labor_cost_contract_terms', title: 'เงื่อนไขต้นทุน (Cost Terms)', href: '/labor-cost-terms', icon: Calculator },
      { key: 'office_payroll', title: UI_LABELS.OFFICE_PAYROLL, href: '/office-payroll', icon: Coins },
      { key: 'positions', title: UI_LABELS.POSITIONS, href: '/positions', icon: Activity },
      { key: 'workers', title: UI_LABELS.WORKERS, href: '/workers', icon: HardHat },
      { key: 'office_staff', title: UI_LABELS.OFFICE_STAFF, href: '/office-staff', icon: UserSearch },
    ]
  },
  {
    label: 'งานปฏิบัติการ (Operations)',
    items: [
      { key: 'waves', title: UI_LABELS.WAVES, href: '/waves', icon: Waves },
      { key: 'assignments', title: UI_LABELS.ASSIGNMENTS, href: '/assignments', icon: UserPlus },
      { key: 'mobilization', title: UI_LABELS.MOBILIZATION, href: '/mobilization', icon: Truck },
      { key: 'vendors', title: UI_LABELS.VENDORS, href: '/vendors', icon: Store },
      { key: 'purchases', title: UI_LABELS.PURCHASES, href: '/purchases', icon: PackageSearch },
      { key: 'store_inventory', title: UI_LABELS.STORE, href: '/store', icon: Warehouse },
    ]
  },
  {
    label: 'การเงินและบัญชี (Finance & Accounting)',
    items: [
      { key: 'billing_notes', title: 'ใบวางบิลลูกหนี้ (Billing Notes)', href: '/billing-notes', icon: FileText },
      { key: 'tax_invoices', title: 'ใบกำกับภาษี (Tax Invoices)', href: '/tax-invoices', icon: FileBadge },
      { key: 'receipts', title: 'ใบเสร็จรับเงิน (Receipts)', href: '/receipts', icon: Receipt },
      { key: 'ap_bills', title: 'รับวางบิลเจ้าหนี้ (AP Bills)', href: '/ap-bills', icon: Inbox },
      { key: 'accounts_receivable', title: 'ลูกหนี้การค้า (AR)', href: '/accounts-receivable', icon: ArrowUpRight },
      { key: 'accounts_payable', title: 'เจ้าหนี้การค้า (AP)', href: '/accounts-payable', icon: ArrowDownLeft },
      { key: 'cashbook', title: 'รายรับรายจ่าย (Cashbook)', href: '/cashbook', icon: BookOpen },
      { key: 'bank_accounts', title: 'บัญชีธนาคาร (Bank Accounts)', href: '/bank-accounts', icon: CreditCard },
    ]
  },
  {
    label: 'การจัดการระบบ (Administration)',
    items: [
      { key: 'system_admin', title: 'จัดการผู้ใช้/ระบบ (User Access)', href: '/users', icon: ShieldCheck },
      { key: 'system_admin', title: 'การเข้าใช้งานของลูกค้า', href: '/system-admin/customer-portal', icon: Lock },
      { key: 'system_admin', title: 'เมทริกซ์สิทธิ์ (Advanced)', href: '/system-admin/permissions', icon: LockKeyhole },
      { key: 'system_admin', title: 'ตรวจสอบความปลอดภัย (Security)', href: '/system-admin/security-check', icon: ShieldAlert },
      { key: 'document_numbering', title: 'เลขที่เอกสาร (Numbering)', href: '/system-admin/numbering', icon: Hash },
      { key: 'audit_logs', title: 'ประวัติกิจกรรม (Audit Logs)', href: '/system-admin/audit-logs', icon: History },
      { key: 'client_portal', title: 'Client Portal Preview', href: '/client-portal/dashboard', icon: ShieldAlert },
    ]
  },
  {
    label: 'ลูกค้า (Project Portal)',
    items: [
      { key: 'client_portal', title: 'หน้าหลัก (Dashboard)', href: '/client-portal/dashboard', icon: LayoutDashboard },
      { key: 'client_portal', title: 'ประวัติกำลังพล (Personnel)', href: '/client-portal/waves', icon: HardHat },
      { key: 'client_portal', title: 'หลักฐานการลงเวลา (Activity)', href: '/client-portal/timesheets', icon: Clock },
      { key: 'client_portal', title: 'การเงินและวางบิล (Billing)', href: '/client-portal/billing', icon: FileBarChart },
    ]
  }
];

export function SidebarNav({ user, profiles }: { user: User; profiles?: PermissionProfile[] | null }) {
  const pathname = usePathname();
  const isAdmin = isAdminUser(user);

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="border-b p-4 bg-primary text-primary-foreground">
        <div className="flex items-center gap-3 font-bold">
          <div className="bg-white text-primary p-1.5 rounded shadow-sm">
            <Settings className="h-5 w-5" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden overflow-hidden">
            <span className="text-lg tracking-tight truncate leading-tight">OPEC OpsFlow</span>
            <span className="text-[8px] opacity-60 uppercase tracking-widest font-black truncate">Platform v2.0</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="py-4">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter(item =>
            isAdmin || canView(user, item.key, profiles?.[0] ?? null)
          );

          if (visibleItems.length === 0) return null;

          return (
            <SidebarGroup key={group.label} className="py-2">
              <SidebarGroupLabel className="px-4 text-[9px] uppercase tracking-widest font-black text-muted-foreground/40 mb-1">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => (
                    <SidebarMenuItem key={`${item.key}-${item.href}`}>
                      <SidebarMenuButton 
                        asChild 
                        isActive={pathname === item.href} 
                        tooltip={item.title}
                        className={`transition-all duration-200 ${pathname === item.href ? 'font-bold' : ''}`}
                      >
                        <Link href={item.href}>
                          <item.icon className={`h-4 w-4 ${pathname === item.href ? 'text-primary' : 'text-muted-foreground'}`} />
                          <span className="font-semibold text-xs tracking-tight">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
