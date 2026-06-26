/**
 * Single source of truth สำหรับ "กลุ่มเมนู → เมนูหลัก → moduleKey"
 *
 * ใช้ใน `/system-admin/menu-permissions` เพื่อแสดงเมทริกซ์สิทธิ์ตามเมนู UI
 * โดยรวมเฉพาะ "เมนูหลักของแต่ละกลุ่ม" (ไม่ลงเมนูย่อย — ถ้าไม่มีสิทธิ์เข้าเมนูหลักก็ไม่เข้าเมนูย่อยโดยปริยาย)
 *
 * รายการนี้สะท้อนโครงสร้างใน `src/components/layout/sidebar-nav.tsx`
 */

import type { ModuleKey } from '@/lib/permissions';

export interface MenuPermissionItem {
  /** Module key ที่ใช้ดึงสิทธิ์ผ่าน `getPermissions()` */
  moduleKey: ModuleKey;
  /** ชื่อเมนูที่ผู้ใช้เห็นใน sidebar */
  label: string;
  /** path หลักของเมนู (ไว้แสดงใต้ชื่อเป็น breadcrumb สั้น ๆ) */
  path?: string;
  /** หมายเหตุพิเศษ (เช่น "เมนูย่อย: payroll runs, payslips ฯลฯ") */
  note?: string;
}

export interface MenuPermissionGroup {
  /** ชื่อกลุ่มที่ผู้ใช้เห็นใน sidebar */
  label: string;
  /** กลุ่มเป้าหมาย */
  audience: 'internal' | 'admin' | 'accounting' | 'client';
  /** เมนูหลักในกลุ่มนี้ */
  items: MenuPermissionItem[];
}

export const MENU_PERMISSION_GROUPS: MenuPermissionGroup[] = [
  {
    label: 'ภาพรวม (Overview)',
    audience: 'internal',
    items: [
      { moduleKey: 'overview_dashboard', label: 'แดชบอร์ดหลัก (Dashboard)', path: '/' },
      { moduleKey: 'employee_self_profile', label: 'โปรไฟล์ของฉัน (My Profile)', path: '/my-profile' },
    ],
  },
  {
    label: 'งานขายและสัญญา (Commercial)',
    audience: 'internal',
    items: [
      { moduleKey: 'customers', label: 'ทะเบียนลูกค้า (Customers)', path: '/customers', note: 'รวมสรุปฐานวางบิล' },
      { moduleKey: 'quotations', label: 'ใบเสนอราคา (Quotations)', path: '/quotations' },
      { moduleKey: 'main_contracts', label: 'สัญญาหลัก (Main Contracts)', path: '/main-contracts' },
      { moduleKey: 'customer_pos', label: 'ใบสั่งซื้อลูกค้า (Customer POs)', path: '/purchase-orders' },
    ],
  },
  {
    label: 'งานบุคคล (HR — โต๊ะทำงาน)',
    audience: 'internal',
    items: [
      {
        moduleKey: 'worker_payroll',
        label: 'การจ่ายค่าจ้าง (Payroll)',
        path: '/hr/payroll',
        note: 'รวม payroll runs, payslips, payment exports',
      },
      {
        moduleKey: 'timesheets',
        label: 'ลงเวลาและภารกิจหน้างาน (Timesheets)',
        path: '/timesheets',
        note: 'รวมรายวัน/รายเดือน/exception',
      },
      { moduleKey: 'hr_hub', label: 'ศูนย์อนุมัติ (Approval)', path: '/hr/approval' },
      {
        moduleKey: 'workers',
        label: 'ทะเบียน (Master Data)',
        path: '/workers',
        note: 'รวม workers, office_staff, positions, worker_documents',
      },
    ],
  },
  {
    label: 'งานปฏิบัติการ (Operations)',
    audience: 'internal',
    items: [
      {
        moduleKey: 'waves',
        label: 'การจัดการ Manpower (Waves / Assignments)',
        path: '/po-active-quota-queue',
        note: 'รวม PO Active, assignments, mobilization',
      },
      {
        moduleKey: 'store_inventory',
        label: 'การจัดการคลังสินค้า/เอกสาร (Store & Vendor)',
        path: '/store',
        note: 'รวม vendors, PR, purchases, vendor bills',
      },
      { moduleKey: 'draft_invoices', label: 'ทำใบแจ้งหนี้แบบ Monthly', path: '/draft-invoices' },
      { moduleKey: 'operations_petty_cash', label: 'Petty Cash — เบิกหน้างาน', path: '/operations/petty-cash' },
    ],
  },
  {
    label: 'บัญชี (Accounting)',
    audience: 'accounting',
    items: [
      { moduleKey: 'accounting_dashboard', label: 'แดชบอร์ดบัญชี', path: '/accounting/dashboard' },
      {
        moduleKey: 'tax_invoices',
        label: 'ระบบลูกหนี้ (AR + Tax Invoice + Receipt)',
        path: '/tax-invoices',
        note: 'รวม draft_invoices, tax_invoices, receipts, accounts_receivable',
      },
      {
        moduleKey: 'ap_bills',
        label: 'ระบบเจ้าหนี้ (AP)',
        path: '/ap-bills',
        note: 'รวม ap_bills, accounts_payable',
      },
      {
        moduleKey: 'executive_payroll',
        label: 'หัก ณ ที่จ่าย (ผู้บริหาร)',
        path: '/accounting/withholding-payroll/executive',
      },
      {
        moduleKey: 'withholding_tax_items',
        label: 'หัก ณ ที่จ่าย (พนักงาน/คู่ค้า)',
        path: '/accounting/withholding-payroll',
      },
      {
        moduleKey: 'cashbook',
        label: 'สมุดบัญชีและธนาคาร (Cashbook + Bank)',
        path: '/cashbook',
        note: 'รวม cashbook, bank_accounts',
      },
      {
        moduleKey: 'office_payroll',
        label: 'เงินเดือน — พนักงานออฟฟิศ (บัญชี)',
        path: '/accounting/office-payroll',
      },
      {
        moduleKey: 'worker_payroll',
        label: 'เงินเดือน — ลูกจ้าง · ทำจ่าย (บัญชี)',
        path: '/accounting/worker-payroll',
      },
      { moduleKey: 'cash_advances', label: 'รออนุมัติจ่ายเบิกเงิน', path: '/accounting/cash-advances-payout' },
      {
        moduleKey: 'executive_payroll',
        label: 'เงินเดือนผู้บริหาร (Executive Payroll)',
        path: '/accounting/executive-payroll',
      },
    ],
  },
  {
    label: 'การจัดการระบบ (Administration)',
    audience: 'admin',
    items: [
      {
        moduleKey: 'system_admin',
        label: 'จัดการผู้ใช้ + ตรวจความปลอดภัย',
        path: '/users',
        note: 'รวม Users, Security Check, Document Profile, Drug Test Panel, Client Portal switcher',
      },
      { moduleKey: 'document_numbering', label: 'เลขที่เอกสาร (Numbering)', path: '/system-admin/numbering' },
      { moduleKey: 'audit_logs', label: 'ประวัติกิจกรรม (Audit Logs)', path: '/system-admin/audit-logs' },
    ],
  },
  {
    label: 'ลูกค้า (Project Portal)',
    audience: 'client',
    items: [
      {
        moduleKey: 'client_portal',
        label: 'พอร์ทัลลูกค้า (ทั้งหมด)',
        path: '/client-portal/dashboard',
        note: 'รวม Dashboard, Personnel, Activity (Timesheets), Billing',
      },
    ],
  },
];
