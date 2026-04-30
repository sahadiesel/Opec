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
  Coins,
  ArrowUpRight,
  ArrowDownLeft,
  BookOpen,
  UserSearch,
  FileBadge,
  PackageSearch,
  Inbox,
  Banknote,
  LockKeyhole,
  Settings,
  FileSignature,
  Hash,
  History,
  FileBarChart,
  Building2,
  FlaskConical,
  ChevronRight,
  Percent,
  Receipt,
  FileQuestion,
  Calculator,
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
import { ModuleKey, canView, isClient, canAccess, isStoreOfficer, isPayrollOfficer, getPrimaryLegacyRole } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAccounting, isSimpleAdmin, isSimpleInternalEligible } from '@/lib/simple-tier-model';
import { UI_LABELS } from '@/lib/constants/labels';
import { HR_NAV_SUBSECTIONS } from '@/lib/navigation/hr-nav-items';
import {
  pathMatches,
  sidebarMatrixVisibilityForPath,
  canViewHrHubItem,
  canViewHrPayrollFlowSubsection,
  canViewHrApprovalSubsection,
} from '@/lib/navigation/nav-access';
import { cn } from '@/lib/utils';

/** ข้อความเมนูหลัก sidebar — ตัวหนา ขนาดเล็กกว่าเดิม (text-xs) ให้พอดีกับความกว้างแถบ */
const SIDEBAR_MAIN_ITEM_TEXT = 'text-xs font-bold leading-snug tracking-tight text-foreground';

type NavAudience = 'internal' | 'client' | 'admin' | 'accounting';

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

/** แยกหมวดบัญชี: ระบบลูกหนี้ / ระบบเจ้าหนี้ / สมุดรายวัน — ไม่รวมเงินเดือน (อยู่ใน ACCOUNTING_PAYROLL_SUBSECTIONS) */
/** ลิงก์เดี่ยวใต้หัวข้อ «บัญชี» — ภาพรวมก่อนระบบลูกหนี้ */
const ACCOUNTING_DASHBOARD_ITEM: NavItem = {
  key: 'accounting_dashboard',
  title: 'แดชบอร์ดบัญชี',
  href: '/accounting/dashboard',
  icon: LayoutDashboard,
};

const ACCOUNTING_DOCUMENT_SUBSECTIONS: Array<{
  title: string;
  icon: ComponentType<{ className?: string }>;
  items: NavItem[];
}> = [
  {
    title: 'ระบบลูกหนี้',
    icon: FileBadge,
    items: [
      { key: 'draft_invoices', title: 'รายการใบแจ้งหนี้ ( Invoice )', href: '/draft-invoices', icon: FileText },
      { key: 'tax_invoices', title: 'ใบกำกับภาษี', href: '/tax-invoices', icon: FileBadge },
      { key: 'receipts', title: 'ใบเสร็จรับเงิน (ลูกค้า)', href: '/receipts', icon: Receipt },
      { key: 'accounts_receivable', title: 'ลูกหนี้การค้า (AR)', href: '/accounts-receivable', icon: ArrowUpRight },
    ],
  },
  {
    title: 'ระบบเจ้าหนี้',
    icon: Inbox,
    items: [
      { key: 'ap_bills', title: 'รับวางบิลเจ้าหนี้ (AP Bills)', href: '/ap-bills', icon: Inbox },
      { key: 'accounts_payable', title: 'ตรวจสอบรายจ่าย (ใบรับวางบิล)', href: '/accounting/outgoing-review', icon: Banknote },
      { key: 'accounts_payable', title: 'เจ้าหนี้การค้า (AP)', href: '/accounts-payable', icon: ArrowDownLeft },
      {
        key: 'withholding_tax_items',
        title: 'รายการหัก ณ ที่จ่าย',
        href: '/accounting/withholding-tax',
        icon: Percent,
      },
    ],
  },
  {
    title: 'สมุดบัญชีและธนาคาร',
    icon: BookOpen,
    items: [
      { key: 'cashbook', title: 'รายรับรายจ่าย (Cashbook)', href: '/cashbook', icon: BookOpen },
      { key: 'bank_accounts', title: 'บัญชีธนาคาร (Bank Accounts)', href: '/bank-accounts', icon: CreditCard },
    ],
  },
];

