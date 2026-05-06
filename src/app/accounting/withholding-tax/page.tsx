import { redirect } from 'next/navigation';

/** สรุปยอดหัก ณ ที่จ่ายค้างนำส่ง — ย้ายการทำงานไปที่ใบรับวางบิลหลังจ่ายแล้ว */
export default function WithholdingTaxItemsRedirectPage() {
  redirect('/ap-bills');
}
