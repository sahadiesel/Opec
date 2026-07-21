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
  Landmark,
  FileText,
  Settings,
  ListChecks,
  Database,
  PackageSearch,
  CalendarCheck,
  HeartPulse,
  FileQuestion,
  Banknote,
  QrCode,
  Clock,
  CalendarOff,
  Percent,
} from 'lucide-react';
import type { ModuleKey } from '@/lib/permissions';

/** รายการเมนู HR — ใช้ทั้ง sidebar และตรวจสิทธิ์ตาม path */
export interface HrNavItem {
  key: ModuleKey;
  title: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * จัดการลงเวลา Kiosk / สรุป — เฉพาะกลุ่มงานจ่ายค่าจ้าง (payroll_officer · manager · admin)
   * ไม่ใช้สิทธิ์ operations_officer / timekeeper แม้มีโมดูล timesheets
   */
  payrollAttendanceManageOnly?: boolean;
  /**
   * เมนูใต้กลุ่ม Payroll ที่ผูกกับงานบัญชี (เช่น หัก ณ ที่จ่าย / ปกส.) —
   * เปิดให้ผู้กำกับ payroll (hr_manager · operations_manager · payroll_officer) + admin
   * โดยไม่ต้องอาศัยสิทธิ์ withholding_tax_items ในเมทริกซ์
   */
  payrollLeadOnly?: boolean;
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
  /**
   * ลงเวลารายวัน/รายเดือน — แสดงให้หัวหน้างานจ่ายค่าจ้าง + ops officer + เจ้าหน้าที่บันทึกเวลา (timekeeper)
   */
  audienceFieldOpsTimesheets?: boolean;
  /**
   * true = หมวดอนุมัติ (Manager) — เฉพาะ hr_manager / operations_manager (+ admin)
   * ไม่แสดงให้ payroll_officer / officer ทั่วไป
   */
  audienceOpsHrManagersOnly?: boolean;
}

export const HR_NAV_SUBSECTIONS: HrNavSubsection[] = [
  {
    title: 'การจ่ายค่าจ้าง (Payroll)',
    description: 'hr_manager · operations_manager · payroll_officer',
    icon: ListChecks,
    audiencePayrollLeadsOnly: true,
    items: [
      {
        key: 'cash_advances',
        title: 'รายการเบิกเงินล่วงหน้า',
        href: '/hr/cash-advances',
        icon: Banknote,
      },
      { key: 'hr_hub', title: 'ศูนย์งานจ่ายเงิน (Payroll Workbench)', href: '/hr/payroll-workbench', icon: LayoutGrid },
      { key: 'worker_payroll', title: 'งวดจ่ายลูกจ้าง (สร้างชุด · HR)', href: '/payroll/batches', icon: Coins },
      { key: 'office_payroll', title: 'งวดจ่ายพนักงานออฟฟิศ', href: '/office-payroll', icon: Building2 },
      {
        key: 'timesheets',
        title: 'จัดการการลงเวลา (Kiosk / สรุป)',
        href: '/hr/attendance',
        icon: Clock,
        payrollAttendanceManageOnly: true,
      },
      {
        key: 'timesheets',
        title: 'Kiosk ลงเวลา (QR)',
        href: '/hr/attendance/kiosk',
        icon: QrCode,
        payrollAttendanceManageOnly: true,
      },
      {
        key: 'hr_hub',
        title: 'การจัดการการลา (พนักงานออฟฟิศ)',
        href: '/hr/leaves',
        icon: CalendarOff,
        payrollAttendanceManageOnly: true,
      },
    ],
  },
  {
    title: 'หัก ณ ที่จ่าย / ปกส.',
    description: 'hr_manager · operations_manager · payroll_officer',
    icon: Percent,
    audiencePayrollLeadsOnly: true,
    items: [
      {
        key: 'withholding_tax_items',
        title: '1. หัก ณ ที่จ่าย (บุคลากร)',
        href: '/accounting/withholding-payroll',
        icon: FileText,
        payrollLeadOnly: true,
      },
      {
        key: 'withholding_tax_items',
        title: '2. จ่ายประกันสังคม',
        href: '/accounting/social-security-payroll',
        icon: ShieldCheck,
        payrollLeadOnly: true,
      },
    ],
  },
  {
    title: 'ลงเวลาและภารกิจหน้างาน',
    description:
      'ลงเวลารายวัน/รายเดือน — timekeeper · operations_officer · payroll lead',
    icon: Grid3X3,
    audienceFieldOpsTimesheets: true,
    items: [
      {
        key: 'timesheets',
        title: 'ลงเวลารายวัน(Auto/Manual)',
        href: '/timesheets',
        icon: Grid3X3,
      },
      { key: 'timesheets', title: 'สรุปลงเวลารายเดือน (Wave)', href: '/timesheets/wave-month', icon: CalendarDays },
    ],
  },
  {
    title: 'อนุมัติ (Approval)',
    description: 'Manager — ศูนย์อนุมัติแยกตามประเภท',
    icon: ShieldCheck,
    audienceOpsHrManagersOnly: true,
    items: [
      {
        key: 'hr_hub',
        title: 'ศูนย์อนุมัติ (Overview)',
        href: '/hr/approval-center',
        icon: ShieldCheck,
      },
      {
        key: 'hr_hub',
        title: 'Timesheet รอบเดือน — คิวรอตรวจ (จัดกลุ่มชุด PO Active)',
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
      {
        key: 'store_inventory',
        title: 'อนุมัติคำขอสั่งซื้อ (PR)',
        href: '/store/purchase-requests',
        icon: FileQuestion,
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
      { key: 'hr_hub', title: 'ทะเบียนธนาคาร', href: '/hr/bank-registry', icon: Landmark },
      { key: 'hr_hub', title: 'ทะเบียนโรงพยาบาล (สปส.)', href: '/hr/hospital-registry', icon: HeartPulse },
      { key: 'hr_hub', title: 'ตั้งค่า HR', href: '/hr/settings', icon: Settings },
    ],
  },
];

export function getFlattenedHrNavItems(): HrNavItem[] {
  return HR_NAV_SUBSECTIONS.flatMap((s) => s.items);
}
