import { z } from 'zod';

/**
 * Zod validation schema for SalesContractTerm
 */
export const SalesContractTermSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1, 'Customer ID is required'),
  mainContractId: z.string().min(1, 'Main Contract ID is required'),
  purchaseOrderId: z.string().min(1, 'Purchase Order ID is required'),
  title: z.string().min(1, 'Title is required'),
  contractNo: z.string().min(1, 'Contract Number is required'),
  status: z.enum(['DRAFT', 'ACTIVE', 'EXPIRED', 'CLOSED', 'CANCELLED']),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  currency: z.string().default('THB'),
  billingCycle: z.string().min(1, 'Billing Cycle is required'),
  paymentTermsDays: z.number().min(0),
  vatPercent: z.number().min(0),
  withholdingTaxPercent: z.number().min(0),
  notes: z.string().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

/**
 * Zod validation schema for LaborCostContractTerm
 */
export const LaborCostContractTermSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, 'Title is required'),
  relatedCustomerId: z.string().min(1, 'Related Customer ID is required'),
  relatedPurchaseOrderId: z.string().min(1, 'Related Purchase Order ID is required'),
  scopeType: z.enum(['SPECIFIC_PO', 'GENERAL_CUSTOMER', 'PROJECT_BASED', 'OTHER']),
  status: z.enum(['DRAFT', 'ACTIVE', 'EXPIRED', 'CLOSED', 'CANCELLED']),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  notes: z.string().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

/**
 * Zod validation schema for RateCondition
 */
export const RateConditionSchema = z.object({
  id: z.string().optional(),
  parentType: z.enum(['SALES_CONTRACT', 'LABOR_COST_CONTRACT', 'PO_SNAPSHOT', 'WAVE_SNAPSHOT']),
  parentId: z.string().min(1, 'Parent ID is required'),
  appliesTo: z.enum(['SALES', 'COST']),
  workerCategoryId: z.string().optional().nullable(),
  positionId: z.string().optional().nullable(),
  siteId: z.string().optional().nullable(),
  workMode: z.enum(['ONSHORE', 'OFFSHORE', 'BOTH']),
  eventType: z.enum([
    'work_day', 
    'off_day_worked', 
    'public_holiday_worked', 
    'travel_day', 
    'standby_day', 
    'mobilization_day', 
    'demobilization_day', 
    'training_day', 
    'sick_leave_paid', 
    'vacation_paid', 
    'unpaid_leave', 
    'night_shift', 
    'half_day', 
    'early_return', 
    'client_cancellation', 
    'replacement_day', 
    'other'
  ]),
  unitType: z.enum(['DAY', 'HALF_DAY', 'HOUR', 'TRIP', 'FIXED']),
  calculationMethod: z.enum(['FLAT', 'MULTIPLIER', 'PERCENTAGE', 'FORMULA']),
  baseRate: z.number().optional().nullable(),
  multiplier: z.number().optional().nullable(),
  percentageOfBase: z.number().optional().nullable(),
  fixedAmount: z.number().optional().nullable(),
  minimumUnits: z.number().optional().nullable(),
  roundingRule: z.enum(['UP', 'DOWN', 'NEAREST']).optional().nullable(),
  payableConditionText: z.string().optional().nullable(),
  billableConditionText: z.string().optional().nullable(),
  requiresApproval: z.boolean().default(false),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().nullable(),
  displayOrder: z.number().default(0),
  isActive: z.boolean().default(true),
});
