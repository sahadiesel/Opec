import { redirect } from 'next/navigation';

export default function ClientDraftInvoicesListRedirect() {
  redirect('/client-portal/accounting?tab=invoices');
}
