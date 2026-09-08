import type { User } from '@/lib/types';
import { getEffectiveAccessLevel, isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { ROLE_CATALOG, getCanonicalBusinessRoleKey } from '@/lib/roles/role-catalog';

export interface DocumentShareRecipient {
  uid: string;
  displayName: string;
  roleKey?: string;
}

export interface DocumentShareFields {
  sharedWith?: DocumentShareRecipient[] | null;
  sharedWithUids?: string[] | null;
}

export function canManageDocumentShare(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return true;
  return getEffectiveAccessLevel(user) === 'manager';
}

export function isOfficerShareTargetUser(user: User | null): boolean {
  if (!user) return false;
  if (user.userType === 'customer_portal' || user.user_type === 'customer_portal') return false;
  if (user.isActive === false) return false;
  const approval = String(user.approvalStatus || '').toUpperCase();
  if (approval === 'PENDING' || approval === 'SUSPENDED' || approval === 'REJECTED') return false;
  const status = String(user.status || '').toLowerCase();
  if (status === 'pending' || status === 'suspended') return false;
  const canonical = getCanonicalBusinessRoleKey(user.assignedRoleKey || user.role);
  if (canonical === 'client_user' || canonical === 'employee_self' || canonical === 'executive') {
    return false;
  }
  if (canonical && ROLE_CATALOG[canonical]) {
    return ROLE_CATALOG[canonical].accessLevel === 'officer';
  }
  return getEffectiveAccessLevel(user) === 'officer';
}

export function documentShareRecipients(doc: DocumentShareFields | null | undefined): DocumentShareRecipient[] {
  const list = doc?.sharedWith;
  if (!Array.isArray(list)) return [];
  return list.filter((r) => r && typeof r.uid === 'string' && r.uid.trim() !== '');
}

export function documentIsShared(doc: DocumentShareFields | null | undefined): boolean {
  if ((doc?.sharedWithUids || []).some((id) => typeof id === 'string' && id.trim() !== '')) return true;
  return documentShareRecipients(doc).length > 0;
}

export function documentSharedWithCurrentUser(
  user: User | null,
  doc: DocumentShareFields | null | undefined,
): boolean {
  if (!user?.id) return false;
  if ((doc?.sharedWithUids || []).includes(user.id)) return true;
  return documentShareRecipients(doc).some((r) => r.uid === user.id);
}

export function officerRoleLabel(roleKey?: string | null): string {
  const canonical = getCanonicalBusinessRoleKey(roleKey);
  if (!canonical) return roleKey || 'officer';
  return ROLE_CATALOG[canonical]?.displayNameTh || canonical;
}

export function buildSharePayload(recipients: DocumentShareRecipient[]): {
  sharedWith: DocumentShareRecipient[];
  sharedWithUids: string[];
} {
  const unique = new Map<string, DocumentShareRecipient>();
  for (const r of recipients) {
    const uid = String(r.uid || '').trim();
    if (!uid) continue;
    unique.set(uid, {
      uid,
      displayName: (r.displayName || '').trim() || uid,
      roleKey: r.roleKey || undefined,
    });
  }
  const sharedWith = [...unique.values()];
  return {
    sharedWith,
    sharedWithUids: sharedWith.map((r) => r.uid),
  };
}
