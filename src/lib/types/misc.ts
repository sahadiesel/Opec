/** Domain types: misc (from master types.ts split). */

/** รูปถ่ายหรือ PDF แนบกับงวด Wave/เดือน (Storage + URL) — shared by timesheet + worker docs */
export interface WaveMonthTimesheetPhotoAttachment {
  id: string;
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  /** เช่น image/jpeg, application/pdf — ข้อมูลเก่าอาจไม่มี (ใช้นามสกุลไฟล์แทน) */
  contentType?: string;
  uploadedAt: number;
}

/** Central Audit Log for security and compliance */
export interface AuditLog {
  id: string;
  actionType: string; // e.g., 'CREATE', 'APPROVE', 'REJECT', 'LOCK'
  entityType: string; // e.g., 'DailyTimesheet', 'PayrollBatch'
  entityId: string;
  entityLabel?: string; // Descriptive name for logs (e.g., Worker Name or PO Code)
  actorUserId: string;
  actorName: string;
  actorRole: string;
  permissionProfileKey?: string | null;
  sourceModule?: string;
  sourcePath?: string;
  linkedIds?: string[];
  // Named linked IDs for optimized indexing
  payrollBatchId?: string;
  timesheetId?: string;
  waveId?: string;
  purchaseOrderId?: string;
  contractTermId?: string;
  exportBatchId?: string;
  taxInvoiceId?: string;
  billingNoteId?: string;
  beforeSummary?: string;
  afterSummary?: string;
  changedFields?: string[];
  reasonCode?: string;
  reasonText?: string;
  eventAt: number;
  requestId?: string;
  sessionId?: string;
}

export type IssueCategory =
  | 'TIMESHEET'
  | 'BILLING_NOTE'
  | 'TAX_INVOICE'
  | 'RECEIPT'
  | 'COMMERCIAL_INVOICE'
  | 'QUOTATION'
  | 'GENERAL';

export type IssueStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

export interface CustomerIssue {
  id: string;
  customerId: string;
  category: IssueCategory;
  referenceId: string; // The ID of the document being reported
  referenceNo: string; // The display code (Slip No, Invoice No)
  description: string;
  status: IssueStatus;
  createdBy: string;
  createdById: string;
  createdAt: number;
  updatedAt: number;
}

/** Exception Requests for Post-Approval Changes */

export type ExceptionRequestType = 'TIMESHEET_CORRECTION' | 'ASSIGNMENT_CHANGE';

export type ExceptionRequestStatus = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export interface ExceptionRequest {
  id: string;
  customerId: string;
  requestType: ExceptionRequestType;
  referenceId: string; // e.g. timesheetId or assignmentId
  referenceNo: string; // e.g. slipNo or assignmentNo
  reason: string;
  status: ExceptionRequestStatus;
  requestedBy: string;
  requestedById: string;
  requestedAt: number;
  reviewedBy?: string | null;
  reviewedAt?: number | null;
  internalNotes?: string | null;
  updatedAt: number;
}

