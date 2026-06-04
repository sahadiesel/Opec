/**
 * Build a deploy-ready minimal rules variant from firestore.rules.simplified.draft.
 *   - Replace PRESERVE-FROM-ORIGINAL placeholders with admin-only fallback
 *   - ASCII sanitize
 *   - Dedupe matrix predicate functions
 *
 * Output: firestore.rules.minimal
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const SRC_PATH = resolve(process.cwd(), 'firestore.rules.simplified.draft');
const OUT_PATH = resolve(process.cwd(), 'firestore.rules.minimal');

function sanitizeAscii(text) {
  return text
    .replace(/\u26a0\ufe0f|\u26a0/g, '!')
    .replace(/\u2014|\u2013/g, '-')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/[^\x00-\x7F]+/g, '');
}

/**
 * Per-path fallback rules. Lost portal-scope and status-guard logic,
 * but keeps the matching user groups reachable so the app still works.
 */
const PATH_FALLBACKS = {
  'customers/{customerId}/{document=**}':
    'allow read: if isInternalUser() || (isClientPortalUser() && customerId == userData().customerId); allow write: if isInternalUser();',
  'commercial_invoices/{id}': 'allow read, write: if isInternalUser();',
  'daily_timesheets/{id}': 'allow read, write: if isInternalUser();',
  'attendance_correction_requests/{id}': 'allow read, write: if isInternalUser();',
  'attendance_overtime_requests/{id}': 'allow read, write: if isInternalUser();',
  'leave_requests/{id}': 'allow read, write: if isInternalUser();',
  'cash_advance_requests/{id}': 'allow read, write: if isInternalUser();',
  'withholding_certificate_documents/{id}': 'allow read, write: if isInternalUser();',
  'system/{docId}': 'allow read, write: if isAdmin();',
  'audit_logs/{id}': 'allow read: if isInternalUser(); allow create: if internalStaffFirestoreActor(); allow update, delete: if isAdmin();',
};

/**
 * Extra critical match blocks the matrix generator never emits because
 * the paths aren't tied to a UI module (login flow, kiosk sessions, etc.).
 * Appended right before the closing braces of `match /databases/{database}/documents`.
 */
