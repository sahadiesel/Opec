/**
 * @fileOverview OPEC OpsFlow - Permission Regression Tester
 * Lightweight utility to validate permission logic against business requirements.
 */

import { User, PermissionProfile, ModulePermission } from '../types';
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

/**
 * Mocks a user with specific roles for testing
 */
function createMockUser(roles: string[], dept: any, level: any): User {
  return normalizeCurrentUserPermissions({
    id: 'test-user',
    email: 'test@opec.com',
    displayName: 'Test User',
    roleIds: roles,
    assignedRoleKeys: roles,
    department: dept,
    level: level,
    isActive: true,
    approvalStatus: 'ACTIVE'
  }) as User;
}

/**
 * Runs a suite of logic-only tests to ensure no regressions in permission aggregation.
 */
export function runPermissionLogicSuite(): ValidationSummary {
  const results: TestResult[] = [];

  const assert = (name: string, condition: boolean, failMsg: string) => {
    results.push({
      name,
      passed: condition,
      message: condition ? 'Passed' : failMsg
    });
  };

  // 1. System Admin Full Access Test
  const admin = createMockUser(['system_admin'], 'admin', 'admin');
  const adminPerms = getPermissions(admin, 'workers');
  assert(
    'Admin Full Access',
    adminPerms.view && adminPerms.edit && adminPerms.approve,
    'System Admin should have full CRUD and Approve access'
  );

  // 2. HR Officer Isolation Test
  const hrOfficer = createMockUser(['hr_officer'], 'hr', 'officer');
  const hrAccessToWorkers = getPermissions(hrOfficer, 'workers');
  const hrAccessToAccounting = getPermissions(hrOfficer, 'billing_notes');
  assert(
    'HR Officer Isolation',
    hrAccessToWorkers.view && !hrAccessToAccounting.view,
    'HR Officer should see HR data but not Accounting data'
  );

  // 3. Multi-Role Aggregation (Union) Test
  // User is both HR and Operations
  const hybridUser = createMockUser(['hr_officer', 'operations_officer'], 'hr', 'officer');
  const accessToHR = getPermissions(hybridUser, 'workers');
  const accessToOps = getPermissions(hybridUser, 'waves');
  assert(
    'Multi-Role Union',
    accessToHR.view && accessToOps.view,
    'Hybrid user should see both HR and Operations modules'
  );

  // 4. Client User Sandbox Test
  const client = createMockUser(['client_user'], 'client', 'viewer');
  client.userType = 'customer_portal';
  const clientAccessToPayroll = getPermissions(client, 'worker_payroll');
  const clientAccessToPortal = getPermissions(client, 'client_portal');
  assert(
    'Client User Sandboxing',
    !clientAccessToPayroll.view && clientAccessToPortal.view,
    'Client users must be restricted to client-portal and blocked from internal payroll'
  );

  // 5. Security Sensitive Fields Definition Check
  const essentialFields = ['roleIds', 'isActive', 'approvalStatus', 'department'];
  const fieldsCovered = essentialFields.every(f => SECURITY_SENSITIVE_FIELDS.includes(f));
  assert(
    'Security Field Registry',
    fieldsCovered,
    'Essential security fields are missing from the protected fields list'
  );

  // 6. Cross-Departmental Block Test
  const sales = createMockUser(['sales_officer'], 'sales', 'officer');
  const salesAccessToStore = getPermissions(sales, 'store_inventory');
  assert(
    'Departmental Boundaries',
    !salesAccessToStore.view,
    'Sales staff should not have access to Store/Inventory by default'
  );

  const passed = results.filter(r => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results
  };
}
