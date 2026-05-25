/**
 * Generator: matrix overrides + module-to-firestore-paths → preview text ของ firestore.rules
 *
 * เอาต์พุตเป็น TEXT (ไม่ใช่ rules ที่ deploy ได้ทันที) เพื่อให้ admin/dev คัดลอกไปวางใน
 * `firestore.rules` แล้วตรวจสอบเอง — generator จะ:
 *  1. คำนวณ effective permission per (role × module) = baseline + override
 *  2. สำหรับแต่ละ module ที่มี Firestore paths → สร้าง capability predicate functions
 *     (`canReadXMatrix()`, `canCreateXMatrix()`, `canEditXMatrix()`, `canDeleteXMatrix()`,
 *     `canApproveXMatrix()`) ที่ list `roleIs(userData(), 'role_key')` ตามที่ matrix อนุญาต
 *  3. สร้าง suggested `match` blocks สำหรับแต่ละ Firestore path
 *
 * ข้อจำกัด:
 *  - portal/self/conditional logic (เช่น `portalOwnsResourceCustomerId()` หรือ resource.data.status)
 *    ไม่ถูก generate ใหม่ — generator แค่ตั้ง baseline gate; admin ต้อง merge เข้ากับ logic เดิม
 *  - `approve` capability ถูกผูกกับ `update` (status guard ต้องเขียนเอง)
 *  - `system_admin` ได้ทุกอย่างเสมอ — ใส่ใน predicate อัตโนมัติ
 */

import type { BusinessRoleKey } from '@/lib/types';
import { ACTIVE_BUSINESS_ROLE_KEYS, ROLE_CATALOG } from '@/lib/roles/role-catalog';
import {
  applyOverride,
  type CapabilityCell,
  type CapabilityKey,
  type MenuMatrixOverrides,
} from './menu-matrix-overrides';
import {
  MODULE_FIRESTORE_SPECS,
  type ModuleFirestoreSpec,
} from './module-to-firestore-paths';

const CAPABILITY_LIST: CapabilityKey[] = ['view', 'create', 'edit', 'delete', 'approve'];

const CAPABILITY_TO_RULE_ACTION: Record<CapabilityKey, string> = {
  view: 'read',
  create: 'create',
  edit: 'update',
  delete: 'delete',
  approve: 'update /* approve = update + status guard (ต้องเขียน guard เอง) */',
};

const CAPABILITY_LABEL_TH: Record<CapabilityKey, string> = {
  view: 'ดู',
  create: 'สร้าง',
  edit: 'แก้ไข',
  delete: 'ลบ',
  approve: 'อนุมัติ',
};

const DOMAIN_HEADER_TH: Record<ModuleFirestoreSpec['domain'], string> = {
  commercial: 'Commercial (การค้า)',
  ops: 'Operations (ปฏิบัติการ)',
  store: 'Store / Vendor (คลัง + คู่ค้า)',
  hr: 'HR & Payroll (บุคคล)',
  accounting: 'Accounting (บัญชี)',
  admin: 'Administration (ระบบ)',
  portal: 'Client Portal',
  self: 'Self / Overview',
};

export interface GenerateRulesOptions {
  /** matrix overrides (จาก hook / Export JSON) */
  overrides: MenuMatrixOverrides;
  /** baseline matrix: role → moduleKey → CapabilityCell (ใช้ผสมกับ overrides เพื่อได้ effective) */
  baseline: Record<string, Record<string, CapabilityCell>>;
  /** เฉพาะ module ที่จะ generate (default: ทุก module) */
  moduleKeys?: string[];
  /** ใส่ tag/version ใน comment header */
  generatedAt?: number;
  generatedBy?: string;
}

export interface GenerateRulesResult {
  /** Full text สำหรับ paste ลงไฟล์ rules */
  text: string;
  /** สถิติเชิงสรุป */
  stats: {
    moduleCount: number;
    pathCount: number;
    predicateCount: number;
  };
}

interface CapabilityRoleAllowance {
  capability: CapabilityKey;
  roles: BusinessRoleKey[];
}

