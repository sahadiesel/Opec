import { AccessLevel, BusinessRoleKey, DepartmentGroup, DeptType, RoleType } from '@/lib/types';
import { normalizeBusinessRoleKey } from '@/lib/role-key-normalizer';

export interface RoleCatalogEntry {
  key: BusinessRoleKey;
  displayNameTh: string;
  displayNameEn: string;
  department: DeptType;
  accessGroup: DepartmentGroup;
  accessLevel: AccessLevel;
  permissionProfileKey: string;
  canonicalRole: RoleType;
  descriptionTh: string;
  legacyAliases?: string[];
}

export const ROLE_CATALOG: Record<BusinessRoleKey, RoleCatalogEntry> = {
  system_admin: {
    key: 'system_admin',
    displayNameTh: 'ผู้ดูแลระบบสูงสุด',
    displayNameEn: 'System Administrator',
    department: 'admin',
    accessGroup: 'admin',
    accessLevel: 'admin',
    permissionProfileKey: 'admin_admin',
    canonicalRole: 'system_admin',
    descriptionTh: 'เข้าถึงและจัดการได้ทุกส่วนของระบบ รวมถึงการตั้งค่าสิทธิ์และความปลอดภัย',
    legacyAliases: ['super_admin', 'admin'],
  },
  admin_admin: {
    key: 'admin_admin',
    displayNameTh: 'ผู้ดูแลระบบ',
    displayNameEn: 'System Administrator',
    department: 'admin',
    accessGroup: 'admin',
    accessLevel: 'admin',
    permissionProfileKey: 'admin_admin',
    canonicalRole: 'system_admin',
    descriptionTh: 'สิทธิ์สูงสุด',
  },
  hr_manager: {
    key: 'hr_manager',
    displayNameTh: 'ผู้จัดการฝ่ายบุคคล',
    displayNameEn: 'HR Manager',
    department: 'hr',
    accessGroup: 'operation',
    accessLevel: 'manager',
    permissionProfileKey: 'hr_manager',
    canonicalRole: 'hr_manager',
    descriptionTh: 'จัดการข้อมูลคนงาน ตำแหน่งงาน และอนุมัติการจ่ายเงินเดือน',
  },
  hr_officer: {
    key: 'hr_officer',
    displayNameTh: 'เจ้าหน้าที่ฝ่ายบุคคล',
    displayNameEn: 'HR Officer',
    department: 'hr',
    accessGroup: 'operation',
    accessLevel: 'officer',
    permissionProfileKey: 'hr_officer',
    canonicalRole: 'hr_officer',
    descriptionTh: 'บันทึกข้อมูลคนงาน เอกสาร และเวลาทำงาน',
  },
  payroll_officer: {
    key: 'payroll_officer',
    displayNameTh: 'เจ้าหน้าที่เงินเดือน',
    displayNameEn: 'Payroll Officer',
    department: 'hr',
    accessGroup: 'operation',
    accessLevel: 'officer',
    permissionProfileKey: 'payroll_officer',
    canonicalRole: 'payroll_officer',
    descriptionTh: 'ดำเนินงานเงินเดือนและงานส่งออกจ่ายเงิน',
  },
  accounting_manager: {
    key: 'accounting_manager',
    displayNameTh: 'ผู้จัดการฝ่ายบัญชี',
    displayNameEn: 'Accounting Manager',
    department: 'accounting',
    accessGroup: 'accounting',
    accessLevel: 'manager',
    permissionProfileKey: 'accounting_manager',
    canonicalRole: 'accounting_manager',
    descriptionTh: 'จัดการการเงิน บัญชี และอนุมัติการจ่ายเงิน',
  },
  accounting_officer: {
    key: 'accounting_officer',
    displayNameTh: 'เจ้าหน้าที่ฝ่ายบัญชี',
    displayNameEn: 'Accounting Officer',
    department: 'accounting',
    accessGroup: 'accounting',
    accessLevel: 'officer',
    permissionProfileKey: 'accounting_officer',
    canonicalRole: 'accounting_officer',
    descriptionTh: 'บันทึกรายการบัญชี รับจ่าย และเอกสารการเงิน',
  },
  sales_manager: {
    key: 'sales_manager',
    displayNameTh: 'ผู้จัดการฝ่ายขาย',
    displayNameEn: 'Sales Manager',
    department: 'sales',
    accessGroup: 'operation',
    accessLevel: 'manager',
    permissionProfileKey: 'sales_manager',
    canonicalRole: 'sales_manager',
    descriptionTh: 'บริหารลูกค้า สัญญา และใบเสนอราคา',
  },
  sales_officer: {
    key: 'sales_officer',
    displayNameTh: 'เจ้าหน้าที่ฝ่ายขาย',
    displayNameEn: 'Sales Officer',
    department: 'sales',
    accessGroup: 'operation',
    accessLevel: 'officer',
    permissionProfileKey: 'sales_officer',
    canonicalRole: 'sales_officer',
    descriptionTh: 'ดูแลข้อมูลลูกค้า เอกสารขาย และสัญญาเบื้องต้น',
  },
  store_manager: {
    key: 'store_manager',
    displayNameTh: 'ผู้จัดการคลังสินค้า',
    displayNameEn: 'Store Manager',
    department: 'store',
    accessGroup: 'operation',
    accessLevel: 'manager',
    permissionProfileKey: 'store_manager',
    canonicalRole: 'store_manager',
    descriptionTh: 'ดูแลคลังอุปกรณ์และการจัดซื้อ',
  },
  store_officer: {
    key: 'store_officer',
    displayNameTh: 'เจ้าหน้าที่คลังสินค้า',
    displayNameEn: 'Store Officer',
    department: 'store',
    accessGroup: 'operation',
    accessLevel: 'officer',
    permissionProfileKey: 'store_officer',
    canonicalRole: 'store_officer',
    descriptionTh: 'ทำรายการคลังสินค้าและจัดซื้อ',
  },
  client_user: {
    key: 'client_user',
    displayNameTh: 'ลูกค้า / ผู้ใช้งานภายนอก',
    displayNameEn: 'Client User',
    department: 'client',
    accessGroup: 'client',
    accessLevel: 'viewer',
    permissionProfileKey: 'client_user',
    canonicalRole: 'client_user',
    descriptionTh: 'เข้าดูข้อมูลลูกค้าของตนเองและทำรายการใน client portal',
    legacyAliases: ['client', 'client_viewer', 'client_approver', 'customer_viewer', 'customer_approver'],
  },
  operation_officer: {
    key: 'operation_officer',
    displayNameTh: 'เจ้าหน้าที่ปฏิบัติการ',
    displayNameEn: 'Operations Officer',
    department: 'operations',
    accessGroup: 'operation',
    accessLevel: 'officer',
    permissionProfileKey: 'operation_officer',
    canonicalRole: 'operation_officer',
    descriptionTh: 'ขาย/บุคคล/ปฏิบัติการ/คลัง (รวม)',
    legacyAliases: ['operations_officer', 'safety_officer'],
  },
  operation_manager: {
    key: 'operation_manager',
    displayNameTh: 'ผู้จัดการปฏิบัติการ',
    displayNameEn: 'Operations Manager',
    department: 'operations',
    accessGroup: 'operation',
    accessLevel: 'manager',
    permissionProfileKey: 'operation_manager',
    canonicalRole: 'operation_manager',
    descriptionTh: 'ขาย/บุคคล/ปฏิบัติการ/คลัง (รวม)',
    legacyAliases: ['operations_manager'],
  },
};

export const ACTIVE_BUSINESS_ROLE_KEYS: BusinessRoleKey[] = [
  'system_admin',
  'hr_manager',
  'hr_officer',
  'payroll_officer',
  'sales_manager',
  'sales_officer',
  'store_manager',
  'store_officer',
  'operation_manager',
  'operation_officer',
  'accounting_manager',
  'accounting_officer',
  'client_user',
];

export function getCanonicalBusinessRoleKey(roleKey?: string | null): BusinessRoleKey | null {
  const normalized = normalizeBusinessRoleKey(roleKey);
  if (!normalized) return null;
  if (normalized === 'admin_admin') return 'system_admin';
  return normalized in ROLE_CATALOG ? (normalized as BusinessRoleKey) : null;
}

export function getRoleCatalogEntry(roleKey?: string | null): RoleCatalogEntry | null {
  const canonical = getCanonicalBusinessRoleKey(roleKey);
  if (!canonical) return null;
  return ROLE_CATALOG[canonical];
}

