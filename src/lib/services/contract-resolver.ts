
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
  RateConditionEventType,
  MainContract,
  PurchaseOrder,
  DailyTimesheet,
} from '@/lib/types';
import { syntheticSalesContractTermFromMainContract } from '@/lib/commercial/synthetic-sales-contract-term';
import { syntheticLaborCostContractTermFromMainContract } from '@/lib/commercial/synthetic-labor-cost-contract-term';
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
 * วางบิลจาก timesheet: ใช้สัญญาหลัก + PO เท่านั้น (ไม่อ่าน collection sales_contract_terms)
 */
export function resolveMainContractBillingTerm(
  mainContract: MainContract | undefined,
  po: PurchaseOrder,
  date: string,
): ResolutionResult<SalesContractTerm> {
  if (!mainContract) {
    return {
      data: null,
      warnings: ['PO ยังไม่ผูกสัญญาหลัก (contractId) — ตั้งสัญญาใน PO ก่อนคำนวณวางบิล'],
      isMatch: false,
    };
  }
  const term = syntheticSalesContractTermFromMainContract(mainContract, po);
  const targetDate = startOfDay(parseISO(date));
  const start = startOfDay(parseISO(term.effectiveDate));
  const end = startOfDay(parseISO(term.endDate));
  const inRange =
    (isAfter(targetDate, start) || isSameDay(targetDate, start)) &&
    (isBefore(targetDate, end) || isSameDay(targetDate, end));
  if (!inRange) {
    return {
      data: null,
      warnings: [`วันที่ ${date} อยู่นอกช่วงสัญญาหลัก (${term.effectiveDate} – ${term.endDate})`],
      isMatch: false,
    };
  }
  return { data: term, warnings: [], isMatch: true };
}

/**
 * Legacy: เอกสาร sales_contract_terms แยก — ใช้เฉพาะโมดูลที่ยังอ้าง collection นี้โดยตรง
 * PRIORITY: Purchase Order Match > Customer Match.
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
 * PRIORITY: Specific PO (Scope: SPECIFIC_PO) > General Customer Scope.
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

  // Highest priority: Terms specifically created for this PO
  if (criteria.poId) {
    const poMatch = applicable.find(t => t.relatedPurchaseOrderId === criteria.poId);
    if (poMatch) return { data: poMatch, warnings, isMatch: true };
    warnings.push(`No specific labor cost term for PO ${criteria.poId}. Checking for general customer scope.`);
  }

  // Fallback: Terms covering the entire customer
  if (criteria.customerId) {
    const custMatch = applicable.find(t => t.relatedCustomerId === criteria.customerId && t.scopeType === 'GENERAL_CUSTOMER');
    if (custMatch) return { data: custMatch, warnings, isMatch: true };
  }

  return { data: null, warnings: ['No applicable labor cost term found for this context.'], isMatch: false };
}

/**
 * Payroll / preflight: ลำดับ wave → PO → สัญญาหลัก — ใช้แถว labor_cost_contract_terms ถ้ามี
 * ถ้าไม่มี ให้สังเคราะห์ขอบเขตจาก main_contracts (ต้นทุนตามสัญญา ไม่ผูก sales_contract_terms)
 */
export function resolvePayrollLaborCostContractTerm(
  ts: DailyTimesheet,
  allCostTerms: LaborCostContractTerm[],
  contractMap: Map<string, MainContract>,
  poById: Map<string, PurchaseOrder>,
): LaborCostContractTerm | null {
  const direct = allCostTerms.find(
    (ct) =>
      ct.id === ts.laborCostContractTermId ||
      (ct.relatedPurchaseOrderId === ts.purchaseOrderId && ct.status === 'ACTIVE'),
  );
  if (direct) return direct;

  const main = ts.contractId ? contractMap.get(ts.contractId) : undefined;
  const po = ts.purchaseOrderId ? poById.get(ts.purchaseOrderId) : undefined;
  if (main && po && main.status === 'active') {
    return syntheticLaborCostContractTermFromMainContract(main, po);
  }
  return null;
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
