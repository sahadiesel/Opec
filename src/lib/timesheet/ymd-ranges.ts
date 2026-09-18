export type YmdRange = { startYmd: string; endYmd: string };

function isYmd(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function ymdInRange(ymd: string, range: YmdRange): boolean {
  return isYmd(ymd) && isYmd(range.startYmd) && isYmd(range.endYmd) && ymd >= range.startYmd && ymd <= range.endYmd;
}

export function ymdInRanges(ymd: string, ranges: readonly YmdRange[]): boolean {
  return ranges.some((r) => ymdInRange(ymd, r));
}

/** รวมวันที่ทำงานที่ติดกันเป็นช่วง เช่น 1–12 และ 18–30 */
export function suggestContiguousYmdRanges(dates: readonly string[]): YmdRange[] {
  const sorted = [...new Set(dates.map((d) => d.slice(0, 10)).filter(isYmd))].sort();
  const ranges: YmdRange[] = [];
  for (const d of sorted) {
    const last = ranges[ranges.length - 1];
    if (!last) {
      ranges.push({ startYmd: d, endYmd: d });
      continue;
    }
    const prev = new Date(`${last.endYmd}T00:00:00`);
    prev.setDate(prev.getDate() + 1);
    const next = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
    if (d === next) last.endYmd = d;
    else ranges.push({ startYmd: d, endYmd: d });
  }
  return ranges;
}

export function rangesOverlap(a: YmdRange, b: YmdRange): boolean {
  return a.startYmd <= b.endYmd && b.startYmd <= a.endYmd;
}

export function formatYmdRangesTh(ranges: readonly YmdRange[]): string {
  return ranges.map((r) => (r.startYmd === r.endYmd ? r.startYmd : `${r.startYmd} – ${r.endYmd}`)).join(', ');
}
