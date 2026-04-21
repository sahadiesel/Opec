import type { ComponentType } from 'react';
import {
  LayoutGrid,
  Grid3X3,
  Coins,
  CalendarDays,
  Building2,
  ShieldCheck,
  ClipboardList,
  HardHat,
  UserSearch,
  Activity,
  FileText,
  Settings,
  Briefcase,
  ListChecks,
  Database,
  PackageSearch,
  CalendarCheck,
} from 'lucide-react';
import type { ModuleKey } from '@/lib/permissions';

/** รายการเมนู HR — ใช้ทั้ง sidebar และตรวจสิทธิ์ตาม path */
export interface HrNavItem {
  key: ModuleKey;
  title: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

export interface HrNavSubsection {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  items: HrNavItem[];
  /**
   * true = แสดงหมวดนี้เฉพาะ hr_manager, operations_manager, payroll_officer และแอดมิน
   * (ไม่ใช่แค่สิทธิ์โมดูลทั่วไป — ให้สอดคล้องกับการจ่ายค่าจ้างเป็นหลัก)
   */
  audiencePayrollLeadsOnly?: boolean;
}

export const HR_NAV_SUBSECTIONS: HrNavSubsection[] = [
  {
    title: 'ภาพรวม',
    description: 'Dashboard — จุดเริ่มงาน HR',
    icon: Briefcase,
    items: [{ key: 'hr_hub', title: 'แดชบอร์ด HR (ภาพรวม)', href: '/hr/dashboard', icon: Briefcase }],
  },
  {
    title: 'การจ่ายค่าจ้าง (Payroll)',
    description: 'hr_manager · operations_manager · payroll_officer',
    icon: ListChecks,
    audiencePayrollLeadsOnly: true,
    items: [
      { key: 'hr_hub', title: 'ศูนย์งานจ่ายเงิน (Payroll Workbench)', href: '/hr/payroll-workbench', icon: LayoutGrid },
      {
        key: 'timesheets',
        title: 'ลงเวลา (ภาพรวม PO / Wave → เปิด Wave Board)',
        href: '/timesheets',
        icon: Grid3X3,
      },
      { key: 'timesheets', title: 'สรุปลงเวลารายเดือน (Wave)', href: '/timesheets/wave-month', icon: CalendarDays },
      { key: 'worker_payroll', title: 'งวดจ่ายลูกจ้าง (Batches)', href: '/payroll/batches', icon: Coins },
      { key: 'worker_payroll', title: 'รอบจ่ายและตัดยอด (งวดคนงาน)', href: '/payroll/periods', icon: CalendarDays },
      { key: 'office_payroll', title: 'งวดจ่ายพนักงานออฟฟิศ', href: '/office-payroll', icon: Building2 },
    ],
  },
  {
    title: 'อนุมัติ (Approval)',
    description: 'Manager — ศูนย์อนุมัติแยกตามประเภท',
    icon: ShieldCheck,
    items: [
      {
        key: 'hr_hub',
        title: 'ศูนย์อนุมัติ (Overview)',
        href: '/hr/approval-center',
        icon: ShieldCheck,
      },
      {
        key: 'hr_hub',
        title: 'Timesheet รอบเดือน (Wave) — คิวรอตรวจ',
        href: '/hr/timesheet-month-approval',
        icon: CalendarCheck,
      },
      {
        key: 'hr_hub',
        title: 'อนุมัติ Payroll งวดจ่าย',
        href: '/hr/payroll-approval',
        icon: Coins,
      },
      {
        key: 'purchases',
        title: 'อนุมัติใบสั่งซื้อจัดซื้อ (สโตร์)',
        href: '/purchases',
        icon: PackageSearch,
      },
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
      { key: 'worker_documents', title: 'เอกสารบุคลากร (Catalog)', href: '/worker-document-catalog', icon: FileText },
      { key: 'hr_hub', title: 'ตั้งค่า HR', href: '/hr/settings', icon: Settings },
    ],
  },
];

export function getFlattenedHrNavItems(): HrNavItem[] {
  return HR_NAV_SUBSECTIONS.flatMap((s) => s.items);
}
