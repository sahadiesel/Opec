'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users, 
  Briefcase, 
  UserSquare2, 
  ShieldCheck,
  ClipboardList,
  ShoppingCart,
  UserPlus,
  CircleDollarSign,
  Clock,
  Boxes,
  ShieldAlert,
  FileText,
  Warehouse,
  ShieldQuestion
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
}

const navItems: NavItem[] = [
  { 
    title: 'แดชบอร์ด (Dashboard)', 
    href: '/', 
    icon: LayoutDashboard, 
    roles: ['system_admin', 'finance_officer', 'sales_officer', 'hr_manager', 'hr_officer', 'payroll_officer', 'store_officer', 'client', 'client_user', 'operations_officer', 'safety_officer'] 
  },
  { 
    title: 'Client Portal', 
    href: '/client-portal', 
    icon: ShieldAlert, 
    roles: ['client', 'client_user', 'system_admin'] 
  },
  // Commercial Module
  { 
    title: 'ลูกค้า (Customers)', 
    href: '/customers', 
    icon: Users, 
    roles: ['system_admin', 'sales_officer'] 
  },
  { 
    title: 'สัญญาหลัก (Main Contracts)', 
    href: '/main-contracts', 
    icon: ClipboardList, 
    roles: ['system_admin', 'sales_officer', 'finance_officer'] 
  },
  { 
    title: 'ใบสั่งซื้อลูกค้า (Customer POs)', 
    href: '/purchase-orders', 
    icon: ShoppingCart, 
    roles: ['system_admin', 'sales_officer', 'operations_officer'] 
  },
  // HR & Operations Module
  { 
    title: 'ตำแหน่งงาน (Positions)', 
    href: '/positions', 
    icon: Briefcase, 
    roles: ['system_admin', 'hr_manager', 'safety_officer'] 
  },
  { 
    title: 'คนงาน (Workers)', 
    href: '/workers', 
    icon: UserSquare2, 
    roles: ['system_admin', 'hr_manager', 'hr_officer', 'operations_officer', 'safety_officer'] 
  },
  { 
    title: 'การมอบหมาย (Assignments)', 
    href: '/assignments', 
    icon: UserPlus, 
    roles: ['system_admin', 'hr_manager', 'hr_officer', 'sales_officer', 'operations_officer'] 
  },
  // Payroll & Finance
  { 
    title: 'การจ่ายเงิน (Payroll)', 
    href: '/payroll', 
    icon: CircleDollarSign, 
    roles: ['system_admin', 'payroll_officer', 'finance_officer'] 
  },
  { 
    title: 'ลงเวลา (Timesheets)', 
    href: '/timesheets', 
    icon: Clock, 
    roles: ['system_admin', 'payroll_officer', 'hr_officer', 'operations_officer'] 
  },
  // Store
  { 
    title: 'คลังอุปกรณ์ (Store)', 
    href: '/store', 
    icon: Warehouse, 
    roles: ['system_admin', 'store_officer', 'operations_officer'] 
  },
  // Admin
  { 
    title: 'จัดการระบบ (System Admin)', 
    href: '/users', 
    icon: ShieldCheck, 
    roles: ['system_admin'] 
  },
];

export function SidebarNav({ userRoles }: { userRoles: RoleType[] }) {
  const pathname = usePathname();
  
  // Filter nav items based on the union of all assigned roles
  const filteredNav = navItems.filter(item => 
    item.roles.some(role => userRoles.includes(role))
  );

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center gap-2 font-bold text-primary">
          <FileText className="h-6 w-6" />
          <span className="group-data-[collapsible=icon]:hidden">OPEC OpsFlow</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>เมนูจัดการตามสิทธิ์</SidebarGroupLabel>
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