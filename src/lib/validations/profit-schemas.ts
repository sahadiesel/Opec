
import { z } from 'zod';

/**
 * Zod validation schema for PurchaseOrderProfitSnapshot
 */
export const PurchaseOrderProfitSnapshotSchema = z.object({
  id: z.string().optional(),
  purchaseOrderId: z.string().min(1, 'Purchase Order ID is required'),
  waveId: z.string().optional().nullable(),
  periodStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  periodEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  estimatedRevenue: z.number().min(0),
  estimatedLaborCost: z.number().min(0),
  estimatedGrossProfit: z.number(),
  estimatedGrossMarginPercent: z.number(),
  calculationBasisSummary: z.string().min(1, 'Basis summary is required'),
  generatedAt: z.number(),
  generatedBy: z.string().min(1),
});
