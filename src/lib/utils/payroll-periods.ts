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
 * รอบเต็มเดือนปฏิทิน (วันที่ 1 – วันสุดท้ายของเดือนเดียวกัน)
 */
export function isFullCalendarMonthRange(startDate: string, endDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  const ym = startDate.slice(0, 7);
  if (!endDate.startsWith(ym) || !startDate.endsWith('-01')) return false;
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return false;
  const last = new Date(y, m, 0);
  const d = String(last.getDate()).padStart(2, '0');
  const expectedEnd = `${y}-${String(m).padStart(2, '0')}-${d}`;
  return endDate === expectedEnd;
}

const STATUS_RANK: Record<string, number> = {
  PROCESSING: 5,
  OPEN: 4,
  LOCKED: 3,
  CLOSED: 2,
  DRAFT: 1,
};

function periodRowPriority(p: PayrollPeriod): number {
  let s = STATUS_RANK[p.status] ?? 0;
  if (p.id.startsWith('worker_ym_')) s += 20;
  s += Math.min(p.generatedAt / 1e15, 1);
  return s;
}

/**
 * รวบรายการ payroll_periods ที่ช่วงวันที่ซ้ำกัน (เช่น สร้างด้วยมือ + สร้างอัตโนมัติจาก Wave)
 * คงรายการที่มี id worker_ym_* และสถานะสูงกว่า
 */
export function dedupePayrollPeriodRows(periods: PayrollPeriod[]): PayrollPeriod[] {
  const groups = new Map<string, PayrollPeriod[]>();
  for (const p of periods) {
    const key = `${p.startDate}|${p.endDate}|${p.cycleType}`;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  const out: PayrollPeriod[] = [];
  for (const arr of groups.values()) {
    if (arr.length === 1) {
      out.push(arr[0]);
      continue;
    }
    const sorted = [...arr].sort((a, b) => periodRowPriority(b) - periodRowPriority(a));
    out.push(sorted[0]);
  }
  out.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
  return out;
}

/**
 * Generates an array of monthly period boundaries for a given date range.
 * Business Rule: A range spanning multiple months is split at month boundaries.
 * Example: 2026-01-15 to 2026-03-15 becomes:
 * - 2026-01-15 to 2026-01-31 (Label: January 2026)
 * - 2026-02-01 to 2026-02-28 (Label: February 2026)
 * - 2026-03-01 to 2026-03-15 (Label: March 2026)
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
