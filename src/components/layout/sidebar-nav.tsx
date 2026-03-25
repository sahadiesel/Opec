'use client';

import type { ComponentType } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  ClipboardList,
  ShoppingCart,
  UserPlus,
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
  Settings,
  FileSignature,
  Hash,
  CalendarDays,
  History,
  Grid3X3,
  Lock,
  FileBarChart,
  Database,
  Building2,
  FlaskConical,
  ChevronRight,
  Briefcase,
  LayoutGrid,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import { User, PermissionProfile } from '@/lib/types';
import { ModuleKey, canView, isClient } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { UI_LABELS } from '@/lib/constants/labels';

type NavAudience = 'internal' | 'client' | 'admin';

interface NavItem {
  key: ModuleKey;
  title: string;
  href: string;
  icon: any;
}

interface NavGroup {
  label: string;
  audience: NavAudience;
  items: NavItem[];
  /** แผนกบุคคล: แสดงเมนูแบบหมวดย่อย (collapsible) — รายการใน `items` ไม่ใช้ */
  hrStructured?: boolean;
}

/** เมนู HR — ลำดับและคำอธิบายใช้งานจริง */
const HR_NAV_SUBSECTIONS: Array<{
  title: string;
  icon: ComponentType<{ className?: string }>;
  items: NavItem[];
}> = [
  {
    title: 'ศูนย์กลาง HR',
    icon: LayoutGrid,
    items: [
      { key: 'hr_hub', title: 'แดชบอร์ด HR', href: '/hr/dashboard', icon: Briefcase },
      { key: 'hr_hub', title: 'ตั้งค่า HR (ภาษี ประกันสังคม)', href: '/hr/settings', icon: Settings },
    ],
  },
  {
    title: 'ทะเบียนบุคลากร',
    icon: Users,
    items: [
      { key: 'workers', title: 'ลูกจ้าง / คนงาน (Workers)', href: '/workers', icon: HardHat },
      { key: 'office_staff', title: 'พนักงานสำนักงาน (Office Staff)', href: '/office-staff', icon: UserSearch },
      { key: 'positions', title: 'ตำแหน่งงาน (Positions)', href: '/positions', icon: Activity },
      { key: 'workers', title: 'รายการเอกสารกลาง (Document Catalog)', href: '/worker-document-catalog', icon: FileText },
    ],
  },
  {
    title: 'ลงเวลา (คนงานสนาม)',
    icon: Clock,
    items: [
      { key: 'timesheets', title: 'ลงเวลาแบบกลุ่ม (Wave Daily Board)', href: '/timesheets/wave-board', icon: Grid3X3 },
      { key: 'timesheets', title: 'ประวัติลงเวลารายวัน', href: '/timesheets/daily', icon: Clock },
    ],
  },
  {
    title: 'จ่ายเงินเดือน (Payroll)',
    icon: Coins,
    items: [
      { key: 'office_payroll', title: 'จ่ายเงินเดือนพนักงาน (Office)', href: '/office-payroll', icon: Coins },
      { key: 'worker_payroll', title: 'จ่ายเงินเดือนลูกจ้าง (Worker Batches)', href: '/payroll/batches', icon: Coins },
      { key: 'worker_payroll', title: 'งวด / รอบบัญชี (Periods — คนงาน)', href: '/payroll/periods', icon: CalendarDays },
    ],
  },
];

function pathMatches(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href !== '/' && pathname.startsWith(`${href}/`)) return true;
  return false;
}

/** หน้า /hr/* ให้ผู้มีสิทธิ์ HR ใดๆ เห็นได้ แม้โปรไฟล์เก่ายังไม่มี key hr_hub */
function canViewHrHubItem(
  user: User,
  profile: PermissionProfile | null,
  admin: boolean,
  item: NavItem
): boolean {
  if (admin) return true;
  if (canView(user, item.key, profile)) return true;
  if (item.href.startsWith('/hr/')) {
    return (
      canView(user, 'workers', profile) ||
      canView(user, 'worker_payroll', profile) ||
      canView(user, 'office_payroll', profile) ||
      canView(user, 'office_staff', profile) ||
      canView(user, 'timesheets', profile)
    );
  }
  return false;
}

