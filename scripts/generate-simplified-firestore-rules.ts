/**
 * CLI: สร้าง `firestore.rules.simplified.draft` (ทั้งไฟล์) จาก matrix
 *
 * ใช้:
 *   # ใช้ matrix baseline (ไม่มี overrides):
 *   npx tsx scripts/generate-simplified-firestore-rules.ts
 *
 *   # ใช้ matrix + overrides จาก JSON ที่ Export มา:
 *   npx tsx scripts/generate-simplified-firestore-rules.ts --overrides=overrides.json
 *
 *   # ระบุ output path ต่างจาก default:
 *   npx tsx scripts/generate-simplified-firestore-rules.ts --out=firestore.rules.draft
 *
 * Output (default): `firestore.rules.simplified.draft`
 *
 * ไม่ทับ `firestore.rules` เดิม — admin/dev ต้องตรวจสอบ + merge preserved blocks
 * (collections ที่มี portal scope / status guards / business logic) ก่อน deploy
 */
import { readFileSync, writeFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { getFieldsForBusinessRole } from '../src/lib/auth-mapping';
import { getPermissions } from '../src/lib/permissions';
import { ACTIVE_BUSINESS_ROLE_KEYS, ROLE_CATALOG } from '../src/lib/roles/role-catalog';
import { MENU_PERMISSION_GROUPS } from '../src/lib/navigation/menu-permission-map';
import {
  deserializeOverrides,
  emptyEnvelope,
  type CapabilityCell,
  type MenuMatrixOverrides,
} from '../src/lib/permissions/menu-matrix-overrides';
import { generateFullSimplifiedRules } from '../src/lib/permissions/generate-rules-from-matrix';
import { MODULE_FIRESTORE_SPECS } from '../src/lib/permissions/module-to-firestore-paths';
import type { BusinessRoleKey, User } from '../src/lib/types';

function mockUser(rk: BusinessRoleKey): User {
  return {
    id: `__matrix_mock_${rk}`,
    email: `${rk}@example.local`,
    displayName: ROLE_CATALOG[rk].displayNameTh,
    phone: '0000000000',
    approvalStatus: 'ACTIVE',
    isActive: true,
    userType: rk === 'client_user' ? 'customer_portal' : 'internal',
    customerId: rk === 'client_user' ? '__matrix_customer__' : undefined,
    portalRole: rk === 'client_user' ? 'viewer' : undefined,
    createdAt: 0,
    updatedAt: 0,
    ...getFieldsForBusinessRole(rk),
  } as User;
}

function buildBaseline(): Record<string, Record<string, CapabilityCell>> {
  const out: Record<string, Record<string, CapabilityCell>> = {};
  /** รวม module keys จาก 2 แหล่ง: เมนู UI + module-to-firestore-paths (เพราะ matrix ใน UI รวมเมนูย่อยอยู่ใต้ parent) */
  const allModuleKeys = new Set<string>();
  for (const grp of MENU_PERMISSION_GROUPS) {
    for (const item of grp.items) allModuleKeys.add(item.moduleKey);
  }
  for (const spec of MODULE_FIRESTORE_SPECS) allModuleKeys.add(spec.moduleKey);

  for (const rk of ACTIVE_BUSINESS_ROLE_KEYS) {
    const u = mockUser(rk);
    const row: Record<string, CapabilityCell> = {};
    for (const mk of allModuleKeys) {
      const p = getPermissions(u, mk, null);
      row[mk] = {
        view: !!p.view,
        create: !!p.create,
        edit: !!p.edit,
        delete: !!p.delete,
        approve: !!p.approve,
      };
    }
    out[rk] = row;
  }
  return out;
}

function parseArgs(argv: string[]) {
  const out: { overrides?: string; out?: string } = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--overrides=')) out.overrides = a.slice(12);
    else if (a.startsWith('--out=')) out.out = a.slice(6);
  }
  return out;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function main() {
  const args = parseArgs(process.argv);
  let overrides: MenuMatrixOverrides = {};
  let updatedBy = 'cli';
  let updatedAt = Date.now();

  if (args.overrides) {
    const inputPath = resolve(process.cwd(), args.overrides);
    try {
      const raw = readFileSync(inputPath, 'utf8');
      const env = deserializeOverrides(raw);
      if (!env) {
        console.error(`Invalid JSON envelope: ${inputPath}`);
        process.exit(1);
      }
      overrides = env.overrides;
      if (env.updatedBy) updatedBy = env.updatedBy;
      updatedAt = env.updatedAt;
      console.log(`Loaded overrides from ${inputPath} (updatedAt=${new Date(env.updatedAt).toISOString()})`);
    } catch (e: any) {
      console.error(`Cannot read ${inputPath}: ${e?.message ?? e}`);
      process.exit(1);
    }
  } else {
    console.log('No --overrides specified — using baseline matrix only');
    const env = emptyEnvelope(updatedBy);
    overrides = env.overrides;
    updatedAt = env.updatedAt;
  }

  const baseline = buildBaseline();
  const result = generateFullSimplifiedRules({
    overrides,
    baseline,
    generatedAt: updatedAt,
    generatedBy: updatedBy,
  });

  /** Strip blank lines เพื่อลดขนาดไฟล์ — formatter เดิมใส่ \n เว้นวรรค section ที่ไม่จำเป็น
   *  (ใช้ --keep-blanks ถ้าอยากเก็บไว้เพื่ออ่านง่าย) */
  const keepBlanks = process.argv.includes('--keep-blanks');
  const finalText = keepBlanks
    ? result.text
    : result.text
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .join('\n') + '\n';

  const outPath = resolve(process.cwd(), args.out ?? 'firestore.rules.simplified.draft');
  writeFileSync(outPath, finalText, 'utf8');

  /** Compare with original */
  let originalBytes = 0;
  try {
    originalBytes = statSync(resolve(process.cwd(), 'firestore.rules')).size;
  } catch {
    /** no original found */
  }

  console.log('');
  console.log('=================================================================');
  console.log(`Wrote ${outPath}`);
  console.log('=================================================================');
  console.log(`Generated rules size : ${fmtBytes(result.stats.estimatedBytes)}`);
  if (originalBytes > 0) {
    const delta = originalBytes - result.stats.estimatedBytes;
    const pct = ((delta / originalBytes) * 100).toFixed(1);
    console.log(`Original rules size  : ${fmtBytes(originalBytes)}`);
    console.log(`Delta                : ${delta > 0 ? '-' : '+'}${fmtBytes(Math.abs(delta))} (${pct}% smaller)`);
  }
  console.log(`Matrix gates         : ${result.stats.predicateCount} predicates over ${result.stats.moduleCount} modules`);
  console.log(`Generated match blocks: ${result.stats.matrixMatchBlocks}`);
  console.log(`Preserved placeholders: ${result.stats.preservedPlaceholders} ← ต้องวาง block เดิมเข้าไป`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. เปิดไฟล์ ' + outPath);
  console.log('  2. ค้น "PRESERVE-FROM-ORIGINAL" → วาง match block เดิมจาก firestore.rules มาแทน');
  console.log('  3. ทดสอบใน emulator: npx firebase emulators:start --only firestore');
  console.log('  4. เมื่อโอเค ค่อย rename → firestore.rules แล้ว deploy');
}

main();