/** รายการเมนูใต้ «เงินเดือน (บัญชี)» — รองรับโฟลเดอร์ย่อย (เช่น เงินเดือนผู้บริหาร) */
type AccountingPayrollNavFolder = {
  kind: 'folder';
  folderKey: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: NavItem[];
};
type AccountingPayrollNavEntry = NavItem | AccountingPayrollNavFolder;

function isAccountingPayrollFolder(e: AccountingPayrollNavEntry): e is AccountingPayrollNavFolder {
  return 'kind' in e && e.kind === 'folder';
}

const ACCOUNTING_PAYROLL_SUBSECTIONS: Array<{
  title: string;
  icon: ComponentType<{ className?: string }>;
  entries: AccountingPayrollNavEntry[];
}> = [
  {
    title: 'เงินเดือน (บัญชี)',
    icon: Coins,
    entries: [
      { key: 'office_payroll', title: 'พนักงานออฟฟิศ (ตัดจ่าย)', href: '/office-payroll', icon: Users },
      { key: 'worker_payroll', title: 'ลูกจ้าง (คิวตัดจ่าย · ส่งถึงบัญชีแล้ว)', href: '/payroll/batches?payout=1', icon: Banknote },
      {
        kind: 'folder',
        folderKey: 'executive_payroll_folder',
        title: 'เงินเดือนผู้บริหาร',
        icon: LockKeyhole,
        children: [
          {
            key: 'executive_payroll',
            title: 'การคำนวณการจ่ายเงิน',
            href: '/accounting/executive-payroll',
            icon: Calculator,
          },
          {
            key: 'executive_payroll',
            title: 'รายชื่อผู้บริหาร',
            href: '/accounting/executive-payroll/staff',
            icon: UserSearch,
          },
        ],
      },
    ],
  },
];

function sidebarMatrixVisibility(user: User, item: NavItem): boolean | null {
  return sidebarMatrixVisibilityForPath(user, item.href.split('#')[0]);
}

/** ลำดับเมนูย่อยภายใต้ «การจัดการคลังสินค้า» — PR ก่อน แล้วค่อย PO (ใบสั่งซื้อสร้างจาก PR) */
const OPS_WAREHOUSE_SUB_PATHS = [
  '/store/purchase-requests',
  '/store',
  '/store/vendor-bills',
  '/vendors',
  '/purchases',
] as const;

