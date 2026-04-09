# Step 2–3 — งวดชำระเงิน + ปิด PO อัตโนมัติเมื่อจ่ายครบ

อ้างอิง: [Step 0](./purchases-po-workflow-step0.md) · [Step 1](./purchases-po-workflow-step1.md)

## สิ่งที่ทำ

### โมเดลข้อมูล

- คอลเลกชันย่อย: `purchases/{purchaseId}/payment_milestones`
- ประเภทใน `src/lib/types.ts`: `PurchasePaymentMilestone`, `PurchasePaymentMilestoneStatus` (`OPEN` | `PAID` | `WAIVED`)
- ฟิลด์ `Purchase.paymentStatus` ใช้บันทึก `UNPAID` | `PARTIAL` | `PAID` (sync อัตโนมัติ)

### ตรรกะปิด PO

- ไฟล์ `src/lib/ops/purchase-payment-milestones.ts`
  - รวมยอดงวดต้องเท่ายอดสุทธิ PO (ทนการปัดเศษ &lt; 0.02 บาท)
  - เมื่อทุกงวดเป็น `PAID` หรือ `WAIVED` และยอดรวมตรง → อัปเดต `status: COMPLETED`, `paymentStatus: PAID`
  - ถ้าเคย `COMPLETED` แต่ถอนการชำระ/ยกเลิกงวดจนยังไม่ครบ → กลับ `ISSUED` และ `PARTIAL` / `UNPAID`

### UI

- คอมโพเนนต์ `src/components/purchases/purchase-payment-plan-card.tsx` บนหน้า `purchases/[id]`
- แสดงเมื่อ PO อยู่ในสถานะ `APPROVED` | `ISSUED` | `COMPLETED` และ `totalAmount &gt; 0`
- แม่แบบเริ่มต้น:
  - เงินสด งวดเดียว 100%
  - เครดิต งวดเดียว 100% — ตั้ง `dueDate` จาก `purchaseDate` + `vendor.creditDays` (ค่าเริ่ม 30)
  - มัดจำ 30% + ส่วนที่เหลือ
- งวดละ: บันทึกชำระแล้ว / ยกเว้น / ยกเลิก (กลับเป็น OPEN)
- ลบแผนได้เมื่อทุกงวดยัง `OPEN` เท่านั้น

### รายการเก่า

- `COMPLETED` แต่ไม่มี milestone ในระบบ → แสดงการ์ดข้อความว่าเป็นรายการก่อนมีฟีเจอร์ (ไม่ให้สร้างแผนใหม่โดยไม่ตั้งใจ)

## Step ถัดไป

- **Step 4 (ทำแล้ว):** [purchases-po-workflow-step4.md](./purchases-po-workflow-step4.md)

## ยังไม่ทำ

- ผูก cashbook / บัญชีธนาคารตอนกดชำระ
- Sync milestone อัตโนมัติเมื่อจ่ายจากใบวางบิล
- แม่แบบมากกว่า 3 แบบ / แก้ % มัดจำในฟอร์ม
