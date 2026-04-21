import { redirect } from 'next/navigation';

/** รายการใบวางบิล (Billing Notes) ย้ายไปใช้ «รายการใบแจ้งหนี้ (เรียกเก็บ)» — สร้างและติดตามที่ /draft-invoices */
export default function BillingNotesListRedirectPage() {
  redirect('/draft-invoices');
}