const navGroups: NavGroup[] = [
  {
    label: 'ภาพรวม (Overview)',
    audience: 'internal',
    items: [{ key: 'overview_dashboard', title: UI_LABELS.DASHBOARD, href: '/', icon: LayoutDashboard }],
  },
  {
    label: 'งานขายและสัญญา (Commercial)',
    audience: 'internal',
    items: [
      { key: 'customers', title: UI_LABELS.CUSTOMERS, href: '/customers', icon: Users },
      { key: 'quotations', title: UI_LABELS.QUOTATIONS, href: '/quotations', icon: FileSignature },
      { key: 'main_contracts', title: UI_LABELS.MAIN_CONTRACTS, href: '/main-contracts', icon: ClipboardList },
      { key: 'customer_pos', title: UI_LABELS.CUSTOMER_POS, href: '/purchase-orders', icon: ShoppingCart },
    ],
  },
  {
    label: 'บุคคลและเงินเดือน (HR & Payroll)',
    audience: 'internal',
    hrStructured: true,
    items: [],
  },
  {
    label: 'งานปฏิบัติการ (Operations)',
    audience: 'internal',
    items: [
      { key: 'waves', title: UI_LABELS.WAVES, href: '/waves', icon: Waves },
      { key: 'assignments', title: UI_LABELS.ASSIGNMENTS, href: '/assignments', icon: UserPlus },
      { key: 'mobilization', title: UI_LABELS.MOBILIZATION, href: '/mobilization', icon: Truck },
      { key: 'vendors', title: UI_LABELS.VENDORS, href: '/vendors', icon: Store },
      { key: 'purchases', title: UI_LABELS.PURCHASES, href: '/purchases', icon: PackageSearch },
      { key: 'store_inventory', title: UI_LABELS.STORE, href: '/store', icon: Warehouse },
    ],
  },
  {
    label: 'การเงินและบัญชี (Finance & Accounting)',
    audience: 'internal',
    items: [
      { key: 'billing_notes', title: 'ใบวางบิลลูกหนี้ (Billing Notes)', href: '/billing-notes', icon: FileText },
      { key: 'tax_invoices', title: 'ใบกำกับภาษี (Tax Invoices)', href: '/tax-invoices', icon: FileBadge },
      { key: 'receipts', title: 'ใบเสร็จรับเงิน (Receipts)', href: '/receipts', icon: Receipt },
      { key: 'ap_bills', title: 'รับวางบิลเจ้าหนี้ (AP Bills)', href: '/ap-bills', icon: Inbox },
      { key: 'accounts_receivable', title: 'ลูกหนี้การค้า (AR)', href: '/accounts-receivable', icon: ArrowUpRight },
      { key: 'accounts_payable', title: 'เจ้าหนี้การค้า (AP)', href: '/accounts-payable', icon: ArrowDownLeft },
      { key: 'cashbook', title: 'รายรับรายจ่าย (Cashbook)', href: '/cashbook', icon: BookOpen },
      { key: 'bank_accounts', title: 'บัญชีธนาคาร (Bank Accounts)', href: '/bank-accounts', icon: CreditCard },
    ],
  },
  {
    label: 'การจัดการระบบ (Administration)',
    audience: 'admin',
    items: [
      { key: 'system_admin', title: 'จัดการผู้ใช้/ระบบ (User Access)', href: '/users', icon: ShieldCheck },
      { key: 'system_admin', title: 'การเข้าใช้งานของลูกค้า', href: '/system-admin/customer-portal', icon: Lock },
      { key: 'system_admin', title: 'เมทริกซ์สิทธิ์ (Advanced)', href: '/system-admin/permissions', icon: LockKeyhole },
      { key: 'system_admin', title: 'ตรวจสอบความปลอดภัย (Security)', href: '/system-admin/security-check', icon: ShieldAlert },
      { key: 'document_numbering', title: 'เลขที่เอกสาร (Numbering)', href: '/system-admin/numbering', icon: Hash },
      { key: 'system_admin', title: 'หัวเอกสารบริษัท (Document Header)', href: '/system-admin/document-profile', icon: Building2 },
      { key: 'system_admin', title: 'ตั้งค่าแผงตรวจสารเสพติด', href: '/system-admin/drug-test-panel', icon: FlaskConical },
      { key: 'audit_logs', title: 'ประวัติกิจกรรม (Audit Logs)', href: '/system-admin/audit-logs', icon: History },
      { key: 'system_admin', title: 'Migration สิทธิ์ (User Auth)', href: '/system-admin/user-migration', icon: Database },
    ],
  },
  {
    label: 'ลูกค้า (Project Portal)',
    audience: 'client',
    items: [
      { key: 'client_portal', title: 'หน้าหลัก (Dashboard)', href: '/client-portal/dashboard', icon: LayoutDashboard },
      { key: 'client_portal', title: 'ประวัติกำลังพล (Personnel)', href: '/client-portal/waves', icon: HardHat },
      { key: 'client_portal', title: 'หลักฐานการลงเวลา (Activity)', href: '/client-portal/timesheets', icon: Clock },
      { key: 'client_portal', title: 'การเงินและวางบิล (Billing)', href: '/client-portal/billing', icon: FileBarChart },
    ],
  },
];

