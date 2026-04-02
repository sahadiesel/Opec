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
  RotateCcw,
  Grid3X3,
  FileBarChart,
  Database,
  Building2,
  FlaskConical,
  ChevronRight,
  Briefcase,
  LayoutGrid,
  ListChecks,
  Sheet,
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
import { ModuleKey, canView, canSeeHrPillarUi, isClient, canAccess } from '@/lib/permissions';
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
  /** บัญชี: รายการหลักใน `items` + หมวดเงินเดือนย่อย */
  accountingStructured?: boolean;
}

/**
 * HR-D1: เมนูตามงานที่ต้องทำ — 3 โซน (เตรียมจ่าย / อนุมัติ / ทะเบียน)
 * คงการแยก Office | Worker ในรายการย่อย (สอดคล้อง HR-D3)
 */
const HR_NAV_SUBSECTIONS: Array<{
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  items: NavItem[];
}> = [
  {
    title: 'เตรียมจ่าย (Preparation)',
    description: 'HR Officer · งานประจำวัน',
    icon: ListChecks,
    items: [
      { key: 'hr_hub', title: 'ศูนย์งานจ่ายเงิน (Payroll Workbench)', href: '/hr/payroll-workbench', icon: LayoutGrid },
      { key: 'timesheets', title: 'คีย์ Timesheet (Wave Board)', href: '/timesheets/wave-board', icon: Grid3X3 },
      { key: 'timesheets', title: 'คีย์ทั้ง Wave (Excel)', href: '/timesheets/wave-excel', icon: Sheet },
      { key: 'timesheets', title: 'ตรวจ Timesheet รายวัน', href: '/timesheets/daily', icon: Clock },
      { key: 'worker_payroll', title: 'งวดจ่ายลูกจ้าง (Batches)', href: '/payroll/batches', icon: Coins },
      { key: 'worker_payroll', title: 'รอบจ่ายและตัดยอด (งวดคนงาน)', href: '/payroll/periods', icon: CalendarDays },
      { key: 'office_payroll', title: 'งวดจ่ายพนักงานออฟฟิศ', href: '/office-payroll', icon: Building2 },
    ],
  },
  {
    title: 'อนุมัติ (Approval)',
    description: 'HR Manager · ตรวจและอนุมัติ',
    icon: ShieldCheck,
    items: [
      { key: 'hr_hub', title: 'ศูนย์อนุมัติ Payroll (Approval Center)', href: '/hr/payroll-approval', icon: ShieldCheck },
      { key: 'hr_hub', title: 'รายการรออนุมัติ', href: '/hr/payroll-approval#pending', icon: ClipboardList },
      { key: 'hr_hub', title: 'คำขอแก้ไข (Corrections)', href: '/hr/dashboard#hr-action-queue', icon: RotateCcw },
    ],
  },
  {
    title: 'ทะเบียน (Master Data)',
    description: 'Officer + Manager · ไม่ใช่งานประจำวัน',
    icon: Database,
    items: [
      { key: 'workers', title: 'ทะเบียนลูกจ้าง', href: '/workers', icon: HardHat },
      { key: 'office_staff', title: 'ทะเบียนพนักงานออฟฟิศ', href: '/office-staff', icon: UserSearch },
      { key: 'positions', title: 'ตำแหน่งงาน', href: '/positions', icon: Activity },
      { key: 'workers', title: 'เอกสารบุคลากร (Catalog)', href: '/worker-document-catalog', icon: FileText },
      { key: 'hr_hub', title: 'ตั้งค่า HR', href: '/hr/settings', icon: Settings },
      { key: 'hr_hub', title: 'แดชบอร์ด HR (ภาพรวม)', href: '/hr/dashboard', icon: Briefcase },
    ],
  },
];

const ACCOUNTING_MAIN_ITEMS: NavItem[] = [
  { key: 'billing_notes', title: 'ใบวางบิลลูกหนี้ (Billing Notes)', href: '/billing-notes', icon: FileText },
  { key: 'tax_invoices', title: 'ใบกำกับภาษี (Tax Invoices)', href: '/tax-invoices', icon: FileBadge },
  { key: 'receipts', title: 'ใบเสร็จรับเงิน (Receipts)', href: '/receipts', icon: Receipt },
  { key: 'ap_bills', title: 'รับวางบิลเจ้าหนี้ (AP Bills)', href: '/ap-bills', icon: Inbox },
  { key: 'accounts_receivable', title: 'ลูกหนี้การค้า (AR)', href: '/accounts-receivable', icon: ArrowUpRight },
  { key: 'accounts_payable', title: 'เจ้าหนี้การค้า (AP)', href: '/accounts-payable', icon: ArrowDownLeft },
  { key: 'cashbook', title: 'รายรับรายจ่าย (Cashbook)', href: '/cashbook', icon: BookOpen },
  { key: 'bank_accounts', title: 'บัญชีธนาคาร (Bank Accounts)', href: '/bank-accounts', icon: CreditCard },
];

const ACCOUNTING_PAYROLL_SUBSECTIONS: Array<{
  title: string;
  icon: ComponentType<{ className?: string }>;
  items: NavItem[];
}> = [
  {
    title: 'เงินเดือน (บัญชี)',
    icon: Coins,
    items: [
      { key: 'office_payroll', title: 'พนักงานสำนักงาน', href: '/office-payroll', icon: Users },
      { key: 'executive_payroll', title: 'ผู้บริหาร (ความลับ)', href: '/accounting/executive-payroll', icon: LockKeyhole },
    ],
  },
];

function pathMatches(pathname: string, href: string): boolean {
  const base = href.split('#')[0];
  if (pathname === base) return true;
  if (base !== '/' && pathname.startsWith(`${base}/`)) return true;
  return false;
}