const EXTRA_BLOCKS = `
    // ===== Critical infrastructure paths (not in matrix) =====
    match /users/{userId} {
      allow get: if request.auth != null && (
        request.auth.uid == userId
        || isAdmin()
        || isInternalUser()
      );
      allow list: if isAdmin() || isInternalUser();
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update: if request.auth != null && (request.auth.uid == userId || isAdmin());
      allow delete: if isAdmin();
    }
    match /auth_register_pendings/{id} {
      allow read, write: if request.auth != null;
    }
    match /number_sequences/{id} {
      allow read, write: if isInternalUser();
    }
    match /client_portal/{document=**} {
      allow read, write: if isInternalUser() || isClientPortalUser();
    }
    match /workers/{workerId} {
      allow read, write: if isInternalUser();
    }
    match /attendance_kiosk_sessions/{token} {
      allow read, write: if isInternalUser();
    }
    match /attendance_punches/{id} {
      allow read, write: if isInternalUser();
    }
    match /attendance_day_overrides/{id} {
      allow read, write: if isInternalUser();
    }
    match /payroll_correction_requests/{id} {
      allow read, write: if isInternalUser();
    }
    match /withholding_certificate_documents/{docId}/audit_logs/{logId} {
      allow read: if isInternalUser();
      allow write: if internalStaffFirestoreActor();
    }
    match /withholding_certificate_documents/{docId}/xml_export_logs/{logId} {
      allow read: if isInternalUser();
      allow write: if internalStaffFirestoreActor();
    }
    match /purchase_orders/{purchaseOrderId}/po_lines/{lineId} {
      allow read, write: if isInternalUser();
    }
    match /purchase_orders/{purchaseOrderId}/{document=**} {
      allow read, write: if isInternalUser();
    }
    // bank_accounts / cashbook are owned by accounting, but operations_manager
    // needs READ access for the Petty Cash page (filtered client-side by accountType).
    // Operations manager may also UPDATE petty-cash bank accounts (currentBalance
    // increments) so they can post petty cash entries that adjust the fund balance.
    match /bank_accounts/{id} {
      allow read: if isInternalUser();
      allow create, delete: if isInternalUser() && userRole() in ['system_admin', 'accounting_manager', 'accounting_officer'];
      allow update: if isInternalUser() && (
        userRole() in ['system_admin', 'accounting_manager', 'accounting_officer']
        || (
          userRole() == 'operations_manager'
          && resource.data.accountType == 'PETTY_CASH'
        )
      );
    }
    match /cashbook_entries/{id} {
      allow read: if isInternalUser();
      allow write: if isInternalUser() && userRole() in ['system_admin', 'accounting_manager', 'accounting_officer', 'operations_manager'];
    }
    match /petty_cash_entries/{id} {
      allow read, write: if isInternalUser() && userRole() in ['system_admin', 'operations_manager', 'accounting_manager', 'accounting_officer'];
    }
    // permission_profiles: every signed-in user reads their own role's profile
    // to compute UI permissions; only admin can edit role templates.
    match /permission_profiles/{id} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }
    // menu_permission_overrides: same pattern - all users read effective
    // matrix to render UI; only admin writes overrides.
    match /menu_permission_overrides/{id} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }
    match /system/company_profile {
      allow read: if isInternalUser() || isClientPortalUser();
      allow write: if isAdmin();
    }
    match /system/drug_test_panel {
      allow read: if isInternalUser();
      allow write: if isAdmin();
    }
    // ===== Broad READ fallback for internal staff =====
    // Matrix gates above narrow write access by role, but every internal
    // user needs READ visibility on core business collections to do their
    // jobs (officers below manager level still need to see contracts,
    // quotes, workers, positions, vendors, POs, assignments, etc.).
    // These blocks are evaluated independently from the matrix blocks;
    // either passing grants read. Writes remain matrix-constrained.
    match /main_contracts/{id} { allow read: if isInternalUser(); }
    match /main_contracts/{contractId}/position_rates/{rateId} { allow read: if isInternalUser(); }
    match /main_contracts/{contractId}/{document=**} { allow read: if isInternalUser(); }
    match /quotations/{id} { allow read: if isInternalUser(); }
    match /quotations/{quotationId}/lines/{lineId} { allow read: if isInternalUser(); }
    match /quotations/{quotationId}/{document=**} { allow read: if isInternalUser(); }
    match /vendors/{id} { allow read: if isInternalUser(); }
    match /positions/{id} { allow read: if isInternalUser(); }
    match /position_templates/{id} { allow read: if isInternalUser(); }
    match /assignments/{id} { allow read: if isInternalUser(); }
    match /waves/{id} { allow read: if isInternalUser(); }
    match /mobilization/{id} { allow read: if isInternalUser(); }
    match /purchase_orders/{id} { allow read: if isInternalUser(); }
    match /rate_conditions/{id} { allow read: if isInternalUser(); }
    match /profit_estimates/{id} { allow read: if isInternalUser(); }
    match /sales_contract_terms/{id} { allow read: if isInternalUser(); }
    match /tax_invoices/{id} { allow read: if isInternalUser(); }
    match /billing_notes/{id} { allow read: if isInternalUser(); }
    match /receipts/{id} { allow read: if isInternalUser(); }
    match /ap_bills/{id} { allow read: if isInternalUser(); }
    match /accounts_receivable/{id} { allow read: if isInternalUser(); }
    match /accounts_payable/{id} { allow read: if isInternalUser(); }
    match /withholding_tax_items/{id} { allow read: if isInternalUser(); }
    match /cashbook/{id} { allow read: if isInternalUser(); }
    match /payroll_runs/{id} { allow read: if isInternalUser(); }
    match /payslips/{id} { allow read: if isInternalUser(); }
    match /office_payroll/{id} { allow read: if isInternalUser(); }
    match /worker_payroll/{id} { allow read: if isInternalUser(); }
    match /payment_export_batches/{id} { allow read: if isInternalUser(); }
    match /employees/{id} { allow read: if isInternalUser(); }
    match /worker_documents/{id} { allow read: if isInternalUser(); }
    match /timesheets/{id} { allow read: if isInternalUser(); }
    match /hr_hub/{id} { allow read: if isInternalUser(); }
    match /store_inventory/{id} { allow read: if isInternalUser(); }
    match /vendor_bills/{id} { allow read: if isInternalUser(); }
    match /vendor_bills/{billId}/{document=**} { allow read: if isInternalUser(); }
    match /labor_cost_contract_terms/{id} { allow read: if isInternalUser(); }
    match /office_staff/{id} {
      allow read: if isInternalUser();
      allow create, update: if isInternalUser() && userRole() in ['system_admin', 'hr_manager', 'hr_officer', 'payroll_officer'];
      allow delete: if isAdmin() || (isInternalUser() && userRole() == 'hr_manager');
    }
    // Payroll subcollections: each batch/run has nested 'lines' read via collectionGroup
    match /{parent}/{batchId}/lines/{lineId} { allow read: if isInternalUser(); }
    // Document numbering / counters used by services across roles
    match /document_numbering/{id} { allow read: if isInternalUser(); allow write: if isAdmin(); }
    match /counters/{id} { allow read: if isInternalUser(); allow write: if isAdmin(); }
    // Master data / lookups used pervasively across UI
    match /bank_master/{id} { allow read: if isInternalUser(); }
    match /departments/{id} { allow read: if isInternalUser(); }
    match /branches/{id} { allow read: if isInternalUser(); }
    match /document_categories/{id} { allow read: if isInternalUser(); }
    match /worker_doc_catalog/{id} { allow read: if isInternalUser(); }
`;

