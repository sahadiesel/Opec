# Firestore rules — ลำดับชุด 2–9 (หลังชุด 0 + ชุด 1)

เอกสารนี้เป็น **แผนปฏิบัติการ** สำหรับคุณ (UAT) + assistant (แก้ rules/แอป)  
ทำ **ทีละชุดตามลำดับ** จบชุดก่อนค่อยไปชุดถัดไป

**ทำแล้ว**

| ชุด | เนื้อหา |
|-----|---------|
| **0** | สเปก role (`assignedRoleKey`), client เข้ม, ไม่ priority จาก list, `operation`→`operations`, canonical ในแอป |
| **1** | Identity helpers, `users`, `permission_profiles`, `userReferencesProfileDocId`, self-reg ไม่มี `roleId` |

**แหล่งเทียบในโค้ด (ทุกชุด)**

- `src/lib/permissions.ts` — `ROLE_PERMISSION_MATRIX`, `canView` / `canEdit`, module keys
- `src/lib/permission-core.ts` — `getEffectiveAccessGroup`, `canAccessDomain`, `isSystemAdmin`, `getPrimaryLegacyRole`
- `src/lib/permission-payroll-matrix.ts` — เฉพาะชุดที่แตะ payroll

---

## ชุด 2 — Sales pillar

**ขอบเขต `firestore.rules`**

- Top-level: `customers`, `quotations`, `main_contracts`, `sales_contract_terms`, `purchase_orders`, `rate_conditions`, `profit_estimates`
- Subcollections: `customers/{id}/{document=**}`, `main_contracts/{id}/{document=**}`, `quotations/{id}/{document=**}`, `purchase_orders/{id}/{document=**}`

**Helpers หลังปรับ (implemented)**

- `canReadCustomers` / `canWriteCustomers` — สอดคล้อง `customers` column (ตัด `store_officer`, `accounting_officer` ออกจาก read; เขียนลูกค้าเฉพาะ sales/ops pillar + `hr_manager` + `accounting_manager` + admin)
- `canReadQuotationsInternal` / `canWriteQuotations` — `sales_manager` **ไม่** write quotation (matrix `quotations: P_NONE`); ops pillar + `hr_manager` + sales อื่น ๆ ยังเขียนได้
- `canReadCommercialDocuments` / `canWriteCommercialDocuments` — ใช้กับ `main_contracts`, `sales_contract_terms`, `rate_conditions`, `profit_estimates`, `purchase_orders` (โมดูล `customer_pos` ใน matrix)

**เป้าหมายชุดนี้**

- เลิกใช้ `internalRead()` แบบครอบคลุมทุก internal บน Sales collections (เดิมทำให้บทบาทที่ matrix ห้ามดูลูกค้า เช่น `store_officer` ยังอ่านได้)
- Client portal: `sameCustomerId` / `get`+`customerId` คงเดิม

**DoD (ปิดงานเมื่อ)**

- [x] แก้ `firestore.rules` ให้ใช้ helper ชุด Sales ด้านบน (top-level + sub ที่ระบุ)
- [ ] คุณ UAT: ทดสอบบทบาทหลัก — `store_officer` ไม่เปิด customers; `sales_manager` ไม่แก้ quotation; `hr_officer` อ่านแต่ไม่เขียนลูกค้า/สัญญา; `accounting_officer` อ่าน quotation ได้ถ้า matrix ให้ view; `accounting_manager` เขียน commercial ได้
- [ ] ถ้า UAT พบว่า matrix ผิดเจตนาธุรกิจ (เช่น sales_manager ควรมี quotation) แก้ที่ `ROLE_PERMISSION_MATRIX` แล้วค่อยปรับ rules ครั้งที่สอง

---

## ชุด 3 — Operations scheduling (คลื่น / ส่งตัว / มอบหมาย)

**ขอบเขต**

- `waves`, `mobilizations`, `assignments`, `worker_wave_acceptances`

**Helpers หลังปรับ (implemented)**