/** แดชบอร์ดเดียว: ฝ่าย HR กด «แดชบอร์ด» ที่ Overview ไป /hr/dashboard (ไม่ซ้ำกับลิงก์ใน HR) */
function patchOverviewDashboardForHrPillar(user: User, groups: NavGroup[]): NavGroup[] {
  if (isStoreOfficer(user)) return groups;
  const rk = getPrimaryLegacyRole(user);
  if (!rk || !['hr_officer', 'payroll_officer', 'hr_manager'].includes(rk)) return groups;
  return groups.map((g) => {
    if (g.label !== 'ภาพรวม (Overview)') return g;
    return {
      ...g,
      items: g.items.map((it) =>
        it.key === 'overview_dashboard' && (it.href === '/' || it.href === '')
          ? { ...it, href: '/hr/dashboard' }
          : it
      ),
    };
  });
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
      { key: 'customers', title: 'สรุปฐานวางบิล (Client)', href: '/billing-client', icon: FileBarChart },
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
      {
        key: 'waves',
        title: 'คิวเติมโควต้า (PO Active)',
        href: '/po-active-quota-queue',
        icon: ClipboardList,
      },
      { key: 'waves', title: UI_LABELS.WAVES, href: '/waves', icon: Waves },
      { key: 'assignments', title: UI_LABELS.ASSIGNMENTS, href: '/assignments', icon: UserPlus },
      { key: 'mobilization', title: UI_LABELS.MOBILIZATION, href: '/mobilization', icon: Truck },
      { key: 'vendors', title: UI_LABELS.VENDORS, href: '/vendors', icon: Store },
      {
        key: 'store_inventory',
        title: 'การขออนุมัติสั่งซื้อ (PR)',
        href: '/store/purchase-requests',
        icon: FileQuestion,
      },
      { key: 'purchases', title: UI_LABELS.PURCHASES, href: '/purchases', icon: PackageSearch },
      { key: 'store_inventory', title: UI_LABELS.STORE, href: '/store', icon: Warehouse },
      {
        key: 'store_inventory',
        title: 'รับวางบิล (Vendor billing)',
        href: '/store/vendor-bills',
        icon: FileText,
      },
      {
        key: 'draft_invoices',
        title: 'รายการใบแจ้งหนี้ ( Invoice )',
        href: '/draft-invoices',
        icon: FileText,
      },
      {
        key: 'operations_petty_cash',
        title: 'เบิกจ่าย Petty Cash',
        href: '/operations/petty-cash',
        icon: Banknote,
      },
    ],
  },
  {
    label: 'บัญชี (Accounting)',
    audience: 'accounting',
    accountingStructured: true,
    items: [],
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
      { key: 'client_portal', title: 'ประวัติกำลังพล (Personnel)', href: '/client-portal/workers', icon: HardHat },
      { key: 'client_portal', title: 'หลักฐานการลงเวลา (Activity)', href: '/client-portal/timesheets', icon: Clock },
      { key: 'client_portal', title: 'การเงินและวางบิล (Billing)', href: '/client-portal/accounting?tab=invoices', icon: FileBarChart },
    ],
  },
];

/** เมนูเฉพาะเจ้าหน้าที่คลัง: หน้าแรก = คลัง, ไม่มี HR/ขาย, เฉพาะคลัง–จัดซื้อ */
function navGroupsForUser(user: User): NavGroup[] {
  if (isPayrollOfficer(user)) {
    return patchOverviewDashboardForHrPillar(
      user,
      navGroups.filter((g) => !g.label.startsWith('งานขายและสัญญา'))
    );
  }
  if (!isStoreOfficer(user)) {
    return patchOverviewDashboardForHrPillar(user, navGroups);
  }
  return navGroups
    .filter((g) => !g.hrStructured)
    .filter((g) => !g.label.startsWith('งานขายและสัญญา'))
    .map((g) => {
      if (g.label === 'ภาพรวม (Overview)') {
        return {
          ...g,
          items: [
            {
              key: 'store_inventory',
              title: 'หน้าหลัก (คลังอุปกรณ์)',
              href: '/store',
              icon: LayoutDashboard,
            },
          ],
        };
      }
      if (g.label === 'งานปฏิบัติการ (Operations)') {
        return {
          ...g,
          /* หน้าหลักไป /store อยู่แล้วที่ภาพรวม — ไม่ซ้ำลิงก์คลังที่นี่ */
          items: [
            {
              key: 'store_inventory',
              title: 'การขออนุมัติสั่งซื้อ (PR)',
              href: '/store/purchase-requests',
              icon: FileQuestion,
            },
            {
              key: 'store_inventory',
              title: 'รับวางบิล (Vendor billing)',
              href: '/store/vendor-bills',
              icon: FileText,
            },
            { key: 'vendors', title: UI_LABELS.VENDORS, href: '/vendors', icon: Store },
            { key: 'purchases', title: UI_LABELS.PURCHASES, href: '/purchases', icon: PackageSearch },
          ],
        };
      }
      return g;
    });
}

