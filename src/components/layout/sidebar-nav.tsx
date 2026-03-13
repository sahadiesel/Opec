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
  Truck
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
    title: 'เมทริกซ์ตำแหน่งงาน (Positions)', 
    href: '/positions', 
    icon: Activity, 
    roles: ['system_admin', 'hr_manager', 'safety_officer'] 
  },
  { 
    title: 'ทะเบียนคนงาน (Workers)', 
    href: '/workers', 
    icon: HardHat, 
    roles: ['system_admin', 'hr_manager', 'hr_officer', 'operations_officer', 'safety_officer'] 
  },
  { 
    title: 'กลุ่มการส่งตัว (Waves)', 
    href: '/waves', 
    icon: Waves, 
    roles: ['system_admin', 'hr_manager', 'operations_officer'] 
  },
  { 
    title: 'การมอบหมายงาน (Assignments)', 
    href: '/assignments', 
    icon: UserPlus, 
    roles: ['system_admin', 'hr_manager', 'hr_officer', 'sales_officer', 'operations_officer'] 
  },
  { 
    title: 'การระดมพล (Mobilization)', 
    href: '/mobilization', 
    icon: Truck, 
    roles: ['system_admin', 'operations_officer', 'hr_officer', 'safety_officer'] 
  },
  // Payroll & Finance
  { 
    title: 'ลงเวลาทำงาน (Timesheets)', 
    href: '/timesheets', 
    icon: Clock, 
    roles: ['system_admin', 'payroll_officer', 'hr_officer', 'operations_officer'] 
  },
  { 
    title: 'การจ่ายเงิน (Payroll)', 
    href: '/payroll', 
    icon: CircleDollarSign, 
    roles: ['system_admin', 'payroll_officer', 'finance_officer'] 
  },
  // Store
  { 
    title: 'คลังอุปกรณ์ (Store / Inventory)', 
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
  
  const filteredNav = navItems.filter(item => 
    item.roles.some(role => userRoles.includes(role))
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
        <SidebarGroup>
          <SidebarGroupLabel>เมนูจัดการ (Navigation)</SidebarGroupLabel>
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
