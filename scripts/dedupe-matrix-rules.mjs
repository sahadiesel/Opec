/**
 * Dedupe matrix-generated predicate functions in firestore.rules.
 * Many `canFullX()`, `canReadX()`, etc. share identical role lists.
 * Replace each unique role expression with a single `rs{N}()` helper.
 *
 * Usage:
 *   node scripts/dedupe-matrix-rules.mjs              -> writes firestore.rules.deduped
 *   node scripts/dedupe-matrix-rules.mjs --in-place   -> overwrites firestore.rules
 *   node scripts/dedupe-matrix-rules.mjs --stats      -> just print stats, don't write
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const RULES_PATH = resolve(process.cwd(), 'firestore.rules');
const OUT_PATH = process.argv.includes('--in-place')
  ? RULES_PATH
  : resolve(process.cwd(), 'firestore.rules.deduped');

function dedupe(text) {
  /** One-line matrix function defs: `    function canFullX() { return (...); }` */
  const fnRe = /^([ \t]*)function\s+(can(?:Full|Read|Create|Edit|Delete|Approve)[A-Za-z0-9_]+)\(\)\s*\{\s*return\s+(.+?);\s*\}\s*$/gm;

  /** name -> expression body */
  const nameToBody = new Map();
  /** body -> rs id */
  const bodyToId = new Map();
  let nextId = 0;

  /** First pass: collect */
  let m;
  while ((m = fnRe.exec(text)) !== null) {
    const [, , name, body] = m;
    nameToBody.set(name, body.trim());
    if (!bodyToId.has(body.trim())) {
      bodyToId.set(body.trim(), `rs${nextId++}`);
    }
  }

  /** Stats */
  console.log(`Matrix functions    : ${nameToBody.size}`);
  console.log(`Unique role bodies  : ${bodyToId.size}`);

  if (process.argv.includes('--stats')) {
    /** Print body -> count */
    const counts = new Map();
    for (const [name, body] of nameToBody.entries()) {
      counts.set(body, (counts.get(body) || 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    console.log('\nMost-shared role bodies:');
    for (const [body, count] of sorted.slice(0, 10)) {
      console.log(`  x${count}: ${body.substring(0, 120)}${body.length > 120 ? '...' : ''}`);
    }
    return text;
  }

  /** Remove all matrix function defs */
  let out = text.replace(fnRe, '');

  /** Replace each call: `canFullX()` -> `rs{N}()` */
  for (const [name, body] of nameToBody.entries()) {
    const rsId = bodyToId.get(body);
    const callRe = new RegExp(`\\b${name}\\(\\)`, 'g');
    out = out.replace(callRe, `${rsId}()`);
  }

  /** Emit dedupe helpers near the top, after core helpers (find a good insertion point) */
  const insertMarker = '    // =====================================================================\n    // PRESERVED HELPERS';
  const helperLines = ['    // ===== Matrix role sets (deduped) ====='];
  for (const [body, id] of bodyToId.entries()) {
    helperLines.push(`    function ${id}() { return ${body}; }`);
  }
  helperLines.push('');

  if (out.indexOf(insertMarker) >= 0) {
    out = out.replace(insertMarker, helperLines.join('\n') + '\n' + insertMarker);
  } else {
    /** Fall back: insert after 'function portalOwnsResourceCustomerId' */
    const fallback = "function portalOwnsResourceCustomerId() {";
    const fbIdx = out.indexOf(fallback);
    if (fbIdx >= 0) {
      const closeIdx = out.indexOf('}', fbIdx) + 1;
      out = out.substring(0, closeIdx) + '\n\n' + helperLines.join('\n') + out.substring(closeIdx);
    } else {
      console.warn('Could not find insertion point; helpers prepended at top of match block');
    }
  }

  /** Strip blank lines */
  out = out.split('\n').filter((l) => l.trim().length > 0).join('\n') + '\n';

  return out;
}

function main() {
  const src = readFileSync(RULES_PATH, 'utf8');
  const before = {
    bytes: src.length,
    lines: src.split('\n').length,
    fns: (src.match(/^\s*function\s+\w+/gm) || []).length,
  };
  const out = dedupe(src);
  const after = {
    bytes: out.length,
    lines: out.split('\n').length,
    fns: (out.match(/^\s*function\s+\w+/gm) || []).length,
  };
  if (process.argv.includes('--stats')) return;
  writeFileSync(OUT_PATH, out, 'utf8');
  console.log('');
  console.log('=================================================================');
  console.log(`Wrote ${OUT_PATH}`);
  console.log('=================================================================');
  console.log(`Before : ${before.fns} fns, ${before.lines} lines, ${before.bytes} bytes`);
  console.log(`After  : ${after.fns} fns, ${after.lines} lines, ${after.bytes} bytes`);
  console.log(`Delta  : -${before.fns - after.fns} fns, -${before.lines - after.lines} lines, ${after.bytes - before.bytes} bytes`);
}

main();
