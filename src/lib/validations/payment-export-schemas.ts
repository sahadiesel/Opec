import { z } from 'zod';

/**
 * Zod validation schema for PaymentExportBatch
 */
export const PaymentExportBatchSchema = z.object({
  id: z.string().optional(),
  payrollBatchId: z.string().min(1, 'Payroll Batch ID is required'),
  exportTemplateCode: z.string().min(1, 'Export Template Code is required'),
  companyBankAccountId: z.string().min(1, 'Company Bank Account ID is required'),
  fileName: z.string().optional().nullable(),
  fileUrl: z.string().url().optional().nullable(),
  totalLines: z.number().min(0),
  totalAmount: z.number().min(0),
  status: z.enum(['draft', 'generated', 'downloaded', 'superseded']),
  generatedBy: z.string().optional().nullable(),
  generatedAt: z.number().optional().nullable(),
  createdBy: z.string().min(1),
  createdAt: z.number(),
});
