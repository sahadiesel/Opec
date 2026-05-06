import { redirect } from 'next/navigation';

/** เดิมเป็นคิวตรวจสอบแยก — รวมงานไปที่รับวางบิลแล้ว */
export default function AccountingOutgoingReviewRedirectPage() {
  redirect('/ap-bills');
}
