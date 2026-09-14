/** Domain types: rbac / users / permissions / positions. */

export type DeptType = 'admin' | 'hr' | 'operations' | 'sales' | 'accounting' | 'store' | 'client';

/** Org / profile tier (PermissionProfile and legacy {@link User.level}). */
export type AccessLevel = 'viewer' | 'officer' | 'manager' | 'admin';

/** Job Policy Modes */
export type JobMode = 'ONSHORE' | 'OFFSHORE';

export type RoleType = 
  | 'system_admin'
  | 'payroll_officer'
  | 'accounting_officer'
  | 'accounting_manager'
  | 'sales_officer'
  | 'sales_manager'
  | 'hr_manager'
  | 'hr_officer'
  | 'operations_officer'
  | 'operations_manager'
  | 'timekeeper'
  | 'store_officer'
  | 'client_user'
  | 'employee_self'
  | 'executive'; 

export type BusinessRoleKey = 
  | 'system_admin'
  | 'payroll_officer'
  | 'sales_manager'
  | 'sales_officer'
  | 'hr_manager'
  | 'hr_officer'
  | 'operations_manager'
  | 'operations_officer'
  | 'timekeeper'
  | 'accounting_manager'
  | 'accounting_officer'
  | 'store_officer'
  | 'client_user'
  | 'employee_self'
  | 'executive';

/** Matches firestore.rules: ACTIVE or legacy APPROVED both treated as approved for access. */
export type ApprovalStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED' | 'APPROVED';

export type UserType = 'internal' | 'customer_portal';

export type DataAccessClass = 'staff' | 'client' | 'admin';

export type PortalRole = 'approver' | 'viewer';

/** Primary org partition for permission profiles (aligns with User.accessGroup). */

export type DepartmentGroup = 'admin' | 'operations' | 'accounting' | 'client';

export interface User {
  id: string;
  email: string;
  displayName: string;
  /** เบอร์โทร (เช่น ลงทะเบียนผ่านหน้าแรก) */
  phone?: string;

  /** Optional 3-tier model (snake_case; mirrors Firestore rules helpers). */
  status?: 'active' | 'pending' | 'suspended' | string;
  user_type?: 'internal' | 'customer_portal' | string;
  /** Primary role for simplified RBAC: system_admin | accounting_* | operations_officer | ... */
  role?: string;

  // FUTURE PRIMARY ACCESS MODEL (internal: accessGroup + accessLevel + allowedModules; portal separate)
  userType?: 'internal' | 'customer_portal';
  /** Canonical: `operations` (plural). Writers must use `normalizeUserAuthorizationFields` — do not store `operation`. */
  accessGroup?: 'admin' | 'operations' | 'operation' | 'accounting' | 'client';
  /** Same partition as {@link accessGroup}; keep in sync on write (both should be `operations`, not `operation`). */
  departmentGroup?: DepartmentGroup | 'operation';
  accessLevel?: 'admin' | 'manager' | 'officer' | 'viewer';
  allowedModules?: string[];
  portalRole?: 'approver' | 'viewer';
  customerId?: string | null;
  /**
   * Client portal session overlay only (not stored on Firestore): system admin previewing this customer's portal.
   * When set and matches customerId, CustomerQueryService scopes queries like a portal user.
   */
  portalActingCustomerId?: string;

  // LEGACY / TRANSITIONAL ONLY — DO NOT EXPAND (kept for Firestore + UI until accessGroup migration)
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
  department: DeptType;
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
  level: AccessLevel;
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
  roleId?: RoleType;
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
  roleIds: RoleType[];
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
  permissionProfileKey?: string | null;
  /** Canonical business role; lowercase snake_case only (e.g. `operations_manager`, `client_user`). */
  assignedRoleKey?: BusinessRoleKey | null;

