'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users, 
  Briefcase, 
  UserSquare2, 
  FileCheck, 
  History, 
  ShieldCheck,
  Package,
  CircleDollarSign,
  ClipboardList,
  ShoppingCart,
  Receipt,
  Clock,
  HardHat,
  Tool,
  Boxes
} from 'lucide-react';
import { cn } from '@/lib/utils';
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
}

const navItems: NavItem[] = [
  // Dashboard for everyone
  { 
    title: 'แดชบอร์ด (Dashboard)', 
    href: '/', 
    icon: LayoutDashboard, 
    roles: ['system_admin', 'sales_officer', 'hr_manager', 'hr_officer', 'payroll_officer', 'store_officer', 'finance_officer'] 
  },
  // System Admin only
  { 
    title: 'ผู้ใช้งานระบบ (Users)', 
    href: '/users', 
    icon: ShieldCheck, 
    roles: ['system_admin'] 
  },
  { 
    title: 'บันทึกการใช้งาน (Audit Logs)', 
    href: '/audit-logs', 
    icon: History, 
    roles: ['system_admin'] 
  },
  // HR Manager & Officer
  { 
    title: 'ตำแหน่งงาน (Positions)', 
    href: '/positions', 
    icon: Briefcase, 
    roles: ['system_admin', 'hr_manager', 'sales_officer'] 
  },
  { 
    title: 'คนงาน (Workers)', 
    href: '/workers', 
    icon: UserSquare2, 
    roles: ['system_admin', 'hr_manager', 'hr_officer'] 
  },
  { 
    title: 'ใบรับรอง (Certificates)', 
    href: '/records', 
    icon: FileCheck, 
    roles: ['system_admin', 'hr_manager', 'hr_officer'] 
  },
  // Sales Officer
  { 
    title: 'ลูกค้า (Customers)', 
    href: '/customers', 
    icon: Users, 
    roles: ['system_admin', 'sales_officer'] 
  },
  { 
    title: 'สัญญา (Contracts)', 
    href: '/contracts', 
    icon: ClipboardList, 
    roles: ['system_admin', 'sales_officer'] 
  },
  { 
    title: 'ใบสั่งซื้อ (Purchase Orders)', 
    href: '/purchase-orders', 
    icon: ShoppingCart, 
    roles: ['system_admin', 'sales_officer'] 
  },
  // Payroll Officer
  { 
    title: 'การจ่ายเงิน (Payroll)', 
    href: '/payroll', 
    icon: CircleDollarSign, 
    roles: ['system_admin', 'payroll_officer'] 
  },
  { 
    title: 'ลงเวลา (Timesheets)', 
    href: '/timesheets', 
    icon: Clock, 
    roles: ['system_admin', 'payroll_officer'] 
  },
  // Store Officer
  { 
    title: 'สต็อก PPE (PPE Stock)', 
    href: '/ppe-stock', 
    icon: HardHat, 
    roles: ['system_admin', 'store_officer'] 
  },
  { 
    title: 'อุปกรณ์ (Equipment)', 
    href: '/equipment', 
    icon: Boxes, 
    roles: ['system_admin', 'store_officer'] 
  },
  // Finance Officer
  { 
    title: 'ใบเสนอราคา (Quotations)', 
    href: '/quotations', 
    icon: FileCheck, 
    roles: ['system_admin', 'finance_officer'] 
  },
  { 
    title: 'ใบแจ้งหนี้ (Invoices)', 
    href: '/invoices', 
    icon: Receipt, 
    roles: ['system_admin', 'finance_officer'] 
  },
];

export function SidebarNav({ userRole }: { userRole: RoleType }) {
  const pathname = usePathname();

  const filteredNav = navItems.filter(item => item.roles.includes(userRole));

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center gap-2 font-bold text-primary">
          <Package className="h-6 w-6" />
          <span className="group-data-[collapsible=icon]:hidden">OPEC OpsFlow</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>เมนูการใช้งาน (Main Menu)</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredNav.map((item) => (
                <SidebarMenuItem key={item.href}>
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
      </SidebarContent>
    </Sidebar>
  );
}