- `canReadOpsScheduling` — view ตาม matrix (ตัด `store_officer`; รวม payroll/accounting แบบ view)
- `canCreateOpsScheduling` — สร้างได้เมื่อ matrix `create` (ไม่รวม `payroll_officer`, `accounting_officer`)
- `canEditOpsScheduling` — แก้ไขเมื่อ matrix `edit` (รวม `sales_manager` + `operations_officer`; ไม่รวม payroll/accounting officer แบบ view-only)
- `canDeleteOpsScheduling` — ลบเฉพาะแถวที่ matrix ให้ `delete` (`operations_manager`, `hr_manager`, `accounting_manager` + admin; ไม่รวม officer/sales แบบ P_VCE / P_OFFICER_PILLAR)

**เป้าหมาย**

- เลิก `internalRead()` บนคอลเลกชันนี้ (เดิมทำให้ `store_officer` เห็นทุก wave)
- Client: `sameCustomerId(resource.data.customerId)` คงเดิม

**DoD**

- [x] แก้ `firestore.rules` ให้ create / update / แยกจาก delete ตาม matrix
- [ ] UAT: `store_officer` ไม่อ่าน wave/mobilization; `sales_manager` แก้ wave ได้แต่ลบไม่ได้; `payroll_officer` อ่านอย่างเดียว; `accounting_manager` ลบได้; client เห็นเฉพาะ `customerId` ตัวเอง

---

## ชุด 4 — HR master (คนงาน / ตำแหน่ง / office staff / catalog / labor cost terms)

**ขอบเขต**

- Top-level: `workers`, `positions`, `labor_cost_contract_terms`, `office_staff`, `worker_document_catalog`
- Subcollections: `workers/{id}/{document=**}`, `positions/{id}/{document=**}`

**Helpers หลังปรับ (implemented)**

- `canReadWorkers` / `canCreateWorkers` / `canEditWorkers` / `canDeleteWorkers` — `sales_manager` อ่านอย่างเดียว; `store_officer` ไม่อ่าน; ลบคนงาน: admin, `operations_manager`, `hr_manager`, `hr_officer` (ไม่รวม `operations_officer`)
- `canReadPositions` / create / edit / delete — `store_officer` อ่านได้; `sales_manager` สร้างตำแหน่งได้แต่ไม่แก้/ลบ; `accounting_officer` ไม่อ่าน; ลบ: admin + `operations_manager` + `hr_manager` เท่านั้น
- `labor_cost_contract_terms` — แยก create/update/delete ตาม matrix (`operations_officer` / `hr_officer` ไม่ลบ; `payroll_officer` / `accounting_officer` อ่านอย่างเดียว)
- `office_staff` — `sales_manager` / `store_officer` ไม่เข้า; ลบ: admin, `operations_manager`, `hr_manager`, `accounting_manager` (ไม่รวม officer / `hr_officer` แบบ P_VCE)
- `worker_document_catalog` — สอดคล้อง `worker_documents`: `sales_manager` และ `accounting_manager` ไม่มีสิทธิ์ใน matrix; `payroll_officer` อ่านอย่างเดียว; ลบ catalog: รวม `hr_officer`
- `number_sequences`: `worker` / `office_staff` / `position` / `cost_term` ใช้ helper สร้างที่สอดคล้อง (ตัด `payroll_officer` ออกจากการ bump เลข master ที่ไม่มีสิทธิ์สร้างเอกสาร)

**เป้าหมาย**

- เลิก `internalRead()` + `canManageHrMasterData()` แบบกว้างบนคอลเลกชัน HR master
- Client: `isClientUser()` ยังอ่าน `workers` / `positions` + sub ตามเดิม (แอปยัง query แบบเดิม)

**DoD**

- [x] แก้ `firestore.rules` top-level + sub + `number_sequences` ตามด้านบน
- [ ] UAT: ทดสอบบทบาทใน matrix (โดยเฉพาะ `sales_manager` กับ workers vs positions, `store_officer` กับ positions-only, `hr_officer` ลบ worker ได้แต่ลบ office_staff ไม่ได้)

---

## ชุด 5 — Payroll, timesheets, executive payroll, payment export

**ขอบเขต**

- `payroll_runs`, `payroll_batches` (+ `lines` + `{document=**}`), `payroll_periods`, `payroll_policies`, `payroll_correction_requests`
- `office_payroll_runs` (+ `lines` + `{document=**}`)
- `executive_payroll_runs` (+ `lines` + `{document=**}`)
- `payment_export_batches`, `daily_timesheets`, `exception_requests`