  /** Transitional storage only — do not add multi-profile aggregation; runtime should use {@link permissionProfileKey} or first entry. */
  permissionProfileKeys?: string[];
  /** Transitional storage only — do not add multi-role aggregation; prefer single {@link assignedRoleKey}. */
  assignedRoleKeys?: BusinessRoleKey[];
  dataAccess?: DataAccessClass;

  isActive: boolean;
  approvalStatus: ApprovalStatus;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  lastLogoutAt?: number;
  notes?: string;
  mustResetPassword?: boolean;
  allowedContractIds?: string[];
  allowedPurchaseOrderIds?: string[];
  deactivatedAt?: number | null;
  deactivatedReason?: string | null;

  /** Migration flag: user needs manual review (do not remove until verified). */
  migrationNeedsReview?: boolean;
}

export interface PermissionProfile {
  id: string;
  profileKey: string;
  profileNameTh: string;
  profileNameEn: string;
  /** Primary partition for new UI & assignment rules (admin / operations / accounting / client). */
  departmentGroup?: DepartmentGroup | 'operation';
  /**
   * @deprecated Legacy single-department label; keep for reads / migration. Prefer {@link departmentGroup}.
   */
  department?: DeptType;
  /** Access tier within {@link departmentGroup} (viewer → admin). */
  level: AccessLevel;
  /** Optional canonical template id (e.g. system_admin, operations_manager). Legacy: admin_admin. */
  primaryRoleTemplateKey?: string;
  isActive: boolean;
  permissions: Record<string, ModulePermission>;
  updatedAt: number;
  updatedBy: string;
  createdAt?: number;
  createdBy?: string;
  notes?: string;
}

export interface ModulePermission {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
}

export interface Position {
  id: string;
  positionCode: string;
  /** ชื่อตำแหน่ง (field หลักใน Firestore) */
  positionName: string;
  /** @deprecated ใช้ positionName แทน — เก็บไว้สำหรับ legacy docs */
  positionNameTh: string;
  /** @deprecated ใช้ positionName แทน — เก็บไว้สำหรับ legacy docs */
  positionNameEn: string;
  category: 'OFFSHORE' | 'ONSHORE' | 'OFFICE';
  jobMode: JobMode;
  payrollBasis: 'DAILY' | 'MONTHLY' | 'HOURLY';
  active: boolean;
  description?: string;
  notes?: string;
  /**
   * ต้นทุนค่าแรงมาตรฐาน (OPEC จ่าย) ตาม workMode — ไม่อ้าง main_contract/position_rates ฝั่งสัญญา
   * (เฟส 1+ backfill จาก `main_contracts/.../position_rates` ชุดเดิม แล้ว UI สัญญาไม่เก็บต้นทุน)
   */
  defaultLaborCostOnshore?: number;
  defaultLaborCostOffshore?: number;
  /**
   * ทะเบียนต้นทุนค่าแรงต่อสัญญา (และลูกค้า) — payroll ใช้คู่กับ timesheet.contractId
   */
  laborCostByContract?: {
    contractId: string;
    customerId?: string;
    contractLabel?: string;
    onshore?: number;
    offshore?: number;
  }[];
  createdAt: number;
  updatedAt: number;
}

export interface ClientUser {
  id: string;
  customerId: string;
  email: string;
  displayName: string;
  isSharedAccount: boolean;
  active: boolean;
  createdAt: number;
}

export interface NumberSequence {
  id: string;
  sequenceKey: string;
  label: string;
  prefix: string;
  department: DeptType;
  entityType: string;
  resetPolicy: 'none' | 'yearly' | 'monthly';
  year?: number | null;
  month?: number | null;
  paddingLength: number;
  lastNumber: number;
  lastIssuedCode?: string | null;
  /**
   * เลขรันนิ่งที่คืนหลัง admin ลบเอกสาร (ไม่ใช่ปลายสุด) —
   * `generateNextDocumentCode` จะใช้ก่อนเพิ่ม lastNumber
   */
  releasedRunningNumbers?: number[];
  isActive: boolean;
  updatedAt: number;
  updatedBy: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
}

