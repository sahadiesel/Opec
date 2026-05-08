import type { User } from '@/lib/types';
import { ROLE_CATALOG } from '@/lib/roles/role-catalog';
import { normalizeBusinessRoleKey } from '@/lib/role-key-normalizer';

/** สรุปข้อความสั้น ๆ สำหรับแสดงสิทธิ์บัญชี (ทะเบียนผูกลิงก์) */
export function buildUserAccessSummaryLines(u: User | null | undefined): string[] {
  if (!u) return ['—'];
  const lines: string[] = [];

  const pk = (u.permissionProfileKey || '').trim();
  if (pk) {
    lines.push(`โปรไฟล์สิทธิ์: ${pk}`);
  }
  const pks = [...new Set((u.permissionProfileKeys || []).map((x) => String(x).trim()).filter(Boolean))];
  for (const k of pks) {
    if (k !== pk) lines.push(`โปรไฟล์ (เพิ่ม): ${k}`);
  }

  const roleKeys = [
    u.assignedRoleKey,
    ...((u.assignedRoleKeys as string[] | undefined) || []),
    typeof u.role === 'string' ? u.role : '',
  ]
    .map((r) => normalizeBusinessRoleKey(String(r || '').trim()) || String(r || '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const raw of roleKeys) {
    const norm = normalizeBusinessRoleKey(raw) || raw;
    if (seen.has(norm)) continue;
    seen.add(norm);
    const cat = ROLE_CATALOG[norm as keyof typeof ROLE_CATALOG];
    lines.push(cat ? `บทบาท: ${cat.displayNameTh}` : `บทบาท: ${norm}`);
  }

  if (u.accessGroup && u.accessLevel) {
    lines.push(`กลุ่มสิทธิ์: ${u.accessGroup} · ระดับ: ${u.accessLevel}`);
  }

  return lines.length ? lines : ['—'];
}
