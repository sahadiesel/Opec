/**
 * @fileOverview OPEC OpsFlow - Permission Regression Tester
 * Lightweight utility to validate permission logic against business requirements.
 */

import { User, PermissionProfile, ModulePermission, RoleType, BusinessRoleKey } from '../types';
import { 
  getPermissions, 
  SYSTEM_MODULES, 
  FULL_ACCESS, 
  NO_ACCESS, 
  OFFICER_ACCESS,
  SECURITY_SENSITIVE_FIELDS,
  normalizeCurrentUserPermissions
} from '../permissions';

export interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

export interface ValidationSummary {
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}

function createMockUser(roles: string[], dept: any, level: any): User {
  const primary = (roles[0] || '') as BusinessRoleKey;
  return normalizeCurrentUserPermissions({
    id: 'test-user',
    email: 'test@opec.com',
    displayName: 'Test User',
    roleIds: roles as RoleType[],
    assignedRoleKey: primary,
    assignedRoleKeys: roles as BusinessRoleKey[],
    department: dept,
    level: level,
    isActive: true,
    approvalStatus: 'ACTIVE'
  }) as User;
}

export function runPermissionLogicSuite(): ValidationSummary {
  const results: TestResult[] = [];

  const assert = (name: string, condition: boolean, failMsg: string) => {
    results.push({
      name,
      passed: condition,
      message: condition ? 'Passed' : failMsg
    });
  };

  const admin = createMockUser(['system_admin'], 'admin', 'admin');
  const adminPerms = getPermissions(admin, 'workers');
  assert(
    'Admin Full Access',
    adminPerms.view && adminPerms.edit && adminPerms.approve,
    'System Admin should have full CRUD and Approve access'
  );

  const hrOfficer = createMockUser(['hr_officer'], 'hr', 'officer');
  const hrWorkers = getPermissions(hrOfficer, 'workers');
  const hrHub = getPermissions(hrOfficer, 'hr_hub');
  const hrAccessToAccounting = getPermissions(hrOfficer, 'billing_notes');
  assert(
    'HR Officer Isolation',
    hrWorkers.view &&
      hrWorkers.create &&
      hrWorkers.edit &&
      !hrWorkers.delete &&
      hrHub.view &&
      !hrAccessToAccounting.view,
    'HR Officer should manage workers (create/edit, no delete) + HR hub / master data, no accounting finance'
  );

  const hybridUser = createMockUser(['operations_officer', 'hr_officer'], 'operations', 'officer');
  const accessToWorkers = getPermissions(hybridUser, 'workers');
  const accessToOps = getPermissions(hybridUser, 'waves');
  assert(
    'Primary role wins for module blocks',
    accessToWorkers.view && accessToOps.view,
    'User with primary operations_officer should retain workers + ops even if also tagged hr_officer'
  );

  const opsOnly = createMockUser(['operations_officer'], 'operations', 'officer');
  const opsPayroll = getPermissions(opsOnly, 'worker_payroll');
  const opsDraftInv = getPermissions(opsOnly, 'draft_invoices');
  const opsTimesheets = getPermissions(opsOnly, 'timesheets');
  assert(
    'Operations officer: no payroll / commercial invoice menu',
    !opsPayroll.view && !opsDraftInv.view && opsTimesheets.view,
    'operations_officer must not access payroll or draft invoices but can use timesheets'
  );

  const client = createMockUser(['client_user'], 'client', 'viewer');
  client.userType = 'customer_portal';
  const clientAccessToPayroll = getPermissions(client, 'worker_payroll');
  const clientAccessToPortal = getPermissions(client, 'client_portal');
  assert(
    'Client User Sandboxing',
    !clientAccessToPayroll.view && clientAccessToPortal.view,
    'Client users must be restricted to client-portal and blocked from internal payroll'
  );

  const essentialFields = ['roleIds', 'isActive', 'approvalStatus', 'department'] as const;
  const sensitive = SECURITY_SENSITIVE_FIELDS as readonly string[];
  const fieldsCovered = essentialFields.every((f) => sensitive.includes(f));
  assert(
    'Security Field Registry',
    fieldsCovered,
    'Essential security fields are missing from the protected fields list'
  );

  const passed = results.filter(r => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results
  };
}
