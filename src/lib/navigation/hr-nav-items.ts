import type { ComponentType } from 'react';
import {
  LayoutGrid,
  Grid3X3,
  Sheet,
  Clock,
  Coins,
  CalendarDays,
  Building2,
  ShieldCheck,
  ClipboardList,
  RotateCcw,
  HardHat,
  UserSearch,
  Activity,
  FileText,
  Settings,
  Briefcase,
  ListChecks,
  Database,
} from 'lucide-react';
import type { ModuleKey } from '@/lib/permissions';

/** รายการเมนู HR — ใช้ทั้ง sidebar และตรวจสิทธิ์ตาม path */
export interface HrNavItem {
  key: ModuleKey;
  title: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

export const HR_NAV_SUBSECTIONS: Array<{
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  items: HrNavItem[];
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
      { key: 'worker_documents', title: 'เอกสารบุคลากร (Catalog)', href: '/worker-document-catalog', icon: FileText },
      { key: 'hr_hub', title: 'ตั้งค่า HR', href: '/hr/settings', icon: Settings },
      { key: 'hr_hub', title: 'แดชบอร์ด HR (ภาพรวม)', href: '/hr/dashboard', icon: Briefcase },
    ],
  },
];

export function getFlattenedHrNavItems(): HrNavItem[] {
  return HR_NAV_SUBSECTIONS.flatMap((s) => s.items);
}