function effectiveRoleAllowanceForModule(
  moduleKey: string,
  overrides: MenuMatrixOverrides,
  baseline: Record<string, Record<string, CapabilityCell>>,
): CapabilityRoleAllowance[] {
  const out: CapabilityRoleAllowance[] = CAPABILITY_LIST.map((cap) => ({ capability: cap, roles: [] }));

  for (const roleKey of ACTIVE_BUSINESS_ROLE_KEYS) {
    const base = baseline[roleKey]?.[moduleKey];
    if (!base) continue;
    const override = overrides[roleKey]?.[moduleKey];
    const eff = applyOverride(base, override);

    for (const cap of CAPABILITY_LIST) {
      if (eff[cap]) {
        out.find((x) => x.capability === cap)!.roles.push(roleKey);
      }
    }
  }
  return out;
}

function fmtRoleLine(roleKey: BusinessRoleKey, isLast: boolean): string {
  const sep = isLast ? '' : ' ||';
  const label = ROLE_CATALOG[roleKey]?.displayNameTh ?? roleKey;
  return `        roleIs(userData(), '${roleKey}')${sep}  // ${label}`;
}

function emitPredicate(
  fnName: string,
  roles: BusinessRoleKey[],
  capabilityLabelTh: string,
): string {
  if (roles.length === 0) {
    return [
      `    /** ${capabilityLabelTh} — ไม่มีบทบาทใดได้รับสิทธิ์ตาม matrix นี้ */`,
      `    function ${fnName}() {`,
      `      return isAdmin();  // เปิดให้ admin เสมอ`,
      `    }`,
      '',
    ].join('\n');
  }
  const lines: string[] = [];
  lines.push(`    /** ${capabilityLabelTh} — generated จาก matrix (${roles.length} บทบาท) */`);
  lines.push(`    function ${fnName}() {`);
  lines.push(`      return isInternalUser() && (`);
  /** system_admin มักรวมอยู่แล้ว — แต่ใส่ isAdmin() แยกชัดเจน */
  if (!roles.includes('system_admin')) {
    lines.push(`        isAdmin() ||`);
  }
  roles.forEach((r, idx) => {
    lines.push(fmtRoleLine(r, idx === roles.length - 1));
  });
  lines.push(`      );`);
  lines.push(`    }`);
  lines.push('');
  return lines.join('\n');
}

function emitMatchBlock(spec: ModuleFirestoreSpec, path: string, shape: string | undefined): string {
  const p = `${spec.fnPrefix}`;
  const indent = '    ';
  const lines: string[] = [];

  lines.push(`${indent}// [${spec.moduleKey}] — ${spec.label}`);
  lines.push(`${indent}match /${path} {`);

  if (shape === 'admin-only') {
    lines.push(`${indent}  allow read, write: if isAdmin();`);
  } else if (shape === 'read-only') {
    lines.push(`${indent}  allow read: if canRead${p}Matrix();`);
    lines.push(`${indent}  allow write: if false;  // read-only collection`);
  } else if (shape === 'append-only') {
    lines.push(`${indent}  allow read: if canRead${p}Matrix();`);
    lines.push(`${indent}  allow create: if internalStaffFirestoreActor();  // append-only`);
    lines.push(`${indent}  allow update, delete: if isAdmin();`);
  } else {
    /** crud (default) */
    lines.push(`${indent}  allow read:   if canRead${p}Matrix();`);
    lines.push(`${indent}  allow create: if canCreate${p}Matrix();`);
    lines.push(`${indent}  allow update: if canEdit${p}Matrix() || canApprove${p}Matrix();  // approve ใช้ update + ต้องเช็ค status guard`);
    lines.push(`${indent}  allow delete: if canDelete${p}Matrix();`);
  }

  lines.push(`${indent}}`);
  lines.push('');
  return lines.join('\n');
}