**Helpers หลังปรับ (implemented)**

- `canPreparePayroll` — รวม `hr_manager` + `hr_officer` (เดิมขาด → HR เตรียมงวด/แบทช์ไม่ได้ใน rules)
- `canApprovePayroll` — รวม `hr_manager` (เดิมมีแค่ `operations_manager` → HR manager อนุมัติงวดไม่ได้)
- `canReadWorkerPayrollStack` — อ่าน worker payroll tower; รวม `sales_manager`; **ไม่**รวม `store_officer`
- `canReadOfficePayrollRuns` — เฉพาะ HR pillar + payroll + accounting (matrix: sales/ops pillar `office_payroll` P_NONE)
- `canReadPaymentExportBatches` / `canWritePaymentExportBatches` — อ่านรวม accounting officer; **เขียน**ไม่รวม `accounting_officer` (matrix view-only), ไม่รวม `sales_manager`
- `canReadPayrollPolicies` — union อ่านที่เกี่ยว; **เขียน** `payroll_policies` เฉพาะ `canManageSystem()` (matrix: policy edit ห้าม hr_manager/ops persona)
- `canPrepareOfficePayrollRunDoc` — สร้าง/แก้ office run เมื่อยังไม่ล็อก (ไม่ใช้ `operations_manager` แม้เป็น preparer งานคนงาน)
- `canReadTimesheetsInternal` / `canCreateDailyTimesheet` / `canUpdateDailyTimesheet` — เลิก `internalRead()`; **ไม่**ให้ `payroll_officer` / accounting สร้าง-แก้ timesheet (matrix)
- `exception_requests` — อ่านตาม cohort timesheet; เขียนยัง `canAccessHR()`
- Executive subs — ใช้ `canManagePayrollFinancial() || canManageSystem()` ให้สอดคล้อง parent

**เป้าหมาย**

- Workflow prepare / approve / finance และสิทธิ์อ่านแยก collection ตาม `ROLE_PERMISSION_MATRIX` + `permission-payroll-matrix.ts`
- **ยังคง coarse**: แก้ `payroll_batches` ผ่าน `canManagePayrollFinancial()` (รวม accounting officer) — ถ้าต้องการแยก field-level ค่อยรอบถัดไป

**DoD**

- [x] แก้ `firestore.rules` ตาม helper ด้านบน + subcollections ที่ระบุ
- [ ] UAT: `sales_manager` เห็น worker payroll แต่ไม่ export; `operations_manager` เห็น worker payroll แต่ไม่สร้าง office run; `hr_officer` เตรียมแบทช์ได้; `hr_manager` อนุมัติได้; `accounting_officer` อ่าน export แต่ไม่เขียน; policy แก้ได้เฉพาะ system admin

---

## ชุด 6 — Store & procurement

**ขอบเขต**

- `vendors`, `purchases` (+ sub), `store_items`, `store_transactions`, `store_receipts`, `store_issue_slips`, `store_return_slips`, `store_writeoffs`

**Helpers หลังปรับ (implemented)**

- `canReadVendors` / `canCreateVendors` / `canEditVendors` / `canDeleteVendors` — `sales_manager` สร้างได้แต่ไม่แก้/ลบ; ตัด `hr_officer` / `payroll_officer` / `accounting_officer` ออกจากอ่าน; ลบ vendor: admin + `operations_manager` + `hr_manager` + `accounting_manager` (ไม่รวม officer / `store_officer` แบบ P_VCE)
- `canReadPurchases` / create / edit / delete — ไม่รวม `sales_manager` / `payroll_officer`; `accounting_officer` อ่านอย่างเดียว; ลบ: admin + `operations_manager` + `hr_manager` + `accounting_manager`
- `canReadStoreInventory` / create / edit / delete — ใช้กับคอลเลกชัน store ทั้งหมดด้านบน; ไม่รวม `sales_manager` / `payroll_officer`; `accounting_officer` อ่านอย่างเดียว; ลบ: admin + `store_officer` + `operations_manager` + `hr_manager` + `accounting_manager` (ไม่รวม `operations_officer` / `hr_officer`)
- `number_sequences`: `vendor` / `purchase` / `store_*` keys ผูกกับ `canCreateVendors` / `canCreatePurchases` / `canCreateStoreInventory` (แทน `canAccessStore()` แบบรวม)

