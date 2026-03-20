import { z } from 'zod';

/**
 * Zod validation schema for PayrollPeriod
 */
export const PayrollPeriodSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1, 'Label is required'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  cycleType: z.enum(['MONTHLY', 'PARTIAL_START', 'PARTIAL_END', 'CUSTOM']),
  status: z.enum(['DRAFT', 'OPEN', 'PROCESSING', 'LOCKED', 'CLOSED']),
  generatedBy: z.string().min(1),
  generatedAt: z.number(),
});

/**
 * Zod validation schema for PayrollBatch
 */
export const PayrollBatchSchema = z.object({
  id: z.string().optional(),
  payrollPeriodId: z.string().min(1, 'Payroll Period ID is required'),
  workModeScope: z.enum(['ONSHORE', 'OFFSHORE', 'BOTH']),
  status: z.enum([
    'DRAFT', 'PROCESSING', 'HR_REVIEW', 'HR_APPROVED', 
    'FINANCE_APPROVED', 'PAID', 'LOCKED', 'CANCELLED'
  ]),
  totalWorkers: z.number().min(0),
  grossAmount: z.number().min(0),
  totalDeductions: z.number().min(0),
  netAmount: z.number().min(0),
  notes: z.string().optional().nullable(),
  hrApprovedBy: z.string().optional().nullable(),
  hrApprovedAt: z.number().optional().nullable(),
  financePreparedBy: z.string().optional().nullable(),
  financePreparedAt: z.number().optional().nullable(),
  lockedBy: z.string().optional().nullable(),
  lockedAt: z.number().optional().nullable(),
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/**
 * Zod validation schema for PayrollBatchLine
 */
export const PayrollBatchLineSchema = z.object({
  id: z.string().optional(),
  payrollBatchId: z.string().min(1),
  workerId: z.string().min(1),
  workerNameSnapshot: z.string().min(1),
  workerPaymentProfileSnapshot: z.record(z.any()),
  assignmentIds: z.array(z.string()).default([]),
  sourceTimesheetIds: z.array(z.string()).default([]),
  periodStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  eventBreakdown: z.record(z.number()).default({}),
  earningsBreakdown: z.record(z.number()).default({}),
  deductionsBreakdown: z.record(z.number()).default({}),
  grossAmount: z.number(),
  netAmount: z.number(),
  exportStatus: z.enum(['pending', 'exported', 'failed']),
  remarks: z.string().optional().nullable(),
});
