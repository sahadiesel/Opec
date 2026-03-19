import { z } from 'zod';

/**
 * Zod validation schema for WorkerPaymentProfile
 */
export const WorkerPaymentProfileSchema = z.object({
  id: z.string().optional(),
  workerId: z.string().min(1, 'Worker ID is required'),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CASH', 'PROMPTPAY', 'OTHER']),
  bankCode: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  accountName: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
  branchName: z.string().optional().nullable(),
  promptPayId: z.string().optional().nullable(),
  isPrimary: z.boolean().default(true),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().nullable(),
  attachmentUrl: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING_VERIFICATION']),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
