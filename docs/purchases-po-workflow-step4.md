# Step 4 — วางบิล & แจ้งบัญชี (ผูกงวดชำระ)

อ้างอิง: [Step 2–3](./purchases-po-workflow-step2-3.md)

## สิ่งที่ทำ

### ข้อมูล

- `PurchasePaymentMilestone.vendorBillId` — ลิงก์ไป `purchase_vendor_bills/{id}`
- `PurchaseVendorBill.milestoneId`, `billAmount` — ใบต่องวดและยอดที่ส่งบัญชี (ถ้าไม่มี `billAmount` ใช้ยอดสุทธิ PO แบบเดิม)

### จากหน้าใบสั่งซื้อ

- ในการ์ดแผนงวด: งวด `OPEN` มีปุ่ม **สร้างใบรับวางบิล** (สิทธิ์: มองคลัง `store_inventory` หรือแก้ไข `purchases`)
- หลังสร้าง: แสดงลิงก์ไป `/store/vendor-bills/{id}` และสถานะใบ (ร่าง / แจ้งบัญชีแล้ว / จ่ายแล้ว)
- **ลบแผนงวด** ไม่ได้ถ้ามีงวดที่ผูกใบรับวางบิลแล้ว
- **ยกเว้นงวด** — ถ้ามีใบร่าง จะลบใบร่างอัตโนมัติ; ถ้าส่งบัญชี/จ่ายแล้วจะบล็อก
- **ยกเลิก** สถานะงวด — ถ้าใบเป็นร่างจะลบใบและถอน `vendorBillId`; ถ้าส่งบัญชีแล้วจะบล็อก

### เมนูคลัง → รับวางบิล

- สร้างใบแบบ “ทั้งใบสั่งซื้อ” **ไม่ได้** ถ้า PO นั้นมี `payment_milestones` อย่างน้อยหนึ่งรายการ — ต้องสร้างทีละงวดจากหน้าใบสั่งซื้อ
- ใบที่สร้างจากเมนูคลัง (ไม่มีงวด) ตั้ง `billAmount = totalAmount` ของ PO

### แจ้งบัญชี (เดิม + ปรับยอด)

- หน้า `/store/vendor-bills/[id]`: **ส่งแผนกบัญชี** สร้าง/อัปเดต `accounts_payable` ด้วยยอด **`bill.billAmount ?? purchase.totalAmount`**
- **บันทึกจ่ายเงิน** ใช้ยอดเดียวกัน
- แสดงข้อความอ้างอิงงวด (`#sequence` + label) เมื่อมี `milestoneId`

## Step ถัดไป

- **Step 5 (ทำแล้ว):** [purchases-po-workflow-step5.md](./purchases-po-workflow-step5.md)

## ยังไม่ทำ

- void / ย้อนรายการจ่ายแบบครบชุด