function insertExtraBlocks(text) {
  /** Locate the opening brace of `match /databases/{database}/documents { ... }` —
   *  the LITERAL match-block-opening brace is the one right at end of that line,
   *  not the `{` inside `{database}`. Look for the literal substring including `{` at end. */
  const header = 'match /databases/{database}/documents {';
  const docMatchOpen = text.indexOf(header);
  if (docMatchOpen < 0) return text;
  const blockOpen = docMatchOpen + header.length - 1; // index of the trailing '{'

  let depth = 0;
  let i = blockOpen;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (i >= text.length) return text;
  return text.substring(0, i) + EXTRA_BLOCKS + '\n  ' + text.substring(i);
}

function replacePreservedPlaceholders(text) {
  let count = 0;
  const out = text.replace(
    /^([ \t]*)\/\/\s*!?\s*PRESERVE-FROM-ORIGINAL:\s*(.+?)\r?\n([ \t]*\/\/[^\n]*\r?\n){0,4}/gm,
    (_full, indent, path) => {
      count++;
      const p = path.trim();
      const fallback = PATH_FALLBACKS[p] || 'allow read, write: if isAdmin();';
      const stmts = fallback.split(';').map((s) => s.trim()).filter(Boolean);
      const lines = [
        `${indent}// PRESERVED-PATH (simplified fallback): ${p}`,
        `${indent}match /${p} {`,
        ...stmts.map((s) => `${indent}  ${s};`),
        `${indent}}`,
        '',
      ];
      return lines.join('\n');
    },
  );
  return { text: out, replaced: count };
}

function dedupeMatrixFns(text) {
  const fnRe = /^([ \t]*)function\s+(can(?:Full|Read|Create|Edit|Delete|Approve)[A-Za-z0-9_]+)\(\)\s*\{\s*return\s+(.+?);\s*\}\s*$/gm;
  const nameToBody = new Map();
  const bodyToId = new Map();
  let nextId = 0;

  let m;
  while ((m = fnRe.exec(text)) !== null) {
    const name = m[2];
    const body = m[3].trim();
    nameToBody.set(name, body);
    if (!bodyToId.has(body)) bodyToId.set(body, `rs${nextId++}`);
  }

  let out = text.replace(fnRe, '');
  for (const [name, body] of nameToBody.entries()) {
    const callRe = new RegExp(`\\b${name}\\(\\)`, 'g');
    out = out.replace(callRe, `${bodyToId.get(body)}()`);
  }

  /** Insert role-set helpers after the core-helper block */
  const helperLines = ['    // ===== Matrix role sets (deduped) ====='];
  for (const [body, id] of bodyToId.entries()) {
    helperLines.push(`    function ${id}() { return ${body}; }`);
  }
  helperLines.push('');

  const insertMarker = '    function portalOwnsResourceCustomerId() {';
  const idx = out.indexOf(insertMarker);
  if (idx >= 0) {
    const closeIdx = out.indexOf('}', idx) + 1;
    out = out.substring(0, closeIdx) + '\n' + helperLines.join('\n') + out.substring(closeIdx);
  }

  return { text: out, removed: nameToBody.size, kept: bodyToId.size };
}

function main() {
  let text = readFileSync(SRC_PATH, 'utf8');
  text = sanitizeAscii(text);
  const repl = replacePreservedPlaceholders(text);
  text = repl.text;
  text = insertExtraBlocks(text);
  const dedupe = dedupeMatrixFns(text);
  text = dedupe.text;
  /** Strip blank lines */
  text = text.split('\n').filter((l) => l.trim().length > 0).join('\n') + '\n';

  writeFileSync(OUT_PATH, text, 'utf8');
  const lines = text.split('\n').length;
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`Preserved placeholders replaced (admin-only): ${repl.replaced}`);
  console.log(`Matrix fns deduped : ${dedupe.removed} -> ${dedupe.kept} unique`);
  console.log(`Final size         : ${text.length} bytes / ${lines} lines / ${(text.length / 1024).toFixed(1)} KB`);
  console.log(`Total functions    : ${(text.match(/^\s*function\s+\w+/gm) || []).length}`);
}

main();
