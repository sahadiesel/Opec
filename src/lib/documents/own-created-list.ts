import type { User } from '@/lib/types';
import { getEffectiveAccessLevel, isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import {
  documentSharedWithCurrentUser,
  type DocumentShareFields,
} from '@/lib/documents/document-share';

/** ฟิลด์ผู้สร้างที่ใช้ในเอกสารรายการ (ชื่อฟิลด์ไม่เหมือนกันทุกชนิด) */
export type DocumentCreatorFields = DocumentShareFields & {
  createdByUid?: string | null;
  createdById?: string | null;
  requestedByUid?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  requestedByName?: string | null;
};

/**
 * officer (เช่น sales_officer, accounting_officer) เห็นเฉพาะเอกสารที่ตัวเองสร้าง หรือที่ถูกแชร์มาให้
 * manager / admin / viewer เห็นทั้งหมด
 */
export function shouldRestrictListToOwnCreatedDocuments(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return false;
  return getEffectiveAccessLevel(user) === 'officer';
}

export function documentCreatedByCurrentUser(
  user: User | null,
  doc: DocumentCreatorFields,
): boolean {
  if (!user?.id) return false;
  if (doc.createdByUid && doc.createdByUid === user.id) return true;
  if (doc.createdById && doc.createdById === user.id) return true;
  if (doc.requestedByUid && doc.requestedByUid === user.id) return true;
  /** ใบเสนอราคาเก่าเก็บชื่อใน `createdBy` ไม่มี uid */
  const name = (user.displayName || '').trim();
  if (
    name &&
    !doc.createdByUid &&
    !doc.requestedByUid &&
    typeof doc.createdBy === 'string' &&
    doc.createdBy.trim() === name
  ) {
    return true;
  }
  return false;
}

export function documentCreatorDisplayName(doc: DocumentCreatorFields): string {
  const n =
    (doc.createdByName || '').trim() ||
    (doc.requestedByName || '').trim() ||
    (typeof doc.createdBy === 'string' ? doc.createdBy.trim() : '');
  return n || '—';
}

export function filterToOwnCreatedDocuments<T extends DocumentCreatorFields>(
  user: User | null,
  rows: T[] | null | undefined,
): T[] {
  const list = rows ?? [];
  if (!shouldRestrictListToOwnCreatedDocuments(user)) return list;
  return list.filter(
    (row) => documentCreatedByCurrentUser(user, row) || documentSharedWithCurrentUser(user, row),
  );
}
