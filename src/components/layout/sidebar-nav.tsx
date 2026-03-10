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
  ClipboardList
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
  { 
    title: 'แดชบอร์ด', 
    href: '/dashboard', 
    icon: LayoutDashboard, 
    roles: ['system_admin', 'sales_officer', 'hr_manager', 'hr_officer', 'payroll_officer', 'store_officer', 'finance_officer'] 
  },
  { 
    title: 'ผู้ใช้งานระบบ', 
    href: '/users', 
    icon: ShieldCheck, 
    roles: ['system_admin'] 
  },
  { 
    title: 'ตำแหน่งงาน', 
    href: '/positions', 
    icon: Briefcase, 
    roles: ['system_admin', 'hr_manager', 'sales_officer'] 
  },
  { 
    title: 'ข้อมูลคนงาน', 
    href: '/workers', 
    icon: UserSquare2, 
    roles: ['system_admin', 'hr_manager', 'hr_officer'] 
  },
  { 
    title: 'ใบรับรอง/ตรวจร่างกาย', 
    href: '/records', 
    icon: FileCheck, 
    roles: ['system_admin', 'hr_manager', 'hr_officer'] 
  },
  { 
    title: 'บันทึกการใช้งาน', 
    href: '/audit-logs', 
    icon: History, 
    roles: ['system_admin'] 
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
          <SidebarGroupLabel>เมนูหลัก</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.title}>
                    <Link href={item.href}>
                      <item.icon />
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