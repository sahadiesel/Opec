/** ชุย partial billing สำหรับ PO+เดือน (Phase 2) */

export function normalizeWorkerIdSet(ids: readonly string[]): string[] {
  return [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))].sort();
}

export function workerIdSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  const na = normalizeWorkerIdSet(a);
  const nb = normalizeWorkerIdSet(b);
  if (na.length !== nb.length) return false;
  return na.every((x, i) => x === nb[i]);
}

/** ใบแจ้งหนี้แบบ partial (มี coveredWorkerIds) */
export function isPartialPoMonthCommercialInvoice(inv: {
  coveredWorkerIds?: readonly string[] | null;
}): boolean {
  return normalizeWorkerIdSet(inv.coveredWorkerIds ?? []).length > 0;
}

/** ใบครอบคลุมชุด worker ที่ระบุ (partial = ต้องตรงชุด · full = ครอบทุกคน) */
export function commercialInvoiceCoversWorkerSet(
  inv: { status?: string; coveredWorkerIds?: readonly string[] | null },
  workerIds: readonly string[],
): boolean {
  if (inv.status === 'VOID') return false;
  const want = normalizeWorkerIdSet(workerIds);
  if (want.length === 0) return false;
  const covered = normalizeWorkerIdSet(inv.coveredWorkerIds ?? []);
  if (covered.length === 0) return true;
  return workerIdSetsEqual(covered, want);
}

export function commercialInvoiceCoversAnyWorker(
  inv: { status?: string; coveredWorkerIds?: readonly string[] | null },
  workerId: string,
): boolean {
  const wid = workerId.trim();
  if (!wid) return false;
  if (inv.status === 'VOID') return false;
  const covered = normalizeWorkerIdSet(inv.coveredWorkerIds ?? []);
  if (covered.length === 0) return true;
  return covered.includes(wid);
}

export function partialPoMonthInvoiceLabel(batchNo: number | undefined, workerCount: number): string {
  const batch = batchNo != null && batchNo > 0 ? ` · รอบ ${batchNo}` : '';
  return `PO+งวด (บางส่วน · ${workerCount} คน${batch})`;
}

/** แจ้งเตือนเมื่อรอ timesheet เกินกี่วัน (Phase 3) */
export const DEFERRED_SHIP_TIMESHEET_ALERT_DAYS = 7;

export interface PartialBillingCandidate {
  id: string;
  poId: string;
  yearMonth: string;
  reviewId: string;
  batchNo?: number;
  workerIds: string[];
  workerNames: string[];
}

/** คนงานที่อนุมัติแล้วแต่ยังไม่มี invoice ครอบชุดนั้น */
export function listPartialBillingCandidates(
  poId: string,
  yearMonth: string,
  reviewId: string,
  closures: ReadonlyArray<{
    workerId: string;
    workerName?: string;
    status: string;
    closureBatchNo?: number;
  }>,
  invoices: ReadonlyArray<{
    status?: string;
    poId?: string;
    periodStart?: string;
    periodEnd?: string;
    sourcePoMonthReviewId?: string;
    coveredWorkerIds?: readonly string[] | null;
  }>,
  period?: { start: string; end: string },
): PartialBillingCandidate[] {
  const approved = closures.filter((c) => c.status === 'approved');
  if (approved.length === 0) return [];

  const related = invoices.filter((inv) => {
    if (inv.status === 'VOID') return false;
    if (inv.poId !== poId) return false;
    if (inv.sourcePoMonthReviewId === reviewId) return true;
    if (period && inv.periodStart === period.start && inv.periodEnd === period.end) return true;
    return false;
  });

  const out: PartialBillingCandidate[] = [];
  const batchNos = [
    ...new Set(
      approved
        .map((c) => c.closureBatchNo)
        .filter((n): n is number => typeof n === 'number' && n > 0),
    ),
  ].sort((a, b) => a - b);

  for (const batchNo of batchNos) {
    const inBatch = approved.filter((c) => c.closureBatchNo === batchNo);
    const workerIds = normalizeWorkerIdSet(inBatch.map((c) => c.workerId));
    if (workerIds.length === 0) continue;
    if (related.some((inv) => commercialInvoiceCoversWorkerSet(inv, workerIds))) continue;
    out.push({
      id: `${reviewId}:batch:${batchNo}`,
      poId,
      yearMonth,
      reviewId,
      batchNo,
      workerIds,
      workerNames: inBatch.map((c) => c.workerName || c.workerId),
    });
  }

  const inKnownBatch = new Set(
    approved.filter((c) => c.closureBatchNo != null && c.closureBatchNo > 0).map((c) => c.workerId),
  );
  const singles = approved.filter((c) => !inKnownBatch.has(c.workerId));
  for (const c of singles) {
    const workerIds = [c.workerId];
    if (related.some((inv) => commercialInvoiceCoversWorkerSet(inv, workerIds))) continue;
    out.push({
      id: `${reviewId}:worker:${c.workerId}`,
      poId,
      yearMonth,
      reviewId,
      workerIds,
      workerNames: [c.workerName || c.workerId],
    });
  }

  return out;
}

export function deferredClosureAgeDays(
  closure: { status: string; deferredAt?: number; updatedAt?: number; createdAt?: number },
  nowMs = Date.now(),
): number {
  if (closure.status !== 'deferred') return 0;
  const since = closure.deferredAt ?? closure.updatedAt ?? closure.createdAt ?? nowMs;
  return Math.max(0, Math.floor((nowMs - since) / (24 * 60 * 60 * 1000)));
}

export function isDeferredClosureOverdue(
  closure: { status: string; deferredAt?: number; updatedAt?: number; createdAt?: number },
  thresholdDays = DEFERRED_SHIP_TIMESHEET_ALERT_DAYS,
): boolean {
  return closure.status === 'deferred' && deferredClosureAgeDays(closure) >= thresholdDays;
}
