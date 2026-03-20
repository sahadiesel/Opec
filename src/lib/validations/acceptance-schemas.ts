
import { z } from 'zod';

/**
 * Zod validation schema for WorkerWaveAcceptance
 */
export const WorkerWaveAcceptanceSchema = z.object({
  id: z.string().optional(),
  waveId: z.string().min(1, 'Wave ID is required'),
  assignmentId: z.string().min(1, 'Assignment ID is required'),
  workerId: z.string().min(1, 'Worker ID is required'),
  customerId: z.string().min(1, 'Customer ID is required for strict isolation'),
  customerPortalUserId: z.string().optional().nullable(),
  status: z.enum(['pending', 'accepted', 'rejected', 'replacement_requested']),
  remark: z.string().optional().nullable(),
  approvedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().nullable(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
