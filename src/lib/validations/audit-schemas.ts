import { z } from 'zod';

/**
 * Zod validation schema for AuditLog
 * Expanded to support specific linked entity IDs for high-performance indexing.
 */
export const AuditLogSchema = z.object({
  id: z.string(),
  actionType: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  entityLabel: z.string().optional().nullable(),
  actorUserId: z.string(),
  actorName: z.string(),
  actorRole: z.string(),
  permissionProfileKey: z.string().optional().nullable(),
  sourceModule: z.string().optional().nullable(),
  sourcePath: z.string().optional().nullable(),
  linkedIds: z.array(z.string()).optional(),
  // Named linked IDs for optimized indexing
  payrollBatchId: z.string().optional().nullable(),
  timesheetId: z.string().optional().nullable(),
  waveId: z.string().optional().nullable(),
  purchaseOrderId: z.string().optional().nullable(),
  contractTermId: z.string().optional().nullable(),
  exportBatchId: z.string().optional().nullable(),
  taxInvoiceId: z.string().optional().nullable(),
  billingNoteId: z.string().optional().nullable(),
  beforeSummary: z.string().optional().nullable(),
  afterSummary: z.string().optional().nullable(),
  changedFields: z.array(z.string()).optional(),
  reasonCode: z.string().optional().nullable(),
  reasonText: z.string().optional().nullable(),
  eventAt: z.number(),
  requestId: z.string().optional().nullable(),
  sessionId: z.string().optional().nullable(),
});
