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
import { ModuleKey, canView, isClient, canAccess, isStoreOfficer, isPayrollOfficer } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAccounting, isSimpleAdmin, isSimpleInternalEligible } from '@/lib/simple-tier-model';
import { UI_LABELS } from '@/lib/constants/labels';
import { HR_NAV_SUBSECTIONS } from '@/lib/navigation/hr-nav-items';
import { pathMatches, sidebarMatrixVisibilityForPath, canViewHrHubItem } from '@/lib/navigation/nav-access';

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

/** แยกหมวดบัญชี: ลูกหนี้ / เจ้าหนี้ / สมุดรายวัน — ไม่รวมเงินเดือน (อยู่ใน ACCOUNTING_PAYROLL_SUBSECTIONS) */
const ACCOUNTING_DOCUMENT_SUBSECTIONS: Array<{
  title: string;
  icon: ComponentType<{ className?: string }>;
  items: NavItem[];
}> = [
  {
    title: 'ลูกหนี้ — วางบิล / ใบกำกับ / ใบเสร็จ',
    icon: FileBadge,
    items: [
      { key: 'billing_notes', title: 'ใบวางบิลลูกหนี้ (Billing Notes)', href: '/billing-notes', icon: FileText },
      { key: 'tax_invoices', title: 'ใบกำกับภาษี (Tax Invoices)', href: '/tax-invoices', icon: FileBadge },
      { key: 'receipts', title: 'ใบเสร็จรับเงิน (Receipts)', href: '/receipts', icon: Receipt },
      { key: 'accounts_receivable', title: 'ลูกหนี้การค้า (AR)', href: '/accounts-receivable', icon: ArrowUpRight },
    ],
  },
  {
    title: 'เจ้าหนี้ — รับวางบิล / ตรวจจ่าย',
    icon: Inbox,
    items: [
      { key: 'ap_bills', title: 'รับวางบิลเจ้าหนี้ (AP Bills)', href: '/ap-bills', icon: Inbox },
      { key: 'accounts_payable', title: 'ตรวจสอบรายจ่าย (ใบรับวางบิล)', href: '/accounting/outgoing-review', icon: Banknote },
      { key: 'accounts_payable', title: 'เจ้าหนี้การค้า (AP)', href: '/accounts-payable', icon: ArrowDownLeft },
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

function sidebarMatrixVisibility(user: User, item: NavItem): boolean | null {
  return sidebarMatrixVisibilityForPath(user, item.href.split('#')[0]);
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
      {
        key: 'store_inventory',
        title: 'รับวางบิล (Vendor billing)',
        href: '/store/vendor-bills',
        icon: FileText,
      },
      {
        key: 'draft_invoices',
        title: 'ใบแจ้งหนี้ร่าง (เรียกเก็บ)',
        href: '/draft-invoices',
        icon: FileText,
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
      { key: 'client_portal', title: 'ประวัติกำลังพล (Personnel)', href: '/client-portal/waves', icon: HardHat },
      { key: 'client_portal', title: 'หลักฐานการลงเวลา (Activity)', href: '/client-portal/timesheets', icon: Clock },
      { key: 'client_portal', title: 'การเงินและวางบิล (Billing)', href: '/client-portal/billing', icon: FileBarChart },
    ],
  },
];

/** เมนูเฉพาะเจ้าหน้าที่คลัง: หน้าแรก = คลัง, ไม่มี HR/ขาย, เฉพาะคลัง–จัดซื้อ */
function navGroupsForUser(user: User): NavGroup[] {
  if (isPayrollOfficer(user)) {
    return navGroups.filter((g) => !g.label.startsWith('งานขายและสัญญา'));
  }
  if (!isStoreOfficer(user)) return navGroups;
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
            <span className="text-lg tracking-tight truncate leading-tight">OPEC OpsFlow</span>
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
              const byMatrix = sidebarMatrixVisibility(user, item);
              if (byMatrix !== null) return byMatrix;
              return canView(user, item.key, profile);
            };

            const documentSubs = ACCOUNTING_DOCUMENT_SUBSECTIONS.map((sub) => ({
              ...sub,
              visibleItems: sub.items.filter(filterNav),
            })).filter((s) => s.visibleItems.length > 0);

            const payrollSubs = ACCOUNTING_PAYROLL_SUBSECTIONS.map((sub) => ({
              ...sub,
              visibleItems: sub.items.filter(filterNav),
            })).filter((s) => s.visibleItems.length > 0);

            if (documentSubs.length === 0 && payrollSubs.length === 0) return null;

            return (
              <SidebarGroup key={group.label} className="py-2">
                <SidebarGroupLabel className="px-4 text-[9px] uppercase tracking-widest font-black text-muted-foreground/40 mb-1">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {documentSubs.map((sub) => {
                      const isSubActive = sub.visibleItems.some((it) => pathMatches(pathname, it.href));
                      return (
                        <Collapsible key={sub.title} defaultOpen={isSubActive} className="group">
                          <SidebarMenuItem>
                            <CollapsibleTrigger asChild>
                              <SidebarMenuButton tooltip={sub.title} className="transition-all duration-200 h-auto min-h-10 py-2">
                                <sub.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="font-semibold text-[11px] tracking-tight text-left leading-snug line-clamp-2">
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

          const staffingBasePaths = ['/waves', '/assignments', '/mobilization'];
          const storeBillingExactHrefs = ['/store', '/store/vendor-bills'];
          const staffingItems =
            group.label === 'งานปฏิบัติการ (Operations)'
              ? visibleItems.filter((item) => staffingBasePaths.includes(item.href.split('?')[0]))
              : [];
          const storeBillingItems =
            group.label === 'งานปฏิบัติการ (Operations)'
              ? visibleItems.filter((item) => storeBillingExactHrefs.includes(item.href.split('?')[0]))
              : [];
          const restItems =
            group.label === 'งานปฏิบัติการ (Operations)'
              ? visibleItems.filter(
                  (item) =>
                    !staffingBasePaths.includes(item.href.split('?')[0]) &&
                    !storeBillingExactHrefs.includes(item.href.split('?')[0]),
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
                              <span className="font-semibold text-xs tracking-tight">จัดคนงานตาม PO</span>
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
                          className={`transition-all duration-200 ${pathMatches(pathname, singleStoreBilling.href) ? 'font-bold' : ''}`}
                        >
                          <Link href={singleStoreBilling.href}>
                            <SingleStoreBillingIcon
                              className={`h-4 w-4 ${pathMatches(pathname, singleStoreBilling.href) ? 'text-primary' : 'text-muted-foreground'}`}
                            />
                            <span className="font-semibold text-xs tracking-tight">{singleStoreBilling.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ) : null}
                    {storeBillingItems.length > 1 ? (
                      <Collapsible defaultOpen={isStoreBillingOpen} className="group">
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton
                              tooltip="คลังอุปกรณ์และรับวางบิลคู่ค้า"
                              className="transition-all duration-200"
                            >
                              <Warehouse className="h-4 w-4 text-muted-foreground" />
                              <span className="font-semibold text-xs tracking-tight">คลัง / วางบิลคู่ค้า</span>
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
                          className={`transition-all duration-200 ${pathMatches(pathname, item.href) ? 'font-bold' : ''}`}
                        >
                          <Link href={item.href}>
                            <item.icon
                              className={`h-4 w-4 ${pathMatches(pathname, item.href) ? 'text-primary' : 'text-muted-foreground'}`}
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
                        className={`transition-all duration-200 ${pathMatches(pathname, item.href) ? 'font-bold' : ''}`}
                      >
                        <Link href={item.href}>
                          <item.icon
                            className={`h-4 w-4 ${pathMatches(pathname, item.href) ? 'text-primary' : 'text-muted-foreground'}`}
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