**เป้าหมาย**

- เลิก `internalRead()` บน vendors/purchases และเลิก blanket `canAccessStore()` บน store collections

**DoD**

- [x] แก้ `firestore.rules` + `number_sequences` ตามด้านบน
- [ ] UAT: `payroll_officer` ไม่เปิด purchases/store; `accounting_officer` ดูได้แต่ไม่เขียน; `sales_manager` สร้าง vendor ได้แต่ไม่แก้; `store_officer` ลบสลิป/รายการคลังได้ตาม matrix

---

## ชุด 7 — Accounting (บิล ใบกำกับ ใบเสร็จ AR/AP ธนาคาร cashbook)

**ขอบเขต**

- Top-level: `billing_notes`, `tax_invoices`, `receipts` (+ `allocations`), `ap_bills`, `accounts_receivable`, `accounts_payable`, `bank_accounts`, `cashbook_entries`
- Subcollections: `billing_notes/**`, `tax_invoices/**`, `receipts/**`

**Helpers หลังปรับ (implemented)**

- `canReadAccountingInternal` — `isAdminUser()` หรือ (`isAccountingUser()` และไม่ใช่ `store_officer`) — เลิก `internalReadNonStoreOfficer()` บนคอลเลกชันนี้ (เดิมให้ทุก internal ที่ไม่ใช่คลังเห็นบัญชี)
- `canWriteAccountingDocs` — `isAdminUser()` หรือ (`isAccountingUser()` และ **ไม่**ใช่ `accounting_officer`) — รองรับผู้ใช้แผนกบัญชีแบบ legacy (มี `department`/`departmentGroup` accounting) ที่ไม่ใช่ officer; officer อ่านอย่างเดียว
- Client: `sameCustomerId(resource.data.customerId)` / `get(...).data.customerId` คงเดิมบน billing / tax_invoice / receipt / AR ที่มี `customerId`
- `number_sequences` คีย์ billing/tax/receipt/ap/ar/ap/cashbook/bank → `canWriteAccountingDocs()` (แทน `canAccessAccounting()` ที่เคยให้ officer เขียน)

**เป้าหมาย**

- อ่าน/เขียน accounting ตามกลุ่มบัญชี + ตัด store officer; เขียนไม่ให้ `accounting_officer`

**DoD**

- [x] แก้ `firestore.rules` top-level + sub + `number_sequences` ตามด้านบน
- [ ] UAT: `store_officer` / `operations_manager` ไม่อ่าน billing; `accounting_officer` อ่านแต่ไม่เขียน; `accounting_manager` (และ non-officer accounting dept) เขียนได้; client เห็นเฉพาะเอกสารของตัวเอง

---

## ชุด 8 — System (ลำดับเลข, bootstrap, roles_system_admin)

**ขอบเขต**

- `number_sequences`, `roles_system_admin`, `system/{docId}`

**หมายเหตุ**

- `permission_profiles` อยู่ชุด 1 แล้ว — ชุดนี้โฟกัส **sequence keys** และ bootstrap

**Helpers**

`canManageSystem()`, `isSignedIn()`, `canWriteCommercialDocuments()` สำหรับ `main_contract`, `canReadQuotationsInternal()` / `canReadWorkers()` สำหรับ `system/*` อ่านตาม doc

**เป้าหมาย**

- รายการ `id` ใน `number_sequences` ตรงกับผู้ที่ได้สร้างเลขในแอป (customer, wave, payroll_run, …)
- `system/bootstrap` สร้างได้เฉพาะเมื่อยังไม่มี doc
- `system/*` อ่านแคบตาม doc ที่แอปใช้ (ไม่ `isSignedIn()` ทั้ง collection)

**DoD**

- [x] ไล่ทุก sequence key ใน `SEQUENCE_REGISTRY` / `generateNextDocumentCode` ว่าตรงกับ rule (`main_contract` ↔ `canWriteCommercialDocuments()`)
- [x] `system/{docId}` read แยก `bootstrap` / `company_profile` / `drug_test_panel`
- [ ] UAT: สร้างเอกสารที่ต้อง gen เลขในหลายโมดูล; client อ่าน worker + drug panel; quotation อ่าน company_profile

