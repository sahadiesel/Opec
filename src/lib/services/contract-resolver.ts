'use client';

/**
 * @fileOverview Centralized logic for resolving applicable contract terms and rate conditions.
 * Used by Billing, Payroll, and Profit Estimation modules to ensure consistent rule application.
 */

import { 
  SalesContractTerm, 
  LaborCostContractTerm, 
  RateCondition, 
  JobMode,
  RateConditionEventType
} from '@/lib/types';
import { parseISO, startOfDay, isBefore, isAfter, isSameDay } from 'date-fns';

/**
 * Standard result object for resolution attempts.
 */
export interface ResolutionResult<T> {
  data: T | null;
  warnings: string[];
  isMatch: boolean;
}

/**
 * Resolves the most appropriate Sales Contract Term based on PO, Customer, and Date.
 */
export function resolveActiveSalesContractTerm(
  terms: SalesContractTerm[],
  criteria: {
    poId?: string;
    customerId?: string;
    date: string;
  }
): ResolutionResult<SalesContractTerm> {
  const warnings: string[] = [];
  const targetDate = startOfDay(parseISO(criteria.date));

  // 1. Filter by status and date effectiveness
  let applicable = terms.filter(t => t.status === 'ACTIVE');
  
  applicable = applicable.filter(t => {
    const start = startOfDay(parseISO(t.effectiveDate));
    const end = startOfDay(parseISO(t.endDate));
    return (isAfter(targetDate, start) || isSameDay(targetDate, start)) && 
           (isBefore(targetDate, end) || isSameDay(targetDate, end));
  });

  if (applicable.length === 0) {
    return { 
      data: null, 
      warnings: [`No active sales terms found for date ${criteria.date}.`], 
      isMatch: false 
    };
  }

  // 2. Specificity Logic: Specific PO match > General Customer match
  if (criteria.poId) {
    const poMatch = applicable.find(t => t.purchaseOrderId === criteria.poId);
    if (poMatch) return { data: poMatch, warnings, isMatch: true };
    warnings.push(`No specific sales term found for PO ${criteria.poId}. Falling back to general customer terms.`);
  }

  if (criteria.customerId) {
    const custMatch = applicable.find(t => t.customerId === criteria.customerId);
    if (custMatch) return { data: custMatch, warnings, isMatch: true };
  }

  return { 
    data: null, 
    warnings: ['No sales term found matching PO or Customer criteria.'], 
    isMatch: false 
  };
}

/**
 * Resolves the most appropriate Labor Cost Contract Term based on PO, Customer, and Date.
 */
export function resolveActiveLaborCostContractTerm(
  terms: LaborCostContractTerm[],
  criteria: {
    poId?: string;
    customerId?: string;
    date: string;
  }
): ResolutionResult<LaborCostContractTerm> {
  const warnings: string[] = [];
  const targetDate = startOfDay(parseISO(criteria.date));

  let applicable = terms.filter(t => t.status === 'ACTIVE');
  
  applicable = applicable.filter(t => {
    const start = startOfDay(parseISO(t.effectiveDate));
    const end = startOfDay(parseISO(t.endDate));
    return (isAfter(targetDate, start) || isSameDay(targetDate, start)) && 
           (isBefore(targetDate, end) || isSameDay(targetDate, end));
  });

  if (applicable.length === 0) {
    return { 
      data: null, 
      warnings: [`No active labor cost terms found for date ${criteria.date}.`], 
      isMatch: false 
    };
  }

  if (criteria.poId) {
    const poMatch = applicable.find(t => t.relatedPurchaseOrderId === criteria.poId);
    if (poMatch) return { data: poMatch, warnings, isMatch: true };
    warnings.push(`No specific labor cost term for PO ${criteria.poId}. Falling back to general scope.`);
  }

  if (criteria.customerId) {
    const custMatch = applicable.find(t => t.relatedCustomerId === criteria.customerId);
    if (custMatch) return { data: custMatch, warnings, isMatch: true };
  }

  return { data: null, warnings: ['No applicable labor cost term found.'], isMatch: false };
}

/**
 * Resolves the single best RateCondition from a filtered set.
 * Priority: Position Match > Site Match > WorkMode Match > General Event Match.
 */
export function resolveBestRateCondition(
  conditions: RateCondition[],
  context: {
    eventType: RateConditionEventType;
    workMode: JobMode | 'BOTH';
    positionId?: string;
    siteId?: string;
    date: string;
  }
): ResolutionResult<RateCondition> {
  const targetDate = startOfDay(parseISO(context.date));

  // 1. Initial Filtering (Type, Status, Mode, Date)
  let applicable = conditions.filter(c => 
    c.isActive && 
    c.eventType === context.eventType &&
    (c.workMode === 'BOTH' || c.workMode === context.workMode)
  );

  applicable = applicable.filter(c => {
    const start = startOfDay(parseISO(c.effectiveDate));
    const end = c.endDate ? startOfDay(parseISO(c.endDate)) : null;
    return (isAfter(targetDate, start) || isSameDay(targetDate, start)) && 
           (!end || isBefore(targetDate, end) || isSameDay(targetDate, end));
  });

  if (applicable.length === 0) {
    return { 
      data: null, 
      warnings: [`No rate condition defined for event '${context.eventType}' on ${context.date}.`], 
      isMatch: false 
    };
  }

  // 2. Score Specificity
  // We sort by a calculated specificity score, then by displayOrder
  const scored = applicable.map(c => {
    let score = 0;
    if (c.positionId && c.positionId === context.positionId) score += 100;
    if (c.siteId && c.siteId === context.siteId) score += 50;
    if (c.workMode !== 'BOTH') score += 10;
    return { condition: c, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.condition.displayOrder - b.condition.displayOrder;
  });

  const best = scored[0].condition;
  const warnings: string[] = [];

  // Warn if we are using a general rate when a specific one was requested
  if (context.positionId && !best.positionId) {
    warnings.push(`Using general ${best.eventType} rate (No position-specific rate found for ${context.positionId}).`);
  }

  return { data: best, warnings, isMatch: true };
}

/**
 * Validates if a contract term has sufficient rate coverage for critical operational events.
 */
export function validateContractTermCoverage(
  conditions: RateCondition[],
  requiredEvents: RateConditionEventType[] = ['work_day', 'travel_day', 'standby_day']
): { isValid: boolean; missingEvents: RateConditionEventType[] } {
  const existingEvents = new Set(conditions.filter(c => c.isActive).map(c => c.eventType));
  const missingEvents = requiredEvents.filter(e => !existingEvents.has(e));

  return {
    isValid: missingEvents.length === 0,
    missingEvents
  };
}
