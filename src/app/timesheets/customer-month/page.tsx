import { redirect } from 'next/navigation';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Legacy URL — ยกเลิกหน้าแยก ใช้ `/timesheets/wave-month` แทน */
export default async function CustomerMonthLegacyRedirectPage({ searchParams }: Props) {
  const sp = await searchParams;
  const month = typeof sp.month === 'string' ? sp.month : undefined;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    redirect(`/timesheets/wave-month?month=${encodeURIComponent(month)}`);
  }
  redirect('/timesheets/wave-month');
}