---

## ชุด 9 — Collection groups + catch-all (ทำท้ายสุด)

**ขอบเขต**

- `match /{path=**}/po_lines/{lineId}` — read (เฉพาะ parent `purchase_orders/{poId}`)
- `match /{path=**}/position_rates/{rateId}` — read/write (เฉพาะ parent `main_contracts/{id}`)
- `match /{path=**}/lines/{lineId}` — read สำหรับ collection group `lines` บน payroll / office / executive runs
- `match /worker_payment_profiles/{id}` — top-level (เดิมตก catch-all)
- `store_*_slips` / `store_receipts` / `store_writeoffs` — subcollection `items` และ sub อื่น ใต้สลิป (`{document=**}`)
- `match /{document=**}` — **fallback admin-only** (อันตรายสูงถ้าแกะผิด)

**เป้าหมาย**

- ยืนยันว่าไม่มี collection ใหม่ที่ตกหล่นไปพึ่ง catch-all โดยไม่ตั้งใจ
- `po_lines` / `position_rates` / `lines` ตรง query ในแอป (รวม `collectionGroup`)

**สิ่งที่สแกน repo แล้ว (top-level ที่มี `match` เฉพาะใน rules)**

- มีแล้ว: `users`, `permission_profiles`, `customers`, `quotations`, `main_contracts`, `sales_contract_terms`, `purchase_orders`, `rate_conditions`, `profit_estimates`, `waves`, `mobilizations`, `assignments`, `worker_wave_acceptances`, `workers`, `positions`, `labor_cost_contract_terms`, `office_staff`, `worker_document_catalog`, `payroll_runs`, `payroll_batches`, `payroll_periods`, `payroll_policies`, `payroll_correction_requests`, `office_payroll_runs`, `executive_payroll_runs`, `payment_export_batches`, `daily_timesheets`, `exception_requests`, `vendors`, `purchases`, `store_*`, บัญชี, `number_sequences`, `system`, `roles_system_admin`, `audit_logs`, `approvals`, `client_portal`
- เพิ่มในชุดนี้: `worker_payment_profiles`

**Regression สั้น ๆ (หลัง deploy rules)**

- คลื่น / มอบหมาย: `collectionGroup('po_lines')` โหลดได้; `store_officer` ไม่ควรอ่านได้
- PO รายละเอียด: ลบ PO line; client เห็นเฉพาะ `customerId` ตัวเอง
- สัญญาหลัก: แก้ `position_rates`
- Worker / office payslip history: `collectionGroup('lines')` โหลดได้
- สร้างใบรับ/เบิก/คืน/ตัดจำหน่ายคลัง (มี sub `items`)
- เตรียม payroll ที่ดึง `worker_payment_profiles`

**DoD**

- [x] ค้น repo + เติม `match` ที่ขาด (`worker_payment_profiles`, store slip subs, collection group `lines`)
- [x] ปรับกลุ่ม collection group ให้ใช้ helper เดียวกับ pillar (ไม่ใช้ `internalRead()` ทั้งก้อน)
- [x] รายการ regression ด้านบน
- [ ] UAT: หน้าที่ใช้ PO lines / position rates / payslip history / สลิปคลัง / payroll prep

---

## ลำดับสรุป (ทำตามนี้)

| ลำดับ | ชุด | โฟกัส |
|-------|-----|--------|
| 1 | 0 | (เสร็จแล้ว) |
| 2 | 1 | (เสร็จแล้ว) |
| 3 | **2** | Sales + subs ที่เกี่ยว sales |
| 4 | **3** | Waves / mobilizations / assignments |
| 5 | **4** | HR master + worker/position subs |
| 6 | **5** | Payroll + timesheets + executive + export |
| 7 | **6** | Store + vendors + purchases |
| 8 | **7** | Accounting + AR/AP + banking |
| 9 | **8** | number_sequences + system + roles_system_admin |
| 10 | **9** | Collection groups + `/{document=**}` |

เมื่อเริ่มแต่ละชุด ให้บอกว่า **“เริ่มชุด N”** จะได้แก้เฉพาะบล็อกนั้นและอัปเดตไฟล์นี้ (เช่น ติ๊ก DoD) ตามความคืบหน้า
