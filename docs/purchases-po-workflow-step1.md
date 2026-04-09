# Step 1 — จัดระเบียบสถานะ PO จัดซื้อ (`purchases`)

อ้างอิง Step 0: [purchases-po-workflow-step0.md](./purchases-po-workflow-step0.md)

## สิ่งที่ทำในรอบนี้

### 1. ลบเส้นทาง legacy บนหน้ารายละเอียด

- ไม่มีปุ่ม **ยืนยันรายการซื้อ (แบบเดิม)** จาก `DRAFT` → `ISSUED` โดยข้ามอนุมัติ
- ไม่มีปุ่ม **ปิดรายการ (Completed)** แบบตั้ง `COMPLETED` ด้วยมือ — สอดคล้องนิยาม Step 0 ว่า **ปิด PO = จ่ายเงินครบ** (จะผูกอัตโนมัติในรอบถัดไป)

### 2. ขั้น ISSUED อย่างเป็นทางการ

- จาก `APPROVED` ผู้มีสิทธิ์แก้ไข purchases กด **ยืนยันส่ง PO ให้คู่ค้าแล้ว** → `ISSUED`
- บันทึก `issuedAt`, `issuedByUid`, `issuedByName` ในเอกสาร `Purchase` (`src/lib/types.ts`)

### 3. พิมพ์เอกสาร

- แสดงปุ่มพิมพ์เมื่อสถานะเป็น `APPROVED` | `ISSUED` | `COMPLETED` **และ** มีหลักฐานอนุมัติหรือขั้นส่งคู่ค้าตามปกติ:
  - `approvalDecidedAt != null` **หรือ** `issuedAt != null`
- เอกสารเก่าที่เคย `ISSUED`/`COMPLETED` โดยไม่อนุมัติและไม่มีฟิลด์เหล่านี้ → **พิมพ์ไม่ได้** (สอดคล้อง “ไม่อนุมัติไม่พิมพ์”)

### 4. ข้อความในแผงการดำเนินการ

- `ISSUED` / `COMPLETED`: อธิบายว่าการปิดเต็มรูปแบบจะมาจากการจ่ายครบในรอบพัฒนาถัดไป

## แผนภาพสถานะหลัง Step 1 (เชิงปฏิบัติการ)

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> PENDING_APPROVAL: ส่งขออนุมัติ
  PENDING_APPROVAL --> APPROVED: ผจก.อนุมัติ
  PENDING_APPROVAL --> REJECTED: ไม่อนุมัติ
  PENDING_APPROVAL --> RETURNED_FOR_REVISION: ส่งกลับแก้
  RETURNED_FOR_REVISION --> PENDING_APPROVAL: ส่งใหม่
  APPROVED --> ISSUED: ยืนยันส่ง PO ให้คู่ค้า
  note right of COMPLETED: COMPLETED ตั้งโดยระบบเมื่อจ่ายครบ (ยังไม่ implement)
```

## Step ถัดไป

- **Step 2–3 (ทำแล้ว):** [purchases-po-workflow-step2-3.md](./purchases-po-workflow-step2-3.md)
- (แยก requirement) ผูกรับของกับปิด PO; ผูก cashbook / vendor bills
