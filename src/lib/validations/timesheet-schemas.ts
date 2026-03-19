import { z } from 'zod';

/**
 * Zod validation schema for DailyTimesheet
 */
export const DailyTimesheetSchema = z.object({
  id: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  workerId: z.string().min(1, 'Worker ID is required'),
  workerNameSnapshot: z.string().min(1, 'Worker name snapshot is required'),
  assignmentId: z.string().min(1, 'Assignment ID is required'),
  waveId: z.string().min(1, 'Wave ID is required'),
  contractId: z.string().min(1, 'Contract ID is required'),
  salesContractTermId: z.string().optional().nullable(),
  laborCostContractTermId: z.string().optional().nullable(),
  purchaseOrderId: z.string().min(1, 'Purchase Order ID is required'),
  siteId: z.string().min(1, 'Site ID is required'),
  positionId: z.string().min(1, 'Position ID is required'),
  workMode: z.enum(['ONSHORE', 'OFFSHORE']),
  eventType: z.enum([
    'work_day', 'off_day_worked', 'public_holiday_worked', 'travel_day', 'standby_day', 
    'mobilization_day', 'demobilization_day', 'training_day', 'sick_leave_paid', 
    'vacation_paid', 'unpaid_leave', 'night_shift', 'half_day', 'early_return', 
    'client_cancellation', 'replacement_day', 'other'
  ]),
  shiftType: z.enum(['DAY', 'NIGHT']),
  normalHours: z.number().min(0).max(24),
  ot15Hours: z.number().min(0).max(24),
  ot20Hours: z.number().min(0).max(24),
  ot30Hours: z.number().min(0).max(24),
  holidayHours: z.number().min(0).max(24),
  standbyUnits: z.number().min(0),
  travelUnits: z.number().min(0),
  mobUnits: z.number().min(0),
  demobUnits: z.number().min(0),
  paidLeaveUnits: z.number().min(0),
  unpaidLeaveUnits: z.number().min(0),
  quantityOverride: z.number().optional().nullable(),
  remark: z.string().optional().nullable(),
  evidenceAttachments: z.array(z.string()).default([]),
  status: z.enum([
    'DRAFT', 'SUBMITTED', 'OPS_REVIEWED', 'CLIENT_APPROVED', 
    'LOCKED', 'REJECTED', 'CORRECTION_REQUIRED'
  ]),
  submittedBy: z.string().optional().nullable(),
  submittedAt: z.number().optional().nullable(),
  opsReviewedBy: z.string().optional().nullable(),
  opsReviewedAt: z.number().optional().nullable(),
  clientApprovedBy: z.string().optional().nullable(),
  clientApprovedAt: z.number().optional().nullable(),
  lockedBy: z.string().optional().nullable(),
  lockedAt: z.number().optional().nullable(),
  rejectionReason: z.string().optional().nullable(),
  correctionReason: z.string().optional().nullable(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
