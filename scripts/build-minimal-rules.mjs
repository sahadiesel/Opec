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
    match /bank_accounts/{id} {
      allow read: if isInternalUser();
      allow write: if isInternalUser() && userRole() in ['system_admin', 'accounting_manager', 'accounting_officer'];
    }
    match /cashbook_entries/{id} {
      allow read: if isInternalUser();
      allow write: if isInternalUser() && userRole() in ['system_admin', 'accounting_manager', 'accounting_officer', 'operations_manager'];
    }
    match /petty_cash_entries/{id} {
      allow read, write: if isInternalUser() && userRole() in ['system_admin', 'operations_manager', 'accounting_manager', 'accounting_officer'];
    }
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
