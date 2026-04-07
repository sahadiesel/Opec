'use client';

import { 
  DailyTimesheet, 
  SalesContractTerm, 
  RateCondition, 
  RateConditionUnitType,
  RateConditionCalculationMethod
} from '@/lib/types';
import { parseISO, startOfDay, isBefore, isAfter, isSameDay } from 'date-fns';

export interface SalesCalculationResult {
  value: number;
  currency: string;
  breakdown: string;
  appliedConditionId: string;
}

/**
 * Resolves the most specific and applicable rate condition for a given timesheet entry.
 * Business logic: Matches by contract, event type (e.g., travel), mode, and date effectiveness.
 */
export function resolveApplicableSalesRateCondition(
  conditions: RateCondition[],
  timesheet: DailyTimesheet,
  contract: SalesContractTerm
): RateCondition | null {
  const tsDate = startOfDay(parseISO(timesheet.date));

  // 1. Filter conditions belonging to this contract
  let applicable = conditions.filter(c => c.parentId === contract.id && c.isActive);

  // 2. Filter by eventType (the core trigger)
  applicable = applicable.filter(c => c.eventType === timesheet.eventType);

  // 3. Filter by workMode (if specified in condition)
  applicable = applicable.filter(c => !c.workMode || c.workMode === timesheet.workMode || c.workMode === 'BOTH');

  // 4. Filter by position (if specified)
  applicable = applicable.filter(c => !c.positionId || c.positionId === timesheet.positionId);

  // 5. Filter by Date Effectiveness
  applicable = applicable.filter(c => {
    const start = startOfDay(parseISO(c.effectiveDate));
    const end = c.endDate ? startOfDay(parseISO(c.endDate)) : null;
    
    const isAfterOrEqualStart = isAfter(tsDate, start) || isSameDay(tsDate, start);
    const isBeforeOrEqualEnd = !end || isBefore(tsDate, end) || isSameDay(tsDate, end);
    
    return isAfterOrEqualStart && isBeforeOrEqualEnd;
  });

  // 6. Sort by displayOrder (Priority)
  applicable.sort((a, b) => a.displayOrder - b.displayOrder);

  return applicable[0] || null;
}

/**
 * Calculates the monetary value for a single timesheet entry based on a rate condition.
 */
export function calculateDailySalesValue(
  timesheet: DailyTimesheet,
  condition: RateCondition,
  baseRate: number = 0 // Usually resolved from the PositionRate Snapshot or the condition itself
): number {
  const quantity = resolveQuantityForUnit(timesheet, condition.unitType);
  const rate = condition.baseRate ?? baseRate;

  switch (condition.calculationMethod) {
    case 'FIXED':
    case 'FLAT':
      // Method 'FLAT' ignores quantity, returning exactly what's in the condition or base
      return condition.fixedAmount ?? rate;
    
    case 'MULTIPLIER':
      // Value = (Rate * Multiplier) * Quantity
      return (rate * (condition.multiplier ?? 1)) * quantity;
    
    case 'PERCENTAGE':
      // Value = (Rate * %age) * Quantity
      return (rate * ((condition.percentageOfBase ?? 100) / 100)) * quantity;
    
    case 'FORMULA':
      // Future expansion: placeholder for complex scripted formulas
      // For now, default to multiplier logic
      return (rate * (condition.multiplier ?? 1)) * quantity;
    
    default:
      return 0;
  }
}

/**
 * Billable quantity for a timesheet row under a sales rate condition (e.g. DAY=1, HOUR=sum hours).
 */
export function resolveQuantityForUnit(
  timesheet: DailyTimesheet,
  unitType: RateConditionUnitType,
): number {
  if (timesheet.quantityOverride !== undefined && timesheet.quantityOverride !== null) {
    return timesheet.quantityOverride;
  }

  switch (unitType) {
    case 'DAY':
      return 1; // Standard daily event
    
    case 'HALF_DAY':
      return 0.5;
    
    case 'HOUR':
      // Sum of all worked hours for this entry
      return (timesheet.normalHours || 0) + (timesheet.ot15Hours || 0) + (timesheet.ot20Hours || 0) + (timesheet.ot30Hours || 0) + (timesheet.holidayHours || 0);
    
    case 'TRIP':
      return 1;
      
    case 'FIXED':
      return 1;
      
    default:
      return 1;
  }
}

/**
 * Provides a human-readable summary of the calculation for auditing and invoicing.
 */
export function summarizeDailySalesBreakdown(
  timesheet: DailyTimesheet,
  condition: RateCondition,
  value: number,
  currency: string = 'THB'
): string {
  const qty = resolveQuantityForUnit(timesheet, condition.unitType);
  const method = condition.calculationMethod;
  const rateUsed = condition.baseRate ?? 'contract_default';
  
  let details = `[REVENUE: ${timesheet.eventType}] `;
  details += `${qty} ${condition.unitType} x `;
  
  if (method === 'MULTIPLIER') {
    details += `(Rate: ${rateUsed} * Multiplier: ${condition.multiplier})`;
  } else if (method === 'PERCENTAGE') {
    details += `(Rate: ${rateUsed} @ ${condition.percentageOfBase}%)`;
  } else {
    details += `Flat Rate`;
  }

  details += ` = ${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  
  if (condition.billableConditionText) {
    details += ` | Policy: ${condition.billableConditionText}`;
  }

  return details;
}
