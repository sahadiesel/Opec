/**
 * CLI: อ่าน matrix overrides JSON (ที่ Export มาจากหน้า /system-admin/menu-permissions)
 * แล้ว generate text สำหรับ paste ลง firestore.rules
 *
 * ใช้:
 *   npx tsx scripts/generate-firestore-rules-from-matrix.ts overrides.json [--out=preview.txt]
 *
 * - overrides.json คือไฟล์ที่ Export จากปุ่ม "Export JSON" ในหน้า matrix
 * - ถ้าไม่ระบุ --out จะพิมพ์ออก stdout
 *
 * ไม่ได้แก้ไข `firestore.rules` โดยตรง — admin/dev ต้องคัด+วาง+ตรวจสอบเอง
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { getFieldsForBusinessRole } from '../src/lib/auth-mapping';
import { getPermissions } from '../src/lib/permissions';
import { ACTIVE_BUSINESS_ROLE_KEYS, ROLE_CATALOG } from '../src/lib/roles/role-catalog';
import { MENU_PERMISSION_GROUPS } from '../src/lib/navigation/menu-permission-map';
import {
  deserializeOverrides,
  emptyEnvelope,
  type CapabilityCell,
} from '../src/lib/permissions/menu-matrix-overrides';
import { generateRulesPreview } from '../src/lib/permissions/generate-rules-from-matrix';
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

function toCell(p: ReturnType<typeof getPermissions>): CapabilityCell {
  return {
    view: !!p.view,
    create: !!p.create,
    edit: !!p.edit,
    delete: !!p.delete,
    approve: !!p.approve,
  };
}

function buildBaseline(): Record<string, Record<string, CapabilityCell>> {
  const out: Record<string, Record<string, CapabilityCell>> = {};
  for (const rk of ACTIVE_BUSINESS_ROLE_KEYS) {
    const u = mockUser(rk);
    const row: Record<string, CapabilityCell> = {};
    for (const grp of MENU_PERMISSION_GROUPS) {
      for (const item of grp.items) {
        row[item.moduleKey] = toCell(getPermissions(u, item.moduleKey, null));
      }
    }
    out[rk] = row;
  }
  return out;
}

function parseArgs(argv: string[]): { input?: string; out?: string } {
  const out: { input?: string; out?: string } = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--out=')) out.out = a.slice(6);
    else if (!a.startsWith('--')) out.input = a;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error('Usage: npx tsx scripts/generate-firestore-rules-from-matrix.ts <overrides.json> [--out=preview.txt]');
    process.exit(2);
  }

  const inputPath = resolve(process.cwd(), args.input);
  let envelope = emptyEnvelope('cli');
  try {
    const raw = readFileSync(inputPath, 'utf8');
    const parsed = deserializeOverrides(raw);
    if (!parsed) {
      console.error(`Invalid JSON envelope: ${inputPath}`);
      process.exit(1);
    }
    envelope = parsed;
  } catch (e: any) {
    console.error(`Cannot read ${inputPath}: ${e?.message ?? e}`);
    process.exit(1);
  }

  const baseline = buildBaseline();
  const result = generateRulesPreview({
    overrides: envelope.overrides,
    baseline,
    generatedAt: envelope.updatedAt,
    generatedBy: envelope.updatedBy ?? 'cli',
  });

  const stats = `// stats: ${result.stats.predicateCount} predicate · ${result.stats.pathCount} match block · ${result.stats.moduleCount} module\n`;
  const finalText = stats + result.text;

  if (args.out) {
    const outPath = resolve(process.cwd(), args.out);
    writeFileSync(outPath, finalText, 'utf8');
    console.log(`Wrote ${outPath}`);
    console.log(stats);
  } else {
    process.stdout.write(finalText);
  }
}

main();
