import { redirect } from 'next/navigation';

export default function ClientBillingRedirect() {
  redirect('/client-portal/accounting?tab=billing');
}
