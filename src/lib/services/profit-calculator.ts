'use client';

import { 
  PurchaseOrder, 
  Wave, 
  POLine, 
  DailyTimesheet, 
  SalesContractTerm, 
  LaborCostContractTerm, 
  RateCondition,
  PurchaseOrderProfitSnapshot,
  User,
  JobMode,
  RateConditionEventType
} from '@/lib/types';
import { totalPlannedWorkersOnWave } from '@/lib/ops/wave-allocation';
import { calculateDailySalesValue, resolveApplicableSalesRateCondition } from './sales-calculator';
import { calculateDailyLaborCost, resolveApplicableCostRateCondition } from './labor-cost-calculator';
import { parseISO, eachDayOfInterval, format, isWithinInterval, startOfDay } from 'date-fns';

export interface ProfitEstimationResult {
  snapshot: Partial<PurchaseOrderProfitSnapshot>;
  warnings: string[];
  isComplete: boolean;
  meta: {
    daysCalculated: number;
    unresolvedSalesDays: number;
    unresolvedCostDays: number;
  };
}

/**
 * Service for projecting profitability of POs and Waves based on contractual rules.
 */
export class ProfitCalculatorService {
  
  /**
   * Estimates profit for a specific Wave.
   * Uses planned worker counts and specific contract terms.
   */
  async computeEstimatedProfitForWave(
    wave: Wave,
    salesContract: SalesContractTerm,
    costContract: LaborCostContractTerm,
    allConditions: RateCondition[],
    user: User
  ): Promise<ProfitEstimationResult> {
    const start = parseISO(wave.startDate);
    const end = parseISO(wave.endDate);
    const days = eachDayOfInterval({ start, end });
    
    let totalRevenue = 0;
    let totalCost = 0;
    const warnings: string[] = [];
    let unresolvedSales = 0;
    let unresolvedCost = 0;

    // Simulate for each day and each planned worker
    for (const day of days) {
      const dateStr = format(day, 'yyyy-MM-dd');
      
      // We simulate a generic work day for each planned slot
      const mockTs: any = {
        date: dateStr,
        workMode: 'OFFSHORE', // Default for estimation if not specified
        eventType: 'work_day' as RateConditionEventType,
        normalHours: 8,
        positionId: 'ESTIMATED_SLOT',
      };

      // 1. Resolve Revenue
      const salesCond = resolveApplicableSalesRateCondition(allConditions, mockTs, salesContract);
      if (salesCond) {
        totalRevenue +=
          calculateDailySalesValue(mockTs, salesCond, 0) * totalPlannedWorkersOnWave(wave);
      } else {
        unresolvedSales++;
      }

      // 2. Resolve Cost
      const costCond = resolveApplicableCostRateCondition(allConditions, mockTs, costContract);
      if (costCond) {
        totalCost +=
          calculateDailyLaborCost(mockTs, costCond, 0) * totalPlannedWorkersOnWave(wave);
      } else {
        unresolvedCost++;
      }
    }

    if (unresolvedSales > 0) warnings.push(`Could not resolve sales rates for ${unresolvedSales} worker-days.`);
    if (unresolvedCost > 0) warnings.push(`Could not resolve labor cost rates for ${unresolvedCost} worker-days.`);

    const grossProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const snapshot: Partial<PurchaseOrderProfitSnapshot> = {
      purchaseOrderId: wave.poId,
      waveId: wave.id,
      periodStartDate: wave.startDate,
      periodEndDate: wave.endDate,
      estimatedRevenue: totalRevenue,
      estimatedLaborCost: totalCost,
      estimatedGrossProfit: grossProfit,
      estimatedGrossMarginPercent: margin,
      calculationBasisSummary: `Wave simulation: ${totalPlannedWorkersOnWave(wave)} workers over ${days.length} days.`,
      generatedAt: Date.now(),
      generatedBy: user.displayName
    };

    return {
      snapshot,
      warnings,
      isComplete: unresolvedSales === 0 && unresolvedCost === 0,
      meta: {
        daysCalculated: days.length,
        unresolvedSalesDays: unresolvedSales,
        unresolvedCostDays: unresolvedCost
      }
    };
  }

  /**
   * Estimates profit for an entire Purchase Order based on PO Lines.
   */
  async computeEstimatedProfitForPO(
    po: PurchaseOrder,
    poLines: POLine[],
    salesContract: SalesContractTerm,
    costContract: LaborCostContractTerm,
    allConditions: RateCondition[],
    user: User
  ): Promise<ProfitEstimationResult> {
    let totalRevenue = 0;
    let totalCost = 0;
    const warnings: string[] = [];
    
    // For PO level, we aggregate the potential revenue/cost of each PO Line
    for (const line of poLines) {
      if (line.status !== 'active') continue;

      const start = new Date(line.startDate);
      const end = new Date(line.endDate);
      const days = eachDayOfInterval({ start, end });

      for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd');
        const mockTs: any = {
          date: dateStr,
          workMode: 'OFFSHORE',
          eventType: 'work_day' as RateConditionEventType,
          normalHours: 8,
          positionId: line.positionId,
        };

        // Revenue Simulation
        const salesCond = resolveApplicableSalesRateCondition(allConditions, mockTs, salesContract);
        if (salesCond) {
          totalRevenue += calculateDailySalesValue(mockTs, salesCond, line.sellRateSnapshot) * line.quantity;
        } else {
          // Fallback to snapshot if condition fails
          totalRevenue += line.sellRateSnapshot * line.quantity;
        }

        // Cost Simulation
        const costCond = resolveApplicableCostRateCondition(allConditions, mockTs, costContract);
        if (costCond) {
          totalCost += calculateDailyLaborCost(mockTs, costCond, line.costBaselineSnapshot) * line.quantity;
        } else {
          totalCost += line.costBaselineSnapshot * line.quantity;
        }
      }
    }

    const grossProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const snapshot: Partial<PurchaseOrderProfitSnapshot> = {
      purchaseOrderId: po.id,
      waveId: null,
      periodStartDate: format(new Date(po.startDate), 'yyyy-MM-dd'),
      periodEndDate: format(new Date(po.endDate), 'yyyy-MM-dd'),
      estimatedRevenue: totalRevenue,
      estimatedLaborCost: totalCost,
      estimatedGrossProfit: grossProfit,
      estimatedGrossMarginPercent: margin,
      calculationBasisSummary: `PO simulation aggregated from ${poLines.length} active lines.`,
      generatedAt: Date.now(),
      generatedBy: user.displayName
    };

    return {
      snapshot,
      warnings,
      isComplete: true, // PO lines usually have snapshots as fallbacks
      meta: {
        daysCalculated: 0,
        unresolvedSalesDays: 0,
        unresolvedCostDays: 0
      }
    };
  }

  /**
   * Checks for common pitfalls in profit estimation data.
   */
  buildProfitWarningSummary(result: ProfitEstimationResult): string {
    if (result.warnings.length === 0) return "Configuration appears healthy.";
    return `Warning: ${result.warnings.join(' ')} Profits may be underestimated.`;
  }
}
