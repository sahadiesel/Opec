/** ช่วงงวด Trip ที่ผู้ใช้แก้ได้ — ค่าเริ่มต้น M1 กลุ่มท้ายถึง D1 */

export type TripPeriodYmdRange = {
  startYmd: string;
  endYmd: string;
};

export type TripPeriodOverlapHit = {
  invoiceId: string;
  invoiceNo: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  /** ใบยืนยันแล้ว (ISSUED) = ถือว่าเก็บเงิน/ล็อกงวดแล้ว ห้ามทับ */
  collected: boolean;
};

export type TripPeriodEvaluation = {
  startYmd: string;
  endYmd: string;
  suggestedStart: string;
  suggestedEnd: string;
  lastD1: string;
  endAfterD1: boolean;
  overlaps: TripPeriodOverlapHit[];
  collectedOverlaps: TripPeriodOverlapHit[];
  billedOverlaps: TripPeriodOverlapHit[];
  blockMessage?: string;
  confirmMessages: string[];
};

export function isIsoYmd(value: string | undefined | null): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
}

export function asIsoYmd(value: string | undefined | null): string {
  const d = String(value || '').slice(0, 10);
  return isIsoYmd(d) ? d : '';
}

/** ตัด timestamp 0 / ปี 1970 / ปี พ.ศ. ที่เพี้ยน — ไม่ใช่วันวางบิลจริง */
export function isPlausibleBillingYmd(value: string | undefined | null): boolean {
  const d = asIsoYmd(value);
  if (!d) return false;
  const y = Number(d.slice(0, 4));
  return y >= 2018 && y <= 2100;
}

export function plausibleBillingYmd(value: string | undefined | null): string {
  return isPlausibleBillingYmd(value) ? asIsoYmd(value) : '';
}

export function nextCalendarDayYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function ymdRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = asIsoYmd(aStart);
  const ae = asIsoYmd(aEnd);
  const bs = asIsoYmd(bStart);
  const be = asIsoYmd(bEnd);
  if (!as || !ae || !bs || !be) return false;
  return as <= be && bs <= ae;
}

/** วันแรกของกลุ่มวันที่ติดกันชุดท้าย — M1 30/9 กับ 2/10 ที่ไม่ติดกัน → 2/10 */
export function lastConsecutiveClusterStart(dates: readonly string[]): string {
  const uniq = [...new Set(dates.map(asIsoYmd).filter(Boolean))].sort();
  if (uniq.length === 0) return '';
  let clusterStart = uniq[uniq.length - 1]!;
  for (let i = uniq.length - 2; i >= 0; i -= 1) {
    const prev = uniq[i]!;
    if (nextCalendarDayYmd(prev) === clusterStart) clusterStart = prev;
    else break;
  }
  return clusterStart;
}

export function lastIsoYmd(dates: readonly string[]): string {
  const uniq = [...new Set(dates.map(asIsoYmd).filter(Boolean))].sort();
  return uniq[uniq.length - 1] || '';
}

export function firstIsoYmd(dates: readonly string[]): string {
  const uniq = [...new Set(dates.map(asIsoYmd).filter(Boolean))].sort();
  return uniq[0] || '';
}

export function suggestedTripWindowFromEventDates(input: {
  m1Dates: readonly string[];
  d1Dates: readonly string[];
  activityDates: readonly string[];
}): { suggestedStart: string; suggestedEnd: string; lastD1: string; firstM1: string } {
  const firstM1 = firstIsoYmd(input.m1Dates);
  const lastM1Cluster = lastConsecutiveClusterStart(input.m1Dates);
  const lastD1 = lastIsoYmd(input.d1Dates);
  const lastActivity = lastIsoYmd(input.activityDates);
  const firstActivity = firstIsoYmd(input.activityDates);
  const suggestedStart = lastM1Cluster || firstM1 || firstActivity;
  const suggestedEnd = lastD1 || lastActivity;
  return { suggestedStart, suggestedEnd, lastD1, firstM1 };
}

export function tripInvoiceStatusIsCollected(status: string | undefined | null): boolean {
  return String(status || '').trim() === 'ISSUED';
}

export function evaluateTripPeriodSelection(input: {
  startYmd: string;
  endYmd: string;
  suggestedStart: string;
  suggestedEnd: string;
  lastD1: string;
  overlaps: readonly TripPeriodOverlapHit[];
}): TripPeriodEvaluation {
  const startYmd = asIsoYmd(input.startYmd);
  const endYmd = asIsoYmd(input.endYmd);
  const suggestedStart = asIsoYmd(input.suggestedStart);
  const suggestedEnd = asIsoYmd(input.suggestedEnd);
  const lastD1 = asIsoYmd(input.lastD1);
  const overlaps = [...input.overlaps];
  const collectedOverlaps = overlaps.filter((o) => o.collected);
  const billedOverlaps = overlaps.filter((o) => !o.collected);
  const endAfterD1 = Boolean(lastD1 && endYmd && endYmd > lastD1);

  const confirmMessages: string[] = [];
  let blockMessage: string | undefined;

  if (!isPlausibleBillingYmd(startYmd) || !isPlausibleBillingYmd(endYmd)) {
    blockMessage = 'เลือกวันเริ่มต้นและวันสิ้นสุดของงวด Trip';
  } else if (startYmd > endYmd) {
    blockMessage = 'วันเริ่มต้นต้องไม่หลังวันสิ้นสุด';
  } else if (collectedOverlaps.length > 0) {
    const sample = collectedOverlaps
      .slice(0, 3)
      .map((o) => `${o.invoiceNo || o.invoiceId} (${o.periodStart}–${o.periodEnd})`)
      .join(', ');
    blockMessage = `ไม่สามารถทับช่วงวันที่ออกบิลยืนยันแล้วได้ — ${sample}`;
  }

  if (!blockMessage && billedOverlaps.length > 0) {
    const sample = billedOverlaps
      .slice(0, 3)
      .map((o) => `${o.invoiceNo || o.invoiceId} (${o.periodStart}–${o.periodEnd})`)
      .join(', ');
    confirmMessages.push(
      `วันเริ่มต้น/ช่วงที่เลือกทับใบแจ้งหนี้ที่มีอยู่แล้ว (${sample}) — ยืนยันว่าจะวางบิลช่วงนี้`,
    );
  }
  if (!blockMessage && endAfterD1) {
    confirmMessages.push(
      `วันสิ้นสุดเลย D1 (${lastD1}) — ระบบจะรวมวันหลังลงเรือในช่วงที่เลือก ถ้ามีใบงาน`,
    );
  }

  return {
    startYmd,
    endYmd,
    suggestedStart,
    suggestedEnd,
    lastD1,
    endAfterD1,
    overlaps,
    collectedOverlaps,
    billedOverlaps,
    blockMessage,
    confirmMessages,
  };
}

export function formatTripPeriodConfirmBody(evaluation: TripPeriodEvaluation): string {
  return evaluation.confirmMessages.join('\n');
}
