
import { z } from 'zod';

/**
 * Zod validation schema for CustomerIssue reporting.
 */
export const CustomerIssueSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1, 'Customer ID is required'),
  category: z.enum([
    'TIMESHEET',
    'BILLING_NOTE',
    'TAX_INVOICE',
    'RECEIPT',
    'COMMERCIAL_INVOICE',
    'QUOTATION',
    'GENERAL',
  ]),
  referenceId: z.string().min(1, 'Document reference ID is required'),
  referenceNo: z.string().min(1, 'Document number is required'),
  description: z.string().min(5, 'Please provide more detail about the issue'),
  status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED']).default('OPEN'),
  createdBy: z.string().min(1),
  createdById: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});