export function generateRulesPreview(opts: GenerateRulesOptions): GenerateRulesResult {
  const { overrides, baseline, moduleKeys, generatedAt, generatedBy } = opts;
  const specs = moduleKeys
    ? MODULE_FIRESTORE_SPECS.filter((s) => moduleKeys.includes(s.moduleKey))
    : MODULE_FIRESTORE_SPECS;

  const ts = new Date(generatedAt ?? Date.now()).toISOString();
  const headerLines: string[] = [
    `// =====================================================================`,
    `// GENERATED firestore.rules patches — DO NOT auto-merge`,
    `// Source: /system-admin/menu-permissions matrix (localStorage overrides)`,
    `// Generated at: ${ts}`,
    `// Generated by: ${generatedBy ?? 'unknown admin'}`,
    `// =====================================================================`,
    ``,
    `// คำแนะนำการใช้:`,
    `// 1. ตรวจ predicate functions ด้านล่าง → แทนที่ฟังก์ชันเดิมใน firestore.rules ที่ตรง intent`,
    `// 2. ตรวจ match blocks ด้านล่าง → เปรียบเทียบกับของเดิม:`,
    `//    - คงไว้: logic พิเศษ (portal scope, self read, status guard) ที่ generator ไม่รู้`,
    `//    - แทนที่: baseline allow ของ role-only gate`,
    `// 3. รัน 'firebase deploy --only firestore:rules' (รอ 503 หายก่อน)`,
    `// 4. ทดสอบใน emulator: 'firebase emulators:start --only firestore'`,
    ``,
    `// approve = update + ต้องเขียน status-guard เอง (เช่น`,
    `//   request.resource.data.status == 'APPROVED' && resource.data.status == 'PENDING')`,
    ``,
  ];

  /** ส่วน 1: predicate functions */
  const predicateBlocks: string[] = [
    `// =====================================================================`,
    `// PART 1 — Capability predicate functions (paste ก่อน rules_version statement)`,
    `// =====================================================================`,
    ``,
  ];

  /** สลับ group เป็น domain */
  const byDomain = new Map<ModuleFirestoreSpec['domain'], ModuleFirestoreSpec[]>();
  for (const spec of specs) {
    const arr = byDomain.get(spec.domain) ?? [];
    arr.push(spec);
    byDomain.set(spec.domain, arr);
  }

  let predicateCount = 0;
  for (const [domain, list] of byDomain.entries()) {
    predicateBlocks.push(`    // ---------- ${DOMAIN_HEADER_TH[domain]} ----------`);
    predicateBlocks.push('');
    for (const spec of list) {
      const allowance = effectiveRoleAllowanceForModule(spec.moduleKey, overrides, baseline);
      for (const a of allowance) {
        const fnName = `can${capitalizeFirst(a.capability)}${spec.fnPrefix}Matrix`;
        predicateBlocks.push(emitPredicate(fnName, a.roles, CAPABILITY_LABEL_TH[a.capability]));
        predicateCount += 1;
      }
    }
  }

  /** ส่วน 2: suggested match blocks */
  const matchBlocks: string[] = [
    ``,
    `// =====================================================================`,
    `// PART 2 — Suggested match blocks (paste ใน 'match /databases/{database}/documents')`,
    `// =====================================================================`,
    ``,
  ];

  let pathCount = 0;
  for (const [domain, list] of byDomain.entries()) {
    matchBlocks.push(`    // ---------- ${DOMAIN_HEADER_TH[domain]} ----------`);
    matchBlocks.push('');
    for (const spec of list) {
      if (spec.paths.length === 0) {
        matchBlocks.push(
          `    // [${spec.moduleKey}] — ${spec.label}: ไม่มี Firestore path (${spec.note ?? 'UI-only module'})`,
        );
        matchBlocks.push('');
        continue;
      }
      if (spec.note) {
        matchBlocks.push(`    // NOTE [${spec.moduleKey}]: ${spec.note}`);
      }
      for (const p of spec.paths) {
        if (p.note) {
          matchBlocks.push(`    // NOTE [${p.path}]: ${p.note}`);
        }
        matchBlocks.push(emitMatchBlock(spec, p.path, p.shape));
        pathCount += 1;
      }
    }
  }

  const text = [...headerLines, ...predicateBlocks, ...matchBlocks].join('\n');

  return {
    text,
    stats: {
      moduleCount: specs.length,
      pathCount,
      predicateCount,
    },
  };
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// =====================================================================
// FULL FILE GENERATOR — สร้าง firestore.rules ทั้งไฟล์ในเวอร์ชัน "simplified"
// =====================================================================

/**
 * Collections ที่ต้องเก็บ logic เดิมจาก `firestore.rules` ปัจจุบัน — generator จะใส่
 * placeholder marker ไว้ให้ admin วาง block เดิมเข้าไป (เพราะมี portal scope / status guard
 * / numbering สำหรับ business logic ที่ matrix ไม่ครอบคลุม)
 */
const COLLECTIONS_REQUIRING_PRESERVED_LOGIC: readonly string[] = [
  'users/{userId}',
  'audit_logs/{id}',
  'system/{docId}',
  'number_sequences/{id}',
  'client_portal/{document=**}',
  'commercial_invoices/{id}',
  'purchase_orders/{id}',
  'purchase_orders/{purchaseOrderId}/po_lines/{lineId}',
  'purchase_orders/{purchaseOrderId}/{document=**}',
  'customers/{customerId}/{document=**}',
  'cash_advance_requests/{id}',
  'attendance_kiosk_sessions/{token}',
  'attendance_punches/{id}',
  'attendance_correction_requests/{id}',
  'attendance_day_overrides/{id}',
  'withholding_certificate_documents/{id}',
  'withholding_certificate_documents/{docId}/audit_logs/{logId}',
  'withholding_certificate_documents/{docId}/xml_export_logs/{logId}',
  'workers/{workerId}',
  'daily_timesheets/{id}',
  'payroll_correction_requests/{id}',
  'leave_requests/{id}',
];

function shouldPreservePath(path: string): boolean {
  return COLLECTIONS_REQUIRING_PRESERVED_LOGIC.includes(path);
}

/** Essential core helpers — minimum needed for matrix gates to work */
function emitCoreHelpers(): string {
  return `    // ===== Core helpers =====
    function isSignedIn() { return request.auth != null; }
    function userRef() { return /databases/$(database)/documents/users/$(request.auth.uid); }
    function hasUserDoc() { return isSignedIn() && exists(userRef()); }
    function userData() { return get(userRef()).data; }

    function isActiveStatus(d) {
      return d != null && (
        ('status' in d && (d.status == 'active' || d.status == 'ACTIVE'))
        || ('approvalStatus' in d && (d.approvalStatus == 'ACTIVE' || d.approvalStatus == 'APPROVED' || d.approvalStatus == 'active'))
        || ((!('status' in d) || d.status == null) && (!('approvalStatus' in d) || d.approvalStatus == null) && d.isActive == true)
      );
    }

    function isInternalTypeData(d) {
      return d != null && !isCustomerPortalData(d) && (
        ('user_type' in d && (d.user_type == 'internal' || d.user_type == 'INTERNAL'))
        || ('userType' in d && d.userType is string && d.userType.lower() == 'internal')
        || (!('user_type' in d) && !('userType' in d))
      );
    }

    function isCustomerPortalData(d) {
      return d != null && (
        ('user_type' in d && (d.user_type == 'customer_portal' || d.user_type == 'CUSTOMER_PORTAL'))
        || ('userType' in d && d.userType == 'customer_portal')
      );
    }

    /** Single role source — assignedRoleKey only; normalize 'operation_manager' typo */
    function canonicalAssignedRoleKey(d) {
      return d != null && 'assignedRoleKey' in d && d.assignedRoleKey is string && d.assignedRoleKey.size() > 0
        ? (d.assignedRoleKey.lower() == 'operation_manager' ? 'operations_manager' : d.assignedRoleKey.lower())
        : '';
    }

    function primaryRole(d) { return canonicalAssignedRoleKey(d); }
    function userRole() { return canonicalAssignedRoleKey(userData()); }

    function isInternalUser() {
      return hasUserDoc() && isActiveStatus(userData()) && isInternalTypeData(userData());
    }

    function isClientPortalUser() {
      return hasUserDoc() && isActiveStatus(userData()) && isCustomerPortalData(userData());
    }

    function isAdmin() { return isInternalUser() && userRole() == 'system_admin'; }
    function isAccounting() { return isInternalUser() && (userRole() == 'accounting_manager' || userRole() == 'accounting_officer'); }

    /** ใช้ใน append-only collection (audit logs, etc.) */
    function internalStaffFirestoreActor() {
      return isSignedIn() && exists(userRef()) && isInternalTypeData(get(userRef()).data) && !isCustomerPortalData(get(userRef()).data);
    }

    /** Portal scope helper — admin วาง preserved blocks ของ portal เอง */
    function portalCustomerIdOk() {
      return isClientPortalUser() && 'customerId' in userData() && userData().customerId is string;
    }

    function portalOwnsResourceCustomerId() {
      return portalCustomerIdOk() && resource.data.customerId == userData().customerId;
    }

`;
}

const PORTAL_ROLE_KEYS: readonly BusinessRoleKey[] = ['client_user'];
const SELF_ROLE_KEYS: readonly BusinessRoleKey[] = ['employee_self'];

function buildGateExpr(roles: readonly BusinessRoleKey[]): string {
  if (roles.length === 0) return 'isAdmin()';
  const internalRoles = roles.filter((r) => !PORTAL_ROLE_KEYS.includes(r));
  const portalRoles = roles.filter((r) => PORTAL_ROLE_KEYS.includes(r));

  const clauses: string[] = [];
  if (internalRoles.length > 0) {
    const list = internalRoles.map((r) => `'${r}'`).join(', ');
    if (internalRoles.includes('system_admin')) {
      clauses.push(`(isInternalUser() && userRole() in [${list}])`);
    } else {
      clauses.push(`isAdmin()`);
      clauses.push(`(isInternalUser() && userRole() in [${list}])`);
    }
  } else {
    clauses.push(`isAdmin()`);
  }
  if (portalRoles.length > 0) {
    const list = portalRoles.map((r) => `'${r}'`).join(', ');
    clauses.push(`(isClientPortalUser() && userRole() in [${list}])`);
  }
  return clauses.join(' || ');
}

/** ตรวจว่า V/C/E/D/A เหมือนกันทั้งหมดไหม — ถ้าเหมือนหมด ยุบเป็นฟังก์ชันเดียว */
function isUniformAllowance(allowance: CapabilityRoleAllowance[]): boolean {
  if (allowance.length === 0) return false;
  const sig = (roles: readonly BusinessRoleKey[]) => [...roles].sort().join('|');
  const first = sig(allowance[0].roles);
  return allowance.every((a) => sig(a.roles) === first);
}

function emitMatrixGateBlock(spec: ModuleFirestoreSpec, allowance: CapabilityRoleAllowance[]): string {
  const lines: string[] = [];
  lines.push(`    // ----- ${spec.label} (${spec.moduleKey}) -----`);

  if (isUniformAllowance(allowance)) {
    /** V/C/E/D/A เท่ากันหมด — emit `canFullX()` ตัวเดียว */
    const roles = allowance[0].roles;
    const expr = buildGateExpr(roles);
    lines.push(`    function canFull${spec.fnPrefix}() { return ${expr}; }`);
  } else {
    for (const a of allowance) {
      /** capability 'view' → emit เป็น canRead (เพื่อ match กับ Firestore terminology + เลี่ยงชน canView vs canRead) */
      const capName = a.capability === 'view' ? 'Read' : capitalizeFirst(a.capability);
      const fnName = `can${capName}${spec.fnPrefix}`;
      const expr = buildGateExpr(a.roles);
      if (a.roles.length === 0) {
        lines.push(`    function ${fnName}() { return ${expr}; }  // ${CAPABILITY_LABEL_TH[a.capability]}: admin only`);
      } else {
        lines.push(`    function ${fnName}() { return ${expr}; }`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function emitMatchActions(spec: ModuleFirestoreSpec, allowance: CapabilityRoleAllowance[]): string[] {
  if (isUniformAllowance(allowance)) {
    return [`      allow read, write: if canFull${spec.fnPrefix}();`];
  }
  const p = spec.fnPrefix;
  return [
    `      allow read:   if canRead${p}();`,
    `      allow create: if canCreate${p}();`,
    `      allow update: if canEdit${p}() || canApprove${p}();`,
    `      allow delete: if canDelete${p}();`,
  ];
}

function emitSimpleMatch(
  spec: ModuleFirestoreSpec,
  path: string,
  shape: string | undefined,
  allowance: CapabilityRoleAllowance[],
): string {
  const p = spec.fnPrefix;
  const lines: string[] = [];

  if (shape === 'admin-only') {
    lines.push(`    match /${path} {`);
    lines.push(`      allow read, write: if isAdmin();`);
    lines.push(`    }`);
  } else if (shape === 'read-only') {
    if (isUniformAllowance(allowance)) {
      lines.push(`    match /${path} {`);
      lines.push(`      allow read: if canFull${p}();`);
      lines.push(`    }`);
    } else {
      lines.push(`    match /${path} {`);
      lines.push(`      allow read: if canRead${p}();`);
      lines.push(`    }`);
    }
  } else if (shape === 'append-only') {
    if (isUniformAllowance(allowance)) {
      lines.push(`    match /${path} {`);
      lines.push(`      allow read: if canFull${p}();`);
      lines.push(`      allow create: if internalStaffFirestoreActor();`);
      lines.push(`      allow update, delete: if isAdmin();`);
      lines.push(`    }`);
    } else {
      lines.push(`    match /${path} {`);
      lines.push(`      allow read: if canRead${p}();`);
      lines.push(`      allow create: if internalStaffFirestoreActor();`);
      lines.push(`      allow update, delete: if isAdmin();`);
      lines.push(`    }`);
    }
  } else {
    lines.push(`    match /${path} {`);
    for (const line of emitMatchActions(spec, allowance)) {
      lines.push(line);
    }
    lines.push(`    }`);
  }
  lines.push('');
  return lines.join('\n');
}

function emitPreservedPlaceholder(path: string): string {
  return [
    `    // ⚠️ PRESERVE-FROM-ORIGINAL: ${path}`,
    `    //   วาง match block เดิมจาก firestore.rules ที่นี่ (portal scope / status guard / business logic)`,
    `    //   อย่าใช้ generated gate กับ path นี้`,
    ``,
  ].join('\n');
}

export interface GenerateFullRulesOptions extends GenerateRulesOptions {
  /** ตัด preserved placeholder ออก (ใช้ตอน preview เฉพาะ matrix part) */
  skipPreservedPlaceholders?: boolean;
}

export interface GenerateFullRulesResult {
  text: string;
  stats: {
    moduleCount: number;
    matrixMatchBlocks: number;
    preservedPlaceholders: number;
    predicateCount: number;
    estimatedBytes: number;
  };
}

export function generateFullSimplifiedRules(opts: GenerateFullRulesOptions): GenerateFullRulesResult {
  const { overrides, baseline, generatedAt, generatedBy, skipPreservedPlaceholders } = opts;
  const ts = new Date(generatedAt ?? Date.now()).toISOString();

  const header: string[] = [
    `rules_version = '2';`,
    `// =====================================================================`,
    `// GENERATED firestore.rules (simplified, matrix-driven)`,
    `// Source: /system-admin/menu-permissions + module-to-firestore-paths.ts`,
    `// Generated: ${ts}`,
    `// By: ${generatedBy ?? 'unknown'}`,
    `// =====================================================================`,
    `// ⚠️ Pre-flight checklist ก่อน deploy:`,
    `//   1. ทุก block ที่มี comment '⚠️ PRESERVE-FROM-ORIGINAL' ต้องวาง match block เดิม`,
    `//      จาก firestore.rules ปัจจุบัน (portal scope / status guard / business logic)`,
    `//   2. ทดสอบใน emulator: firebase emulators:start --only firestore`,
    `//   3. ทดสอบบทบาทสำคัญ: admin / hr_manager / accounting_officer / client_user`,
    `//   4. Deploy: npm run deploy:rules (รอ Google API 503 หาย)`,
    `// =====================================================================`,
    ``,
    `service cloud.firestore {`,
    `  match /databases/{database}/documents {`,
    ``,
  ];

  /** Core helpers */
  const helpersText = emitCoreHelpers();

  /** Generate matrix gates */
  const gatesHeader: string[] = [
    `    // =====================================================================`,
    `    // MATRIX-DERIVED GATES (auto-generated from /system-admin/menu-permissions)`,
    `    // =====================================================================`,
    ``,
  ];

  const gateBlocks: string[] = [];
  const matchBlocks: string[] = [];
  const preserved: string[] = [];
  let predicateCount = 0;
  let matrixMatchCount = 0;
  let preservedCount = 0;

  /** จัดกลุ่มตาม domain */
  const byDomain = new Map<ModuleFirestoreSpec['domain'], ModuleFirestoreSpec[]>();
  for (const spec of MODULE_FIRESTORE_SPECS) {
    const arr = byDomain.get(spec.domain) ?? [];
    arr.push(spec);
    byDomain.set(spec.domain, arr);
  }

  for (const [domain, list] of byDomain.entries()) {
    gateBlocks.push(`    // ===== ${DOMAIN_HEADER_TH[domain]} — Gates =====`);
    gateBlocks.push('');
    matchBlocks.push(`    // ===== ${DOMAIN_HEADER_TH[domain]} — Match blocks =====`);
    matchBlocks.push('');

    for (const spec of list) {
      const allowance = effectiveRoleAllowanceForModule(spec.moduleKey, overrides, baseline);
      gateBlocks.push(emitMatrixGateBlock(spec, allowance));
      predicateCount += CAPABILITY_LIST.length;

      if (spec.paths.length === 0) {
        matchBlocks.push(`    // [${spec.moduleKey}] — ${spec.label}: ไม่มี Firestore path (${spec.note ?? 'UI-only'})`);
        matchBlocks.push('');
        continue;
      }

      for (const p of spec.paths) {
        if (shouldPreservePath(p.path) && !skipPreservedPlaceholders) {
          preserved.push(emitPreservedPlaceholder(p.path));
          preservedCount += 1;
        } else {
          if (p.note) matchBlocks.push(`    // NOTE: ${p.note}`);
          matchBlocks.push(emitSimpleMatch(spec, p.path, p.shape, allowance));
          matrixMatchCount += 1;
        }
      }
    }
  }

  /** Preserved section */
  const preservedSection = preserved.length > 0
    ? [
        `    // =====================================================================`,
        `    // ⚠️ PRESERVED ORIGINAL LOGIC — ต้องคัดลอกจาก firestore.rules ปัจจุบันมาวางที่นี่`,
        `    //   collections เหล่านี้มี business logic ที่ matrix ไม่ครอบคลุม (portal scope,`,
        `    //   status guards, numbering, append-only validation ฯลฯ)`,
        `    // =====================================================================`,
        ``,
        ...preserved,
      ].join('\n')
    : '';

  const footer = [`  }`, `}`, ``];

  const fullText = [
    ...header,
    helpersText,
    ...gatesHeader,
    ...gateBlocks,
    `    // =====================================================================`,
    `    // MATCH BLOCKS (matrix-gated; simple collections only)`,
    `    // =====================================================================`,
    ``,
    ...matchBlocks,
    preservedSection,
    ...footer,
  ].join('\n');

  return {
    text: fullText,
    stats: {
      moduleCount: MODULE_FIRESTORE_SPECS.length,
      matrixMatchBlocks: matrixMatchCount,
      preservedPlaceholders: preservedCount,
      predicateCount,
      estimatedBytes: new TextEncoder().encode(fullText).length,
    },
  };
}
