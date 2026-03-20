'use client';

import { Firestore, collection, query, where, getDocs } from 'firebase/firestore';
import { DailyTimesheet } from '../types';

/**
 * @fileOverview Reusable aggregation helpers for DailyTimesheet records.
 * Provides the data foundation for automated payroll and billing cycles.
 */

/**
 * Standard shape for an aggregated group of timesheets.
 */
export interface TimesheetAggregationResult {
  groupId: string;
  groupLabel?: string;
  count: number;
  timesheetIds: string[];
  eventBreakdown: Record<string, number>; // Counts occurrences of each eventType
  metrics: {
    normalHours: number;
    ot15Hours: number;
    ot20Hours: number;
    ot30Hours: number;
    holidayHours: number;
    standbyUnits: number;
    travelUnits: number;
    mobUnits: number;
    demobUnits: number;
    paidLeaveUnits: number;
    unpaidLeaveUnits: number;
  }
}

/**
 * Fetches all CLIENT_APPROVED timesheets within a specific date range.
 * This is the primary filter for financial processing.
 */
export async function listApprovedTimesheetsForPeriod(
  db: Firestore,
  startDate: string,
  endDate: string
): Promise<DailyTimesheet[]> {
  const tsRef = collection(db, 'daily_timesheets');
  
  // Rule: Only client_approved items are included in financial summaries
  const q = query(
    tsRef,
    where('status', '==', 'CLIENT_APPROVED'),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as DailyTimesheet));
}

/**
 * Core reduction logic to transform a list of timesheets into a summary.
 */
function reduceTimesheets(groupId: string, timesheets: DailyTimesheet[], label?: string): TimesheetAggregationResult {
  const initial: TimesheetAggregationResult = {
    groupId,
    groupLabel: label,
    count: timesheets.length,
    timesheetIds: timesheets.map(ts => ts.id),
    eventBreakdown: {},
    metrics: {
      normalHours: 0,
      ot15Hours: 0,
      ot20Hours: 0,
      ot30Hours: 0,
      holidayHours: 0,
      standbyUnits: 0,
      travelUnits: 0,
      mobUnits: 0,
      demobUnits: 0,
      paidLeaveUnits: 0,
      unpaidLeaveUnits: 0,
    }
  };

  return timesheets.reduce((acc, ts) => {
    // 1. Tally event types
    acc.eventBreakdown[ts.eventType] = (acc.eventBreakdown[ts.eventType] || 0) + 1;

    // 2. Sum numeric metrics
    acc.metrics.normalHours += ts.normalHours || 0;
    acc.metrics.ot15Hours += ts.ot15Hours || 0;
    acc.metrics.ot20Hours += ts.ot20Hours || 0;
    acc.metrics.ot30Hours += ts.ot30Hours || 0;
    acc.metrics.holidayHours += ts.holidayHours || 0;
    acc.metrics.standbyUnits += ts.standbyUnits || 0;
    acc.metrics.travelUnits += ts.travelUnits || 0;
    acc.metrics.mobUnits += ts.mobUnits || 0;
    acc.metrics.demobUnits += ts.demobUnits || 0;
    acc.metrics.paidLeaveUnits += ts.paidLeaveUnits || 0;
    acc.metrics.unpaidLeaveUnits += ts.unpaidLeaveUnits || 0;

    return acc;
  }, initial);
}

/**
 * Aggregates a list of timesheets by Worker ID.
 * Useful for calculating monthly payroll for individuals.
 */
export function aggregateTimesheetsByWorkerForPeriod(timesheets: DailyTimesheet[]): Record<string, TimesheetAggregationResult> {
  const groups: Record<string, DailyTimesheet[]> = {};
  
  // Safety filter: ensure we only aggregate approved items
  const approvedOnly = timesheets.filter(ts => ts.status === 'CLIENT_APPROVED' || ts.status === 'LOCKED');

  approvedOnly.forEach(ts => {
    if (!groups[ts.workerId]) groups[ts.workerId] = [];
    groups[ts.workerId].push(ts);
  });

  const results: Record<string, TimesheetAggregationResult> = {};
  Object.entries(groups).forEach(([workerId, list]) => {
    results[workerId] = reduceTimesheets(workerId, list, list[0].workerNameSnapshot);
  });

  return results;
}

/**
 * Aggregates a list of timesheets by Wave ID.
 * Useful for tracking operational progress and site-level costs.
 */
export function aggregateTimesheetsByWaveForPeriod(timesheets: DailyTimesheet[]): Record<string, TimesheetAggregationResult> {
  const groups: Record<string, DailyTimesheet[]> = {};
  const approvedOnly = timesheets.filter(ts => ts.status === 'CLIENT_APPROVED' || ts.status === 'LOCKED');

  approvedOnly.forEach(ts => {
    if (!groups[ts.waveId]) groups[ts.waveId] = [];
    groups[ts.waveId].push(ts);
  });

  const results: Record<string, TimesheetAggregationResult> = {};
  Object.entries(groups).forEach(([waveId, list]) => {
    results[waveId] = reduceTimesheets(waveId, list);
  });

  return results;
}

/**
 * Aggregates a list of timesheets by Purchase Order ID.
 * Primary helper for generating monthly billing notes for customers.
 */
export function aggregateTimesheetsByPOForPeriod(timesheets: DailyTimesheet[]): Record<string, TimesheetAggregationResult> {
  const groups: Record<string, DailyTimesheet[]> = {};
  const approvedOnly = timesheets.filter(ts => ts.status === 'CLIENT_APPROVED' || ts.status === 'LOCKED');

  approvedOnly.forEach(ts => {
    if (!groups[ts.purchaseOrderId]) groups[ts.purchaseOrderId] = [];
    groups[ts.purchaseOrderId].push(ts);
  });

  const results: Record<string, TimesheetAggregationResult> = {};
  Object.entries(groups).forEach(([poId, list]) => {
    results[poId] = reduceTimesheets(poId, list);
  });

  return results;
}
