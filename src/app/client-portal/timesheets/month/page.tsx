import { redirect } from 'next/navigation';

/** Legacy URL — monthly detail opens from the hub per wave + month. */
export default function ClientPortalTimesheetsMonthRedirectPage() {
  redirect('/client-portal/timesheets');
}