function resolveMatrixModuleForSidebarItem(item: NavItem): string | null {
  if (item.href === '/workers') return 'workers';
  if (item.href === '/worker-document-catalog') return 'worker_documents';
  if (item.href === '/assignments') return 'assignments';
  if (item.href === '/mobilization') return 'mobilization';
  if (
    item.href === '/timesheets/wave-board' ||
    item.href === '/timesheets/wave-excel' ||
    item.href === '/timesheets/daily'
  ) {
    return 'timesheets';
  }
  if (item.href === '/payroll/batches') return 'worker_payroll';
  if (item.href === '/payroll/periods') return 'payroll_runs';
  return null;
}

function sidebarMatrixVisibility(user: User, item: NavItem): boolean | null {
  const role = user.assignedRoleKey;
  if (!role) return null;

  // Incremental rollout: only enforce matrix visibility for these roles.
  if (!['system_admin', 'hr_officer', 'payroll_officer', 'operation_manager'].includes(role)) {
    return null;
  }

  const module = resolveMatrixModuleForSidebarItem(item);
  if (!module) return null; // keep legacy behavior for menus not mapped yet

  return canAccess(user, module, 'view');
}

/** หน้า /hr/* เฉพาะผู้ที่มีโมดูลแผนกบุคคลอย่างน้อยหนึ่งรายการ (ไม่โชว์ให้ store / sales ล้วน) */
function canViewHrHubItem(
  user: User,
  profile: PermissionProfile | null,
  admin: boolean,
  item: NavItem
): boolean {
  if (admin) return true;
  const byMatrix = sidebarMatrixVisibility(user, item);
  if (byMatrix !== null) return byMatrix;
  if (canView(user, item.key, profile)) return true;
  if (item.href.startsWith('/hr/')) {
    return canSeeHrPillarUi(user, profile);
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
    label: 'งานบุคคล (HR — โต๊ะทำงาน)',
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
    accountingStructured: true,
    items: ACCOUNTING_MAIN_ITEMS,
  },
  {
    label: 'การจัดการระบบ (Administration)',
    audience: 'admin',
    items: [
      { key: 'system_admin', title: 'จัดการผู้ใช้ (User Access)', href: '/users', icon: ShieldCheck },
      { key: 'system_admin', title: 'ตรวจสอบความปลอดภัย (Security)', href: '/system-admin/security-check', icon: ShieldAlert },
      { key: 'document_numbering', title: 'เลขที่เอกสาร (Numbering)', href: '/system-admin/numbering', icon: Hash },
      { key: 'system_admin', title: 'หัวเอกสารบริษัท (Document Header)', href: '/system-admin/document-profile', icon: Building2 },
      { key: 'system_admin', title: 'ตั้งค่าแผงตรวจสารเสพติด', href: '/system-admin/drug-test-panel', icon: FlaskConical },
      { key: 'audit_logs', title: 'ประวัติกิจกรรม (Audit Logs)', href: '/system-admin/audit-logs', icon: History },
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

          if (group.accountingStructured) {
            const visibleMain = group.items.filter((item) => {
              if (admin) return true;
              const byMatrix = sidebarMatrixVisibility(user, item);
              if (byMatrix !== null) return byMatrix;
              return canView(user, item.key, profile);
            });
            const payrollSubs = ACCOUNTING_PAYROLL_SUBSECTIONS.map((sub) => ({
              ...sub,
              visibleItems: sub.items.filter((item) => {
                if (admin) return true;
                const byMatrix = sidebarMatrixVisibility(user, item);
                if (byMatrix !== null) return byMatrix;
                return canView(user, item.key, profile);
              }),
            })).filter((s) => s.visibleItems.length > 0);

            if (visibleMain.length === 0 && payrollSubs.length === 0) return null;

            return (
              <SidebarGroup key={group.label} className="py-2">
                <SidebarGroupLabel className="px-4 text-[9px] uppercase tracking-widest font-black text-muted-foreground/40 mb-1">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleMain.map((item) => {
                      const active = pathMatches(pathname, item.href);
                      return (
                        <SidebarMenuItem key={`${item.key}-${item.href}`}>
                          <SidebarMenuButton
                            asChild
                            isActive={active}
                            tooltip={item.title}
                            className={`transition-all duration-200 ${active ? 'font-bold' : ''}`}
                          >
                            <Link href={item.href}>
                              <item.icon
                                className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                              />
                              <span className="font-semibold text-xs tracking-tight">{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                    {payrollSubs.map((sub) => {
                      const isSubActive = sub.visibleItems.some((it) => pathMatches(pathname, it.href));
                      return (
                        <Collapsible key={sub.title} defaultOpen={isSubActive} className="group">
                          <SidebarMenuItem>
                            <CollapsibleTrigger asChild>
                              <SidebarMenuButton tooltip={sub.title} className="transition-all duration-200">
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
                                tooltip={`${sub.title} — ${sub.description}`}
                                className="h-auto min-h-10 py-2 transition-all duration-200"
                              >
                                <sub.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div className="grid min-w-0 flex-1 gap-0.5 pr-1 text-left leading-tight">
                                  <span className="line-clamp-2 text-[11px] font-semibold tracking-tight text-foreground">
                                    {sub.title}
                                  </span>
                                  <span className="line-clamp-2 text-[9px] font-normal text-muted-foreground">
                                    {sub.description}
                                  </span>
                                </div>
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

          const visibleItems = group.items.filter((item) => {
            if (admin) return true;
            const byMatrix = sidebarMatrixVisibility(user, item);
            if (byMatrix !== null) return byMatrix;
            return canView(user, item.key, profile);
          });

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
