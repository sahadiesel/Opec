'use client';

import { 
  DailyTimesheet, 
  LaborCostContractTerm, 
  RateCondition, 
  RateConditionUnitType,
  RateConditionCalculationMethod
} from '@/lib/types';
import { parseISO, startOfDay, isBefore, isAfter, isSameDay } from 'date-fns';

/**
 * Resolves the most specific and applicable labor cost rate condition for a given timesheet entry.
 * Logic: Matches by Labor Cost Contract, event type, work mode, and date effectiveness.
 */
export function resolveApplicableCostRateCondition(
  conditions: RateCondition[],
  timesheet: DailyTimesheet,
  contract: LaborCostContractTerm
): RateCondition | null {
  const tsDate = startOfDay(parseISO(timesheet.date));

  // 1. Filter conditions belonging to this specific cost contract and ensure active
  let applicable = conditions.filter(c => 
    c.parentId === contract.id && 
    c.parentType === 'LABOR_COST_CONTRACT' && 
    c.isActive
  );

  // 2. Filter by eventType (e.g., work_day, travel_day)
  applicable = applicable.filter(c => c.eventType === timesheet.eventType);

  // 3. Filter by workMode (ONSHORE / OFFSHORE) if specified in condition
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

  // 6. Sort by displayOrder (lower number = higher priority)
  applicable.sort((a, b) => a.displayOrder - b.displayOrder);

  return applicable[0] || null;
}

/**
 * Calculates the internal labor cost for a single timesheet entry.
 * @param timesheet The source daily record
 * @param condition The matched rate condition
 * @param costBaseline Optional baseline cost (e.g. from a worker's specific profile or default position cost)
 */
export function calculateDailyLaborCost(
  timesheet: DailyTimesheet,
  condition: RateCondition,
  costBaseline: number = 0
): number {
  const quantity = resolveQuantityForCostUnit(timesheet, condition.unitType);
  const base = condition.baseRate ?? costBaseline;

  switch (condition.calculationMethod) {
    case 'FIXED':
    case 'FLAT':
      return condition.fixedAmount ?? base;
    
    case 'MULTIPLIER':
      return (base * (condition.multiplier ?? 1)) * quantity;
    
    case 'PERCENTAGE':
      return (base * ((condition.percentageOfBase ?? 100) / 100)) * quantity;
    
    case 'FORMULA':
      // Simplified formula support for now, defaulting to multiplier logic
      return (base * (condition.multiplier ?? 1)) * quantity;
    
    default:
      return 0;
  }
}

/**
 * Maps timesheet metrics to the required unit for calculation.
 */
function resolveQuantityForCostUnit(timesheet: DailyTimesheet, unitType: RateConditionUnitType): number {
  if (timesheet.quantityOverride !== undefined && timesheet.quantityOverride !== null) {
    return timesheet.quantityOverride;
  }

  switch (unitType) {
    case 'DAY':
      return 1;
    
    case 'HALF_DAY':
      return 0.5;
    
    case 'HOUR':
      // Sum of all relevant hours
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
 * Generates an audit string for the labor cost calculation.
 */
export function summarizeDailyCostBreakdown(
  timesheet: DailyTimesheet,
  condition: RateCondition,
  costValue: number,
  currency: string = 'THB'
): string {
  const qty = resolveQuantityForCostUnit(timesheet, condition.unitType);
  const method = condition.calculationMethod;
  const rateUsed = condition.baseRate ?? 'cost_baseline';
  
  let details = `[COST: ${timesheet.eventType}] `;
  details += `${qty} ${condition.unitType} x `;
  
  if (method === 'MULTIPLIER') {
    details += `(Base: ${rateUsed} * Mult: ${condition.multiplier})`;
  } else if (method === 'PERCENTAGE') {
    details += `(Base: ${rateUsed} @ ${condition.percentageOfBase}%)`;
  } else if (method === 'FIXED' || method === 'FLAT') {
    details += `Fixed Amount`;
  } else {
    details += `Default`;
  }

  details += ` = ${currency} ${costValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  
  if (condition.payableConditionText) {
    details += ` | Rule: ${condition.payableConditionText}`;
  }

  return details;
}
