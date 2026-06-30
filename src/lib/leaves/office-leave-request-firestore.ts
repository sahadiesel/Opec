import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';

/** อ่าน createdAt จาก number หรือ Firestore Timestamp */
export function officeLeaveCreatedAtMs(
  row: Pick<OfficeLeaveRequestDoc, 'createdAt'> & { createdAt?: unknown },
): number {
  const c = row.createdAt;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (c && typeof c === 'object' && 'toMillis' in c && typeof (c as { toMillis: () => number }).toMillis === 'function') {
    return (c as { toMillis: () => number }).toMillis();
  }
  if (c && typeof c === 'object' && 'seconds' in c) {
    const sec = Number((c as { seconds: number }).seconds);
    if (Number.isFinite(sec)) return sec * 1000;
  }
  return 0;
}

/** ปี ค.ศ. ของใบลา — ใช้ field year หรือ fallback จาก startDate */
export function officeLeaveCalendarYear(
  row: Pick<OfficeLeaveRequestDoc, 'year' | 'startDate'>,
): number | null {
  const fromField = Number(row.year);
  if (Number.isFinite(fromField) && fromField >= 2000 && fromField <= 2100) return fromField;
  const fromStart = Number(String(row.startDate || '').slice(0, 4));
  if (Number.isFinite(fromStart) && fromStart >= 2000 && fromStart <= 2100) return fromStart;
  return null;
}

export function officeLeaveMatchesCalendarYear(
  row: Pick<OfficeLeaveRequestDoc, 'year' | 'startDate'>,
  ceYear: number,
): boolean {
  const y = officeLeaveCalendarYear(row);
  return y === ceYear;
}

/** เตรียม payload ก่อนเขียน Firestore — ไม่ส่ง halfDaySession เมื่อไม่ใช่ครึ่งวัน */
export function prepareOfficeLeaveRequestForFirestore(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  if (!out.isHalfDay) {
    delete out.halfDaySession;
  }
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

export function sortOfficeLeaveRequestsNewestFirst<T extends Pick<OfficeLeaveRequestDoc, 'createdAt'>>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => officeLeaveCreatedAtMs(b) - officeLeaveCreatedAtMs(a));
}
