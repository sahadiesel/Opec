'use client';

import { Firestore, collection, doc, setDoc } from 'firebase/firestore';
import { AuditLog, User } from '@/lib/types';
import { AuditLogSchema } from '@/lib/validations/audit-schemas';

/**
 * Central helper for writing standardized audit logs.
 * Captures user context and ensures data integrity.
 */
export async function writeAuditLog(
  db: Firestore,
  user: User,
  params: Omit<AuditLog, 'id' | 'actorUserId' | 'actorName' | 'actorRole' | 'permissionProfileKey' | 'eventAt'>
) {
  const auditRef = doc(collection(db, 'audit_logs'));
  
  const log: AuditLog = {
    ...params,
    id: auditRef.id,
    actorUserId: user.id,
    actorName: user.displayName,
    actorRole: user.assignedRoleKey || 'unknown',
    permissionProfileKey: user.permissionProfileKey || null,
    eventAt: Date.now(),
  };

  // 1. Validate structure
  const validated = AuditLogSchema.parse(log);

  // 2. Persist to Firestore (Blocking write for audit integrity)
  // We avoid non-blocking here because audit trails are high-priority consistency items
  await setDoc(auditRef, validated);
  
  return auditRef.id;
}

/**
 * Specialized helper for logging updates with a list of changed fields.
 */
export async function logUpdateAudit(
  db: Firestore,
  user: User,
  entityType: string,
  entityId: string,
  changes: string[],
  summary: string,
  linkedIds: string[] = []
) {
  return writeAuditLog(db, user, {
    actionType: 'UPDATE',
    entityType,
    entityId,
    changedFields: changes,
    afterSummary: summary,
    linkedIds,
    sourceModule: 'system'
  });
}
