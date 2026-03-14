'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users, 
  Briefcase, 
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
  UserCheck,
  CreditCard,
  Receipt,
  CheckCircle2,
  Coins,
  FileDown,
  ArrowUpRight,
  ArrowDownLeft,
  BookOpen,
  UserSearch,
  FileBadge,
  PackageSearch,
  Inbox
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
import { RoleType } from '@/lib/types';

interface NavItem {
  title: string;
  href: string;
  icon: any;
  roles: RoleType[];
  isFuture?: boolean;
}

interface NavGroup {
  label: string;
  roles: RoleType[];
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'ภาพรวม (Overview)',
    roles: ['system_admin', 'finance_officer', 'sales_officer', 'hr_manager', 'hr_officer', 'payroll_officer', 'store_officer', 'client', 'client_user', 'operations_officer', 'safety_officer'],
    items: [
      { title: 'แดชบอร์ด (Dashboard)', href: '/', icon: LayoutDashboard, roles: ['system_admin', 'finance_officer', 'sales_officer', 'hr_manager', 'hr_officer', 'payroll_officer', 'store_officer', 'client', 'client_user', 'operations_officer', 'safety_officer'] },
    ]
  },
  {
    label: 'งานขายและสัญญา (Commercial)',
    roles: ['system_admin', 'sales_officer', 'finance_officer', 'operations_officer', 'store_officer'],
    items: [
      { title: 'ลูกค้า (Customers)', href: '/customers', icon: Users, roles: ['system_admin', 'sales_officer'] },
      { title: 'คู่ค้า / ผู้ขาย (Vendors)', href: '/vendors', icon: Store, roles: ['system_admin', 'store_officer'] },
      { title: 'สัญญาหลัก (Main Contracts)', href: '/main-contracts', icon: ClipboardList, roles: ['system_admin', 'sales_officer', 'finance_officer'] },
      { title: 'ใบสั่งซื้อลูกค้า (Customer POs)', href: '/purchase-orders', icon: ShoppingCart, roles: ['system_admin', 'sales_officer', 'operations_officer'] },
    ]
  },
  {
    label: 'บุคคลและเงินเดือน (HR & Payroll)',
    roles: ['system_admin', 'hr_manager', 'hr_officer', 'payroll_officer', 'finance_officer', 'safety_officer'],
    items: [
      { title: 'ลงเวลาทำงาน (Timesheets)', href: '/timesheets', icon: Clock, roles: ['system_admin', 'hr_manager', 'hr_officer', 'payroll_officer', 'operations_officer'] },
      { title: 'จ่ายเงินคนงาน (Worker Payroll)', href: '/payroll', icon: CircleDollarSign, roles: ['system_admin', 'payroll_officer', 'hr_manager', 'finance_officer'] },
      { title: 'เงินเดือนพนักงาน (Office Payroll)', href: '/office-payroll', icon: Coins, roles: ['system_admin', 'hr_manager', 'finance_officer'] },
      { title: 'ตำแหน่งงาน (Positions)', href: '/positions', icon: Activity, roles: ['system_admin', 'hr_manager', 'safety_officer'] },
      { title: 'คนงาน (Workers)', href: '/workers', icon: HardHat, roles: ['system_admin', 'hr_manager', 'hr_officer', 'safety_officer'] },
      { title: 'พนักงานออฟฟิศ (Office Staff)', href: '/office-staff', icon: UserSearch, roles: ['system_admin', 'hr_manager'] },
    ]
  },
  {
    label: 'งานปฏิบัติการ (Operations)',
    roles: ['system_admin', 'hr_manager', 'hr_officer', 'operations_officer', 'safety_officer', 'store_officer'],
    items: [
      { title: 'กลุ่มการส่งตัว (Waves)', href: '/waves', icon: Waves, roles: ['system_admin', 'hr_manager', 'hr_officer', 'operations_officer'] },
      { title: 'การมอบหมายงาน (Assignments)', href: '/assignments', icon: UserPlus, roles: ['system_admin', 'hr_manager', 'hr_officer', 'sales_officer', 'operations_officer'] },
      { title: 'การระดมพล (Mobilization)', href: '/mobilization', icon: Truck, roles: ['system_admin', 'operations_officer', 'hr_officer', 'safety_officer'] },
      { title: 'การซื้อสินค้า/บริการ (Purchases)', href: '/purchases', icon: PackageSearch, roles: ['system_admin', 'finance_officer', 'store_officer'] },
      { title: 'คลังอุปกรณ์ (Store / Inventory)', href: '/store', icon: Warehouse, roles: ['system_admin', 'store_officer', 'operations_officer'] },
    ]
  },
  {
    label: 'การเงินและบัญชี (Finance & Accounting)',
    roles: ['system_admin', 'finance_officer', 'sales_officer'],
    items: [
      { title: 'ใบวางบิลลูกหนี้ (Billing Notes)', href: '/billing-notes', icon: FileText, roles: ['system_admin', 'sales_officer', 'finance_officer'] },
      { title: 'ใบกำกับภาษี (Tax Invoices)', href: '/tax-invoices', icon: FileBadge, roles: ['system_admin', 'finance_officer', 'sales_officer'] },
      { title: 'ใบเสร็จรับเงิน (Receipts)', href: '/receipts', icon: Receipt, roles: ['system_admin', 'finance_officer'] },
      { title: 'รับวางบิลเจ้าหนี้ (AP Bills)', href: '/ap-bills', icon: Inbox, roles: ['system_admin', 'finance_officer'] },
      { title: 'ลูกหนี้การค้า (AR)', href: '/accounts-receivable', icon: ArrowUpRight, roles: ['system_admin', 'finance_officer'] },
      { title: 'เจ้าหนี้การค้า (AP)', href: '/accounts-payable', icon: ArrowDownLeft, roles: ['system_admin', 'finance_officer'] },
      { title: 'รายรับรายจ่าย (Cashbook)', href: '/cashbook', icon: BookOpen, roles: ['system_admin', 'finance_officer'] },
      { title: 'บัญชีธนาคาร (Bank Accounts)', href: '/bank-accounts', icon: CreditCard, roles: ['system_admin', 'finance_officer'] },
    ]
  },
  {
    label: 'ผู้ดูแลระบบ (Administration)',
    roles: ['system_admin', 'client', 'client_user'],
    items: [
      { title: 'จัดการระบบ (System Admin)', href: '/users', icon: ShieldCheck, roles: ['system_admin'] },
      { title: 'Client Portal', href: '/client-portal', icon: ShieldAlert, roles: ['client', 'client_user', 'system_admin'] },
    ]
  },
];

export function SidebarNav({ userRoles }: { userRoles: RoleType[] }) {
  const pathname = usePathname();
  
  // Filter groups where the user has at least one role authorized for the group itself
  const filteredGroups = navGroups.filter(group => 
    group.roles.some(role => userRoles.includes(role))
  );

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center gap-2 font-bold text-primary">
          <div className="bg-primary text-primary-foreground p-1 rounded">
            <FileText className="h-5 w-5" />
          </div>
          <span className="group-data-[collapsible=icon]:hidden">OPEC OpsFlow</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {filteredGroups.map((group) => {
          // Filter items within the group based on user roles and existence of route
          const filteredItems = group.items.filter(item => 
            item.href !== '' && // Only show items with routes
            item.roles.some(role => userRoles.includes(role))
          );

          if (filteredItems.length === 0) return null;

          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="px-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground/70">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {filteredItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.title}>
                        <Link href={item.href}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
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