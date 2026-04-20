import { redirect } from 'next/navigation';

/** Daily row list removed — portal shows approved monthly periods only. */
export default function ClientPortalTimesheetsDailyRedirectPage() {
  redirect('/client-portal/timesheets');
}