function canSeeGroup(group: NavGroup, user: User, admin: boolean): boolean {
  const clientUser = isClient(user);
  const acct = admin || isSimpleAccounting(user) || isSimpleAdmin(user);

  if (group.audience === 'admin') return admin;
  if (group.audience === 'accounting') return acct && !clientUser;
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
            <span className="text-base tracking-tight truncate leading-tight">OPEC OpsFlow</span>
            <span className="text-[8px] opacity-60 uppercase tracking-widest font-black truncate">Platform v2.0</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-4">
        {navGroupsForUser(user).map((group) => {
          if (!canSeeGroup(group, user, admin)) return null;

          if (group.accountingStructured) {
            const filterNav = (item: NavItem) => {
              if (admin) return true;
              if (isSimpleAccounting(user) && item.href.split('?')[0] === '/payroll/batches') return true;
              const byMatrix = sidebarMatrixVisibility(user, item);
              if (byMatrix !== null) return byMatrix;
              return canView(user, item.key, profile);
            };

            const documentSubs = ACCOUNTING_DOCUMENT_SUBSECTIONS.map((sub) => ({
              ...sub,
              visibleItems: sub.items.filter(filterNav),
            })).filter((s) => s.visibleItems.length > 0);

            const filterPayrollEntry = (entry: AccountingPayrollNavEntry): AccountingPayrollNavEntry | null => {
              if (isAccountingPayrollFolder(entry)) {
                const visibleChildren = entry.children.filter(filterNav);
                if (visibleChildren.length === 0) return null;
                return { ...entry, children: visibleChildren };
              }
              return filterNav(entry) ? entry : null;
            };

            const payrollSubs = ACCOUNTING_PAYROLL_SUBSECTIONS.map((sub) => ({
              ...sub,
              visibleEntries: sub.entries
                .map(filterPayrollEntry)
                .filter((e): e is AccountingPayrollNavEntry => e != null),
            })).filter((s) => s.visibleEntries.length > 0);

            if (documentSubs.length === 0 && payrollSubs.length === 0 && !filterNav(ACCOUNTING_DASHBOARD_ITEM)) {
              return null;
            }

            return (
              <SidebarGroup key={group.label} className="py-2">
                <SidebarGroupLabel className="px-4 text-[9px] uppercase tracking-widest font-black text-muted-foreground/40 mb-1">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {filterNav(ACCOUNTING_DASHBOARD_ITEM) && (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          asChild
                          isActive={pathMatches(pathname, ACCOUNTING_DASHBOARD_ITEM.href)}
                          tooltip="ภาพรวมลูกหนี้ เจ้าหนี้ รายรับ-จ่าย เงินเดือน และแจ้งชำระจากลูกค้า"
                          className="transition-all duration-200"
                        >
                          <Link href={ACCOUNTING_DASHBOARD_ITEM.href}>
                            <ACCOUNTING_DASHBOARD_ITEM.icon
                              className={`h-4 w-4 ${pathMatches(pathname, ACCOUNTING_DASHBOARD_ITEM.href) ? 'text-primary' : 'text-muted-foreground'}`}
                            />
                            <span className={SIDEBAR_MAIN_ITEM_TEXT}>{ACCOUNTING_DASHBOARD_ITEM.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}
                    {documentSubs.map((sub) => {
                      const isSubActive = sub.visibleItems.some((it) => pathMatches(pathname, it.href));
                      return (
                        <Collapsible key={sub.title} defaultOpen={isSubActive} className="group">
                          <SidebarMenuItem>
                            <CollapsibleTrigger asChild>
                              <SidebarMenuButton tooltip={sub.title} className="transition-all duration-200 h-auto min-h-10 py-2">
                                <sub.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className={cn(SIDEBAR_MAIN_ITEM_TEXT, 'text-left leading-snug line-clamp-2')}>
                                  {sub.title}
                                </span>
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
                    {payrollSubs.map((sub) => {
                      const isSubActive = sub.visibleEntries.some((entry) => {
                        if (isAccountingPayrollFolder(entry)) {
                          return entry.children.some((it) => pathMatches(pathname, it.href));
                        }
                        return pathMatches(pathname, entry.href);
                      });
                      return (
                        <Collapsible key={sub.title} defaultOpen={isSubActive} className="group">
                          <SidebarMenuItem>
                            <CollapsibleTrigger asChild>
                              <SidebarMenuButton tooltip={sub.title} className="transition-all duration-200">
                                <sub.icon className="h-4 w-4 text-muted-foreground" />
                                <span className={cn(SIDEBAR_MAIN_ITEM_TEXT, 'truncate')}>{sub.title}</span>
                                <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                              </SidebarMenuButton>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <SidebarMenuSub>
                                {sub.visibleEntries.map((entry) => {
                                  if (isAccountingPayrollFolder(entry)) {
                                    const folderOpen = entry.children.some((it) => pathMatches(pathname, it.href));
                                    const FolderIcon = entry.icon;
                                    return (
                                      <Collapsible
                                        key={entry.folderKey}
                                        defaultOpen={folderOpen}
                                        className="group/subfolder"
                                      >
                                        <SidebarMenuSubItem>
                                          <CollapsibleTrigger asChild>
                                            <SidebarMenuSubButton
                                              className="cursor-pointer text-xs font-bold"
                                              size="sm"
                                            >
                                              <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                              <span className="truncate">{entry.title}</span>
                                              <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/subfolder:rotate-90" />
                                            </SidebarMenuSubButton>
                                          </CollapsibleTrigger>
                                        </SidebarMenuSubItem>
                                        <CollapsibleContent>
                                          {entry.children.map((item) => {
                                            const active = pathMatches(pathname, item.href);
                                            return (
                                              <SidebarMenuSubItem key={`${item.key}-${item.href}`}>
                                                <SidebarMenuSubButton
                                                  asChild
                                                  isActive={active}
                                                  size="sm"
                                                  className="pl-6"
                                                >
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
                                        </CollapsibleContent>
                                      </Collapsible>
                                    );
                                  }
                                  const item = entry;
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
              visibleItems: sub.items.filter((item) => {
                if (sub.audienceOpsHrManagersOnly && !canViewHrApprovalSubsection(user, admin)) {
                  return false;
                }
                if (sub.audiencePayrollLeadsOnly && !canViewHrPayrollFlowSubsection(user, profile, admin)) {
                  return false;
                }
                return canViewHrHubItem(user, profile, admin, item);
              }),
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
                      if (sub.visibleItems.length === 1) {
                        const item = sub.visibleItems[0];
                        const active = pathMatches(pathname, item.href);
                        return (
                          <SidebarMenuItem key={sub.title}>
                            <SidebarMenuButton
                              asChild
                              isActive={active}
                              tooltip={`${sub.title} — ${sub.description}`}
                              className="transition-all duration-200"
                            >
                              <Link href={item.href}>
                                <item.icon
                                  className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                                />
                                <span className={SIDEBAR_MAIN_ITEM_TEXT}>{item.title}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      }
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
                                  <span className={cn(SIDEBAR_MAIN_ITEM_TEXT, 'line-clamp-2')}>{sub.title}</span>
                                  <span className="line-clamp-2 text-[10px] font-normal text-muted-foreground">
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
            const basePath = item.href.split('?')[0];
            if (isPayrollOfficer(user) && OPS_WAREHOUSE_SUB_PATHS.some((p) => p === basePath)) {
              return false;
            }
            if (
              item.href === '/' &&
              item.key === 'overview_dashboard' &&
              isSimpleInternalEligible(user) &&
              !isClient(user)
            ) {
              return true;
            }
            const byMatrix = sidebarMatrixVisibility(user, item);
            if (byMatrix !== null) return byMatrix;
            return canView(user, item.key, profile);
          });

          if (visibleItems.length === 0) return null;

          const staffingBasePaths = ['/po-active-quota-queue', '/waves', '/assignments', '/mobilization'];
          const warehousePathSet = new Set<string>(OPS_WAREHOUSE_SUB_PATHS);
          const staffingItems =
            group.label === 'งานปฏิบัติการ (Operations)'
              ? visibleItems.filter((item) => staffingBasePaths.includes(item.href.split('?')[0]))
              : [];
          const storeBillingItems =
            group.label === 'งานปฏิบัติการ (Operations)'
              ? OPS_WAREHOUSE_SUB_PATHS.map((path) =>
                  visibleItems.find((item) => item.href.split('?')[0] === path),
                ).filter((x): x is NavItem => x != null)
              : [];
          const restItems =
            group.label === 'งานปฏิบัติการ (Operations)'
              ? visibleItems.filter(
                  (item) =>
                    !staffingBasePaths.includes(item.href.split('?')[0]) &&
                    !warehousePathSet.has(item.href.split('?')[0]),
                )
              : visibleItems;

          if (group.label === 'งานปฏิบัติการ (Operations)') {
            const isStaffingOpen = staffingItems.some((it) => pathMatches(pathname, it.href));
            const isStoreBillingOpen = storeBillingItems.some((it) => pathMatches(pathname, it.href));
            const singleStoreBilling = storeBillingItems.length === 1 ? storeBillingItems[0] : null;
            const SingleStoreBillingIcon = singleStoreBilling?.icon;
            return (
              <SidebarGroup key={group.label} className="py-2">
                <SidebarGroupLabel className="px-4 text-[9px] uppercase tracking-widest font-black text-muted-foreground/40 mb-1">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {staffingItems.length > 0 ? (
                      <Collapsible defaultOpen={isStaffingOpen} className="group">
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton tooltip="Wave → มอบหมาย → เตรียมส่งตัว" className="transition-all duration-200">
                              <Waves className="h-4 w-4 text-muted-foreground" />
                              <span className={SIDEBAR_MAIN_ITEM_TEXT}>การจัดการ Manpower</span>
                              <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {staffingItems.map((item) => {
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
                    ) : null}
                    {singleStoreBilling && SingleStoreBillingIcon ? (
                      <SidebarMenuItem key={`${singleStoreBilling.key}-${singleStoreBilling.href}`}>
                        <SidebarMenuButton
                          asChild
                          isActive={pathMatches(pathname, singleStoreBilling.href)}
                          tooltip={singleStoreBilling.title}
                          className="transition-all duration-200"
                        >
                          <Link href={singleStoreBilling.href}>
                            <SingleStoreBillingIcon
                              className={`h-4 w-4 ${pathMatches(pathname, singleStoreBilling.href) ? 'text-primary' : 'text-muted-foreground'}`}
                            />
                            <span className={SIDEBAR_MAIN_ITEM_TEXT}>{singleStoreBilling.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ) : null}
                    {storeBillingItems.length > 1 ? (
                      <Collapsible defaultOpen={isStoreBillingOpen} className="group">
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton
                              tooltip="PR (ขออนุมัติ) · คลัง · รับวางบิล · คู่ค้า · ใบสั่งซื้อ (จาก PR)"
                              className="transition-all duration-200"
                            >
                              <Warehouse className="h-4 w-4 text-muted-foreground" />
                              <span className={SIDEBAR_MAIN_ITEM_TEXT}>การจัดการคลังสินค้า</span>
                              <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {storeBillingItems.map((item) => {
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
                    ) : null}
                    {restItems.map((item) => (
                      <SidebarMenuItem key={`${item.key}-${item.href}`}>
                        <SidebarMenuButton
                          asChild
                          isActive={pathMatches(pathname, item.href)}
                          tooltip={item.title}
                          className="transition-all duration-200"
                        >
                          <Link href={item.href}>
                            <item.icon
                              className={`h-4 w-4 ${pathMatches(pathname, item.href) ? 'text-primary' : 'text-muted-foreground'}`}
                            />
                            <span className={SIDEBAR_MAIN_ITEM_TEXT}>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          }

          return (
            <SidebarGroup key={group.label} className="py-2">
              <SidebarGroupLabel className="px-4 text-[9px] uppercase tracking-widest font-black text-muted-foreground/40 mb-1">
                {group.label}
              </SidebarGroupLabel>

              <SidebarGroupContent>
                <SidebarMenu>
                  {restItems.map((item) => (
                    <SidebarMenuItem key={`${item.key}-${item.href}`}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathMatches(pathname, item.href)}
                        tooltip={item.title}
                        className="transition-all duration-200"
                      >
                        <Link href={item.href}>
                          <item.icon
                            className={`h-4 w-4 ${pathMatches(pathname, item.href) ? 'text-primary' : 'text-muted-foreground'}`}
                          />
                          <span className={SIDEBAR_MAIN_ITEM_TEXT}>{item.title}</span>
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
