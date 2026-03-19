'use client';

import { 
  startOfMonth, 
  endOfMonth, 
  addMonths, 
  isBefore, 
  isAfter, 
  format, 
  parseISO, 
  startOfDay,
  endOfDay,
  isWithinInterval,
  isSameDay
} from 'date-fns';
import { PayrollPeriod } from '@/lib/types';

/**
 * Generates an array of monthly period boundaries for a given date range.
 * Business Rule: A range spanning multiple months is split at month boundaries.
 * Example: 2026-01-15 to 2026-03-15 becomes:
 * - 2026-01-15 to 2026-01-31
 * - 2026-02-01 to 2026-02-28
 * - 2026-03-01 to 2026-03-15
 */
export function generateMonthlyPeriodsForRange(startDateStr: string, endDateStr: string): { startDate: string; endDate: string; label: string }[] {
  const startDate = parseISO(startDateStr);
  const endDate = parseISO(endDateStr);
  const chunks: { startDate: string; endDate: string; label: string }[] = [];
  
  if (isAfter(startDate, endDate)) return [];

  let currentStart = startDate;
  
  while (isBefore(currentStart, endDate) || isSameDay(currentStart, endDate)) {
    const currentMonthEnd = endOfMonth(currentStart);
    const chunkEnd = isBefore(currentMonthEnd, endDate) ? currentMonthEnd : endDate;
    
    chunks.push({
      startDate: format(currentStart, 'yyyy-MM-dd'),
      endDate: format(chunkEnd, 'yyyy-MM-dd'),
      label: format(currentStart, 'MMMM yyyy'),
    });
    
    // Move to the 1st of the next month
    currentStart = startOfMonth(addMonths(currentStart, 1));
    
    // If the next start is already after our range end, we are done
    if (isAfter(currentStart, endDate)) break;
  }
  
  return chunks;
}

/**
 * Filters a list of periods to find those that overlap with a specific date range.
 */
export function listPeriodsOverlappingRange(periods: PayrollPeriod[], start: string, end: string): PayrollPeriod[] {
  const rangeStart = startOfDay(parseISO(start));
  const rangeEnd = endOfDay(parseISO(end));

  return periods.filter(period => {
    const pStart = startOfDay(parseISO(period.startDate));
    const pEnd = endOfDay(parseISO(period.endDate));

    // Overlap exists if: (StartA <= EndB) and (EndA >= StartB)
    const startALessEndB = isBefore(pStart, rangeEnd) || isSameDay(pStart, rangeEnd);
    const endAGreaterStartB = isAfter(pEnd, rangeStart) || isSameDay(pEnd, rangeStart);

    return startALessEndB && endAGreaterStartB;
  });
}

/**
 * Finds which period contains a specific date.
 */
export function findCurrentPeriodForDate(periods: PayrollPeriod[], date: string): PayrollPeriod | null {
  const targetDate = startOfDay(parseISO(date));

  return periods.find(period => {
    const start = startOfDay(parseISO(period.startDate));
    const end = endOfDay(parseISO(period.endDate));
    return isWithinInterval(targetDate, { start, end });
  }) || null;
}
