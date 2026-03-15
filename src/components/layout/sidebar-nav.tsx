
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
  LockKeyhole
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
      { key: 'overview_dashboard', title: 'แดชบอร์ด (Dashboard)', href: '/', icon: LayoutDashboard },
    ]
  },
  {
    label: 'งานขายและสัญญา (Commercial)',
    items: [
      { key: 'customers', title: 'ลูกค้า (Customers)', href: '/customers', icon: Users },
      { key: 'main_contracts', title: 'สัญญาหลัก (Main Contracts)', href: '/main-contracts', icon: ClipboardList },
      { key: 'customer_pos', title: 'ใบสั่งซื้อลูกค้า (Customer POs)', href: '/purchase-orders', icon: ShoppingCart },
    ]
  },
  {
    label: 'บุคคลและเงินเดือน (HR & Payroll)',
    items: [
      { key: 'timesheets', title: 'ลงเวลาทำงาน (Timesheets)', href: '/timesheets', icon: Clock },
      { key: 'worker_payroll', title: 'จ่ายเงินคนงาน (Worker Payroll)', href: '/payroll', icon: CircleDollarSign },
      { key: 'office_payroll', title: 'เงินเดือนพนักงาน (Office Payroll)', href: '/office-payroll', icon: Coins },
      { key: 'positions', title: 'ตำแหน่งงาน (Positions)', href: '/positions', icon: Activity },
      { key: 'workers', title: 'คนงาน (Workers)', href: '/workers', icon: HardHat },
      { key: 'office_staff', title: 'พนักงานออฟฟิศ (Office Staff)', href: '/office-staff', icon: UserSearch },
    ]
  },
  {
    label: 'งานปฏิบัติการ (Operations)',
    items: [
      { key: 'waves', title: 'กลุ่มการส่งตัว (Waves)', href: '/waves', icon: Waves },
      { key: 'assignments', title: 'การมอบหมายงาน (Assignments)', href: '/assignments', icon: UserPlus },
      { key: 'mobilization', title: 'การระดมพล (Mobilization)', href: '/mobilization', icon: Truck },
      { key: 'vendors', title: 'คู่ค้า / ผู้ขาย (Vendors)', href: '/vendors', icon: Store },
      { key: 'purchases', title: 'การซื้อสินค้า/บริการ (Purchases)', href: '/purchases', icon: PackageSearch },
      { key: 'store_inventory', title: 'คลังอุปกรณ์ (Store / Inventory)', href: '/store', icon: Warehouse },
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
    label: 'ผู้ดูแลระบบ (Administration)',
    items: [
      { key: 'system_admin', title: 'จัดการผู้ใช้ (User List)', href: '/users', icon: ShieldCheck },
      { key: 'system_admin', title: 'จัดการสิทธิ์ (Permissions)', href: '/system-admin/permissions', icon: LockKeyhole },
      { key: 'client_portal', title: 'Client Portal', href: '/client-portal', icon: ShieldAlert },
    ]
  },
];

export function SidebarNav({ user, profile }: { user: User; profile?: PermissionProfile | null }) {
  const pathname = usePathname();

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="border-b p-4 bg-primary text-primary-foreground">
        <div className="flex items-center gap-2 font-bold">
          <div className="bg-white text-primary p-1 rounded">
            <FileText className="h-5 w-5" />
          </div>
          <span className="group-data-[collapsible=icon]:hidden text-lg tracking-tight">OPEC OpsFlow</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="py-2">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter(item => 
            canView(user, item.key, profile)
          );

          if (visibleItems.length === 0) return null;

          return (
            <SidebarGroup key={group.label} className="py-2">
              <SidebarGroupLabel className="px-4 text-[10px] uppercase tracking-widest font-black text-muted-foreground/50">
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
                        className="transition-all duration-200"
                      >
                        <Link href={item.href}>
                          <item.icon className="h-4 w-4" />
                          <span className="font-medium">{item.title}</span>
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
