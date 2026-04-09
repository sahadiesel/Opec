import { redirect } from 'next/navigation';

/** PO list is shown under Contracts (expand rows) + “Other POs” section. */
export default function ClientPosRedirectPage() {
  redirect('/client-portal/contracts');
}
