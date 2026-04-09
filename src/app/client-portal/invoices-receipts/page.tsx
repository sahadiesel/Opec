import { redirect } from 'next/navigation';

export default function ClientInvoicesReceiptsRedirect() {
  redirect('/client-portal/accounting?tab=invoices');
}