function canSeeGroup(group: NavGroup, user: User, admin: boolean): boolean {
  const clientUser = isClient(user);

  if (group.audience === 'admin') return admin;
  if (group.audience === 'client') return clientUser;
  if (group.audience === 'internal') return !clientUser;

  return false;
}

export function SidebarNav({
  user,
  profiles,
}: {
  user: User;
  profiles?: PermissionProfile[] | null;
}) {
  const pathname = usePathname();
  const admin = isSystemAdmin(user);
  const profile = profiles?.[0] ?? null;

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
          if (!canSeeGroup(group, user, admin)) return null;

          if (group.hrStructured) {
            const subsections = HR_NAV_SUBSECTIONS.map((sub) => ({
              ...sub,
              visibleItems: sub.items.filter((item) => canViewHrHubItem(user, profile, admin, item)),
            })).filter((s) => s.visibleItems.length > 0);

            if (subsections.length === 0) return null;

            return (
              <SidebarGroup key={group.label} className="py-2">
                <SidebarGroupLabel className="px-4 text-[9px] uppercase tracking-widest font-black text-muted-foreground/40 mb-1">
                  {group.label}
                </SidebarGroupLabel>

                <SidebarGroupContent>
                  <SidebarMenu>
                    {subsections.map((sub) => {
                      const isSubActive = sub.visibleItems.some((it) => pathMatches(pathname, it.href));
                      return (
                        <Collapsible key={sub.title} defaultOpen={isSubActive} className="group">
                          <SidebarMenuItem>
                            <CollapsibleTrigger asChild>
                              <SidebarMenuButton
                                tooltip={sub.title}
                                className="transition-all duration-200"
                              >
                                <sub.icon className="h-4 w-4 text-muted-foreground" />
                                <span className="font-semibold text-xs tracking-tight truncate">{sub.title}</span>
                                <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                              </SidebarMenuButton>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <SidebarMenuSub>
                                {sub.visibleItems.map((item) => {
                                  const active = pathMatches(pathname, item.href);
                                  return (
                                    <SidebarMenuSubItem key={`${item.key}-${item.href}`}>
                                      <SidebarMenuSubButton asChild isActive={active} size="sm">
                                        <Link href={item.href}>
                                          <item.icon
                                            className={`h-3.5 w-3.5 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                                          />
                                          <span>{item.title}</span>
                                        </Link>
                                      </SidebarMenuSubButton>
                                    </SidebarMenuSubItem>
                                  );
                                })}
                              </SidebarMenuSub>
                            </CollapsibleContent>
                          </SidebarMenuItem>
                        </Collapsible>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          }

          const visibleItems = group.items.filter((item) => admin || canView(user, item.key, profile));

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
                          <item.icon
                            className={`h-4 w-4 ${pathname === item.href ? 'text-primary' : 'text-muted-foreground'}`}
                          />
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
