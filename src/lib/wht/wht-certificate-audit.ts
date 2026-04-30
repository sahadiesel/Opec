/**
 * Audit log entries สำหรับ withholding_certificate_documents/{id}/audit_logs
 */

import type { WhtCertificateAuditAction, WhtCertificateAuditLogEntry } from '@/lib/types';
import { stripUndefinedForFirestore } from '@/lib/firestore/strip-undefined-for-firestore';

export function buildWhtAuditLogEntry(params: {
  documentId: string;
  action: WhtCertificateAuditAction;
  actorId: string;
  actorName?: string;
  payloadSummary?: Record<string, unknown>;
  reason?: string;
}): Omit<WhtCertificateAuditLogEntry, 'id'> {
  const entry: Record<string, unknown> = {
    action: params.action,
    documentId: params.documentId,
    actorId: params.actorId,
    timestamp: Date.now(),
  };
  const name = params.actorName?.trim();
  if (name) entry.actorName = name;
  if (params.payloadSummary !== undefined) {
    entry.payloadSummary = stripUndefinedForFirestore(params.payloadSummary);
  }
  const reason = params.reason?.trim();
  if (reason) entry.reason = reason;
  return entry as Omit<WhtCertificateAuditLogEntry, 'id'>;
}
