/**
 * CLI: ดึง match blocks ที่ต้อง preserve จาก firestore.rules ปัจจุบัน
 * แล้วเขียนทับใน firestore.rules.simplified.draft ตามตำแหน่ง '⚠️ PRESERVE-FROM-ORIGINAL: <path>'
 *
 * ใช้:
 *   npx tsx scripts/extract-preserved-rules-blocks.ts
 *
 * Output: firestore.rules.simplified.draft (เขียนทับเฉพาะ preserved markers)
 *
 * หมายเหตุ: parser ใช้การนับ { } เพื่อหาขอบ block — สำหรับ rules ที่เขียนถูกต้อง syntax
 * (ปัจจุบันใช้กับ firestore.rules ของ Opec ได้)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const RULES_ORIGINAL = resolve(process.cwd(), 'firestore.rules');
const DRAFT_PATH = resolve(process.cwd(), 'firestore.rules.simplified.draft');

/** ดึง match block ตาม path pattern */
function extractMatchBlock(rulesText: string, pathPattern: string): string | null {
  /** หา `match /<pathPattern> {` (ระวัง escape regex) */
  const escaped = pathPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`^(\\s*)match\\s+/${escaped}\\s*\\{`, 'm');
  const match = startRe.exec(rulesText);
  if (!match) return null;

  const startIdx = match.index;
  /** count braces from `{` after match */
  let i = startIdx + match[0].length - 1;
  let depth = 1;
  i += 1;
  while (i < rulesText.length && depth > 0) {
    const ch = rulesText[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  if (depth !== 0) return null;
  return rulesText.substring(startIdx, i);
}

/** ดึง function definition พร้อม body */
function extractFunctionBlock(rulesText: string, fnName: string): string | null {
  const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`(^\\s*function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{)`, 'm');
  const m = startRe.exec(rulesText);
  if (!m) return null;
  const startIdx = m.index;
  /** หา `{` แรกหลัง function name */
  let i = rulesText.indexOf('{', m.index);
  if (i < 0) return null;
  let depth = 1;
  i += 1;
  while (i < rulesText.length && depth > 0) {
    const ch = rulesText[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  if (depth !== 0) return null;
  return rulesText.substring(startIdx, i);
}

/** หา helper function names ที่ถูกเรียกใน body */
function findCalledFunctions(text: string): string[] {
  const re = /\b([a-z][a-zA-Z0-9_]*)\s*\(/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    /** กรอง keyword/built-in */
    if (
      ['if', 'else', 'return', 'function', 'match', 'allow', 'service', 'in', 'is'].includes(name)
    ) continue;
    out.add(name);
  }
  return [...out];
}

/** ดึง helper เดียว + dependency recursive */
function extractHelpersRecursive(
  rulesText: string,
  initial: readonly string[],
  declaredInDraft: ReadonlySet<string>,
): Map<string, string> {
  const collected = new Map<string, string>();
  const queue = [...initial];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const fn = queue.shift()!;
    if (visited.has(fn)) continue;
    visited.add(fn);
    if (declaredInDraft.has(fn) || collected.has(fn)) continue;
    const block = extractFunctionBlock(rulesText, fn);
    if (!block) continue;
    collected.set(fn, block);
    const deps = findCalledFunctions(block);
    for (const d of deps) {
      if (!visited.has(d) && !declaredInDraft.has(d)) queue.push(d);
    }
  }
  return collected;
}

/** ทำให้ block indent 4-space (matches preserved section indent) */
function reindentTo4(block: string): string {
  /** หาส่วน leading whitespace ของบรรทัดแรก แล้ว normalize */
  const lines = block.split('\n');
  const firstIndent = (lines[0].match(/^(\s*)/)?.[1].length) ?? 0;
  const targetIndent = 4;
  const adjust = (line: string): string => {
    if (line.trim() === '') return '';
    const m = line.match(/^(\s*)(.*)$/);
    if (!m) return line;
    const cur = m[1].length;
    const rest = m[2];
    const newIndent = Math.max(0, cur - firstIndent + targetIndent);
    return ' '.repeat(newIndent) + rest;
  };
  return lines.map(adjust).join('\n');
}

function main() {
  if (!existsSync(RULES_ORIGINAL)) {
    console.error(`firestore.rules not found at ${RULES_ORIGINAL}`);
    process.exit(1);
  }
  if (!existsSync(DRAFT_PATH)) {
    console.error(`firestore.rules.simplified.draft not found at ${DRAFT_PATH}`);
    console.error('Run `npm run generate:rules-simplified` first');
    process.exit(1);
  }

  const original = readFileSync(RULES_ORIGINAL, 'utf8');
  let draft = readFileSync(DRAFT_PATH, 'utf8');

  /** หา marker pattern: '// ⚠️ PRESERVE-FROM-ORIGINAL: <path>' + 2 lines comment */
  const markerRe = /\/\/\s*⚠️\s*PRESERVE-FROM-ORIGINAL:\s*(.+)\r?\n\s*\/\/\s*วาง match block.+?\r?\n\s*\/\/\s*อย่าใช้ generated gate.+?\r?\n/g;

  const replacements: Array<{ path: string; success: boolean; reason?: string }> = [];

  draft = draft.replace(markerRe, (full, path: string) => {
    const trimmedPath = path.trim();
    const block = extractMatchBlock(original, trimmedPath);
    if (!block) {
      replacements.push({ path: trimmedPath, success: false, reason: 'not found in original' });
      return `    // ❌ PRESERVE-FAILED (not found in original): ${trimmedPath}\n${full}`;
    }
    replacements.push({ path: trimmedPath, success: true });
    return `    // ✅ PRESERVED from original (${trimmedPath})\n${reindentTo4(block)}\n\n`;
  });

  /** หา helper functions ที่ preserved blocks เรียก แต่ยังไม่มีใน draft */
  const declared = new Set(
    [...draft.matchAll(/\bfunction\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map((m) => m[1]),
  );
  /** สแกนใน preserved section เท่านั้น (กันการหยิบ generated gate ที่มีอยู่แล้ว) */
  const preservedSectionStart = draft.indexOf('PRESERVED ORIGINAL LOGIC');
  const preservedSection = preservedSectionStart > 0 ? draft.substring(preservedSectionStart) : draft;
  const calledByPreserved = findCalledFunctions(preservedSection);
  const missingFromDraft = calledByPreserved.filter((fn) => !declared.has(fn));

  const helperMap = extractHelpersRecursive(original, missingFromDraft, declared);

  /** Inject helpers ก่อน '// MATRIX-DERIVED GATES' marker */
  const gatesMarker = '// MATRIX-DERIVED GATES';
  const injectIdx = draft.indexOf(gatesMarker);
  if (helperMap.size > 0 && injectIdx > 0) {
    const helpersText = [
      `    // =====================================================================`,
      `    // PRESERVED HELPERS — ดึงจาก firestore.rules เดิม (ใช้โดย preserved match blocks)`,
      `    // =====================================================================`,
      ``,
      ...[...helperMap.entries()].map(([, body]) => body + '\n'),
      ``,
    ].join('\n');
    /** หา line begin ก่อน gates marker เพื่อ inject อย่างถูก indent */
    const lineStart = draft.lastIndexOf('\n', injectIdx) + 1;
    /** ข้ามไปบรรทัด comment '// ====' ด้านบน gatesMarker */
    const commentLineStart = draft.lastIndexOf('// =====', injectIdx);
    const safeInjectIdx = commentLineStart > 0 ? draft.lastIndexOf('\n', commentLineStart - 1) + 1 : lineStart;
    draft = draft.substring(0, safeInjectIdx) + helpersText + draft.substring(safeInjectIdx);
  }

  /** Strip blank lines เพื่อลดขนาด (ใช้ --keep-blanks เพื่อเก็บไว้) */
  const keepBlanks = process.argv.includes('--keep-blanks');
  if (!keepBlanks) {
    draft = draft.split('\n').filter((l) => l.trim().length > 0).join('\n') + '\n';
  }

  writeFileSync(DRAFT_PATH, draft, 'utf8');

  const ok = replacements.filter((r) => r.success).length;
  const fail = replacements.filter((r) => !r.success).length;
  console.log('=================================================================');
  console.log(`Preserved blocks merged into ${DRAFT_PATH}`);
  console.log('=================================================================');
  console.log(`Match blocks   : success=${ok} fail=${fail}`);
  console.log(`Helpers pulled : ${helperMap.size} (recursive)`);
  if (fail > 0) {
    console.log('');
    console.log('Failed paths (admin ต้องวาง block เดิมเอง):');
    for (const r of replacements.filter((x) => !x.success)) {
      console.log(`  - ${r.path} (${r.reason})`);
    }
  }

  /** ตรวจซ้ำว่า helper อะไรยังขาดอีก (กรอง built-ins + globals ออก) */
  const FIRESTORE_BUILTINS = new Set([
    'exists', 'existsAfter', 'get', 'getAfter', 'lower', 'upper', 'size', 'matches', 'split',
    'trim', 'startsWith', 'endsWith', 'toMillis', 'duration', 'date', 'time', 'difference',
    'toBytes', 'hasAll', 'hasAny', 'hasOnly', 'keys', 'diff', 'affectedKeys', 'addedKeys',
    'changedKeys', 'removedKeys', 'unchangedKeys', 'union', 'intersection',
    'min', 'max', 'abs', 'ceil', 'floor', 'round', 'sqrt', 'pow', 'isNan', 'isFinite',
    'path', 'rules', 'collection', 'request', 'resource', 'isPath', 'reader', 'writer',
  ]);
  /** ยังกรอง false positive จาก string literal / variable name ใน body */
  const STRING_LITERAL_FALSE_POSITIVES = new Set(['original', 'reader', 'writer']);

  const declaredAfter = new Set(
    [...draft.matchAll(/\bfunction\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map((m) => m[1]),
  );
  const allCalls = findCalledFunctions(draft);
  const stillMissing = allCalls.filter(
    (fn) =>
      !declaredAfter.has(fn) && !FIRESTORE_BUILTINS.has(fn) && !STRING_LITERAL_FALSE_POSITIVES.has(fn),
  );
  if (stillMissing.length > 0) {
    console.log('');
    console.log('⚠️ ยังมี helpers ที่อ้างถึงแต่ไม่ได้นิยาม (ต้อง add เอง):');
    for (const fn of stillMissing.slice(0, 30)) console.log(`  - ${fn}`);
    if (stillMissing.length > 30) console.log(`  ... และอีก ${stillMissing.length - 30}`);
  } else {
    console.log('');
    console.log('✅ ไม่มี helper functions ที่ขาด — ไฟล์พร้อมทดสอบ');
  }

  /** ตรวจ brace balance */
  let braceDepth = 0;
  for (const ch of draft) {
    if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth -= 1;
  }
  if (braceDepth !== 0) {
    console.log(`⚠️ Brace balance: depth=${braceDepth} (ไม่สมดุล! ต้องตรวจสอบ)`);
  } else {
    console.log('✅ Brace balance: สมดุล');
  }

  const newSize = Buffer.byteLength(draft, 'utf8');
  console.log('');
  console.log(`Final draft size: ${(newSize / 1024).toFixed(1)} KB`);
  console.log('');
  console.log('Next:');
  console.log('  1. ทดสอบใน emulator: npx firebase emulators:start --only firestore');
  console.log('  2. เมื่อโอเค: rename → firestore.rules + npm run deploy:rules');
}

main();
