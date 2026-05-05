import { redirect } from 'next/navigation';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Legacy URL — รวมเป็นหน้า `/timesheets/wave-month` เดียว */
export default async function TimesheetPoMonthLegacyRedirectPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string' && v.length > 0) q.set(k, v);
    else if (Array.isArray(v) && typeof v[0] === 'string') q.set(k, v[0]);
  }
  const qs = q.toString();
  redirect(`/timesheets/wave-month${qs ? `?${qs}` : ''}`);
}
