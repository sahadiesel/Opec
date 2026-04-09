# Step 5 — จ่ายเงิน: cashbook + ธนาคาร + sync งวด PO

อ้างอิง: [Step 4](./purchases-po-workflow-step4.md)

## สิ่งที่ทำ

### ข้อมูล

- `PurchaseVendorBill.cashbookEntryId`, `cashbookEntryNo` — อ้างอิงรายการที่สร้างตอนจ่าย

### ไลบรารี

- `src/lib/ops/vendor-bill-payment.ts` — `executeVendorBillPayment(...)`  
  ใน `writeBatch` เดียว:
  1. สร้าง `cashbook_entries` แบบ **OUT**, `entryType: SUPPLIER_PAYMENT`, `referenceId` = id ใบรับวางบิล  
  2. อัปเดต `bank_accounts.currentBalance` ด้วย **`increment(-amount)`**  
  3. ตั้งใบรับวางบิลเป็น **PAID** + เก็บเลขที่ cashbook  
  4. อัปเดต `accounts_payable` ให้ปิดยอด  
  5. ถ้ามี `milestoneId` — อัปเดต `payment_milestones` เป็น **PAID**  
  6. หลัง commit — โหลดงวดทั้งหมดแล้วเรียก **`syncPurchasePaymentClosure`** เพื่ออัปเดต `paymentStatus` / **COMPLETED** ตาม Step 2–3

### UI

- หน้า `/store/vendor-bills/[id]` เมื่อสถานะ **รอจ่ายเงิน (SUBMITTED)** และผู้ใช้มีสิทธิ์จ่าย (`canMarkPurchaseVendorBillPaid`):
  - เลือก **บัญชีธนาคาร** (ACTIVE)
  - เลือก **วิธีชำระ** (โอน/เงินสด/เช็ค/อื่น)
  - **วันที่รายการ cashbook**
  - ปุ่ม **ยืนยันจ่ายเงิน + ลง cashbook**
- เมื่อ **PAID** แล้ว แสดงการ์ดยืนยันเลขที่ cashbook

## เงื่อนไข / ข้อจำกัด

- ต้องมีสิทธิ์ **accounting** ตาม Firestore rules สำหรับ `cashbook_entries` และ `bank_accounts`
- ไม่สร้าง cashbook ซ้ำถ้ามี `cashbookEntryId` อยู่แล้ว
- ยอดหักบัญชีธนาคาร = `bill.billAmount ?? purchase.totalAmount`

## ยังไม่ทำ

- ผูกสลิป / เลขที่เช็ค
- ย้อนรายการ (void) แบบครบชุด
