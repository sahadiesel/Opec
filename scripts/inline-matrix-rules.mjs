/**
 * Inline matrix-generated predicate functions (canFullX, canReadX, etc.)
 * to reduce total function count so rules compile within the API's complexity budget.
 *
 * Usage:
 *   node scripts/inline-matrix-rules.mjs           -> writes firestore.rules.inlined
 *   node scripts/inline-matrix-rules.mjs --in-place -> overwrites firestore.rules
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const RULES_PATH = resolve(process.cwd(), 'firestore.rules');
const OUT_PATH = process.argv.includes('--in-place')
  ? RULES_PATH
  : resolve(process.cwd(), 'firestore.rules.inlined');

const MATRIX_PREFIXES = ['canFull', 'canRead', 'canCreate', 'canEdit', 'canDelete', 'canApprove'];

function isMatrixName(name) {
  if (!MATRIX_PREFIXES.some((p) => name.startsWith(p))) return false;
  if (name === 'canRead' || name === 'canWrite') return false;
  return /^can(Full|Read|Create|Edit|Delete|Approve)[A-Z]/.test(name);
}

function inline(text) {
  /** Match one-line function defs: `    function canFullX() { return (...); }` */
  const fnRe = /^([ \t]*)function\s+(can(?:Full|Read|Create|Edit|Delete|Approve)[A-Za-z0-9_]+)\(\)\s*\{\s*return\s+(\(.+?\));\s*\}\s*$/gm;

  const collected = new Map();
  let matched = 0;
  let body = text.replace(fnRe, (full, indent, name, returnExpr) => {
    if (!isMatrixName(name)) return full;
    collected.set(name, returnExpr.trim());
    matched++;
    return '';
  });

  /** Replace all call sites `name()` with `(returnExpr)` */
  let inlined = 0;
  for (const [name, expr] of collected.entries()) {
    const callRe = new RegExp(`\\b${name}\\(\\)`, 'g');
    body = body.replace(callRe, (m) => {
      inlined++;
      return expr;
    });
  }

  /** Strip resulting empty lines from removed function defs */
  body = body.split('\n').filter((l) => l.trim().length > 0 || false).join('\n');

  return { text: body + (body.endsWith('\n') ? '' : '\n'), matched, inlined, distinct: collected.size };
}

function main() {
  const src = readFileSync(RULES_PATH, 'utf8');
  const before = {
    bytes: src.length,
    lines: src.split('\n').length,
    fns: (src.match(/^\s*function\s+\w+/gm) || []).length,
  };
  const { text, matched, inlined, distinct } = inline(src);
  const after = {
    bytes: text.length,
    lines: text.split('\n').length,
    fns: (text.match(/^\s*function\s+\w+/gm) || []).length,
  };
  writeFileSync(OUT_PATH, text, 'utf8');
  console.log('=================================================================');
  console.log(`Wrote ${OUT_PATH}`);
  console.log('=================================================================');
  console.log(`Inlined functions   : ${distinct} distinct (${matched} defs removed, ${inlined} call sites replaced)`);
  console.log(`Before              : ${before.fns} fns, ${before.lines} lines, ${before.bytes} bytes`);
  console.log(`After               : ${after.fns} fns, ${after.lines} lines, ${after.bytes} bytes`);
  console.log(`Delta               : -${before.fns - after.fns} fns, -${before.lines - after.lines} lines, ${after.bytes - before.bytes} bytes`);
}

main();
