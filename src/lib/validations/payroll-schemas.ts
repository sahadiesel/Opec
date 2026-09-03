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
  batchType: z.enum(['NORMAL', 'SUPPLEMENTAL']).optional(),
  workModeScope: z.enum(['onshore', 'offshore', 'mixed']),
  status: z.enum([
    'DRAFT', 
    'GENERATED', 
    'HR_REVIEWED', 
    'HR_APPROVED', 
    'FINANCE_PREPARED', 
    'PAYMENT_EXPORTED', 
    'PAID', 
    'LOCKED'
  ]),
  d8LifecycleStatus: z
    .enum([
      'draft',
      'reviewed',
      'approved',
      'readyForFinance',
      'paid',
      'locked',
      'correction_required',
      'adjusted',
    ])
    .optional(),
  totalWorkers: z.number().min(0),
  grossAmount: z.number().min(0),
  totalDeductions: z.number().min(0),
  netAmount: z.number().min(0),
  notes: z.string().optional().nullable(),
  officerPayoutRequestBy: z.string().optional().nullable(),
  officerPayoutRequestAt: z.number().optional().nullable(),
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

const PayslipWorkDaySplitSchema = z.object({
  normalDays: z.number(),
  normalAmount: z.number(),
  holidayDays: z.number(),
  holidayAmount: z.number(),
  otAmount: z.number().optional(),
  ot15Hours: z.number().optional(),
  ot20Hours: z.number().optional(),
  ot30Hours: z.number().optional(),
  overflowNormalHours: z.number().optional(),
  ot15Amount: z.number().optional(),
  ot20Amount: z.number().optional(),
  ot30Amount: z.number().optional(),
  overflowOtAmount: z.number().optional(),
  overflowBeyond12Hours: z.number().optional(),
  overflowBeyond12Amount: z.number().optional(),
});

const PayrollBatchIncomeSegmentSchema = z.object({
  purchaseOrderId: z.string().min(1),
  customerId: z.string().optional(),
  poCodeSnapshot: z.string().optional(),
  customerNameSnapshot: z.string().optional(),
  grossAmount: z.number(),
  eventBreakdown: z.record(z.number()).default({}),
  earningsBreakdown: z.record(z.number()).default({}),
  payslipWorkDaySplit: PayslipWorkDaySplitSchema.optional().nullable(),
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
  /** ยอดต่อใบ timesheet ตอน generate/recalc */
  timesheetGrossById: z.record(z.number()).optional(),
  /** แถวรายวัน snapshot — เปิดหน้ารายคนโดยไม่โหลด daily_timesheets */
  dailyRowSnapshots: z
    .array(
      z.object({
        timesheetId: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        eventType: z.string(),
        workMode: z.string().optional(),
        normalHours: z.number(),
        ot15Hours: z.number().optional(),
        ot20Hours: z.number().optional(),
        ot30Hours: z.number().optional(),
        holidayHours: z.number().optional(),
        amount: z.number(),
        purchaseOrderId: z.string().optional(),
        remark: z.string().optional(),
      }),
    )
    .optional(),
  snapshotBackfillStatus: z.enum(['matched', 'mismatch']).optional(),
  snapshotBackfillMismatchNote: z.string().optional().nullable(),
  snapshotBackfillAttemptedAt: z.number().optional(),
  snapshotBackfillComputedGross: z.number().optional(),
  snapshotBackfillComputedNet: z.number().optional(),
  deductionsBreakdown: z.record(z.number()).default({}),
  grossAmount: z.number(),
  netAmount: z.number(),
  d8Snapshot: z.record(z.any()).optional().nullable(),
  laborCostResolutionSnapshot: z
    .object({
      source: z.enum(['position_default', 'worker_custom']),
      positionId: z.string().min(1),
      workMode: z.enum(['onshore', 'offshore']),
      effectiveBaseRate: z.number().min(0),
      resolvedAt: z.number(),
    })
    .optional()
    .nullable(),
  exportStatus: z.enum(['pending', 'exported', 'failed']),
  remarks: z.string().optional().nullable(),
  hrLineAdjustments: z
    .object({
      allowanceItems: z.array(z.object({ label: z.string(), amount: z.number() })).default([]),
      deductionItems: z.array(z.object({ label: z.string(), amount: z.number() })).default([]),
      priorPeriodAllowanceItems: z
        .array(z.object({ sourceYearMonth: z.string(), label: z.string(), amount: z.number() }))
        .optional()
        .default([]),
      workerPitMode: z
        .enum(['manual_baht', 'auto_timesheet', 'auto_salary_base'] as const)
        .optional()
        .nullable(),
      pitAutoSalaryBaseBaht: z.number().min(0).nullable().optional(),
      pitWithholdingOverride: z.number().nullable().optional(),
      pitWithholdingOverrideMaxMarginalRatePercent: z.number().min(0).max(35).nullable().optional(),
      notes: z.string().optional().nullable(),
      updatedAt: z.number().optional(),
      updatedBy: z.string().optional(),
    })
    .optional()
    .nullable(),
  incomeSegments: z.array(PayrollBatchIncomeSegmentSchema).optional(),
  payslipWorkDaySplit: PayslipWorkDaySplitSchema.optional().nullable(),
  financePayoutCashbookEntryId: z.string().optional(),
  financePayoutBankAccountId: z.string().optional(),
  financePaidAt: z.number().optional(),
});
