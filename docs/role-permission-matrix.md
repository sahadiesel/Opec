# Role & Permission Matrix

Generated from `getPermissions()` in `src/lib/permissions.ts`.
Re-run: `npx tsx scripts/generate-role-permission-matrix.ts`

> **Role** = `users.assignedRoleKey` only (admin assigns one business role).
> **Permission** = derived at runtime; do not store per-module flags on the user doc.

| Code | Meaning |
|------|--------|
| — | no access |
| V | view |
| C | create |
| E | edit |
| D | delete |
| A | approve |
| VCEDA | full (all five) |


## Roles (canonical)

| assignedRoleKey | ชื่อไทย | accessGroup | accessLevel |
|-----------------|--------|-------------|-------------|
| `system_admin` | ผู้ดูแลระบบสูงสุด | admin | admin |
| `hr_manager` | ผู้จัดการฝ่ายบุคคล | operations | manager |
| `hr_officer` | เจ้าหน้าที่ฝ่ายบุคคล | operations | officer |
| `payroll_officer` | เจ้าหน้าที่เงินเดือน | operations | officer |
| `sales_manager` | ผู้จัดการฝ่ายขาย | operations | manager |
| `sales_officer` | เจ้าหน้าที่ฝ่ายขาย | operations | officer |
| `store_officer` | เจ้าหน้าที่คลังสินค้า | operations | officer |
| `operations_manager` | ผู้จัดการปฏิบัติการ | operations | manager |
| `operations_officer` | เจ้าหน้าที่ปฏิบัติการ | operations | officer |
| `timekeeper` | เจ้าหน้าที่บันทึกเวลา | operations | officer |
| `accounting_manager` | ผู้จัดการฝ่ายบัญชี | accounting | manager |
| `accounting_officer` | เจ้าหน้าที่ฝ่ายบัญชี | accounting | officer |
| `client_user` | ลูกค้า / ผู้ใช้งานภายนอก | client | viewer |
| `employee_self` | พนักงาน / ลูกจ้าง (พอร์ทัลโปรไฟล์) | operations | viewer |
| `executive` | ผู้บริหาร (ดูอย่างเดียว) | admin | viewer |

## Module permissions by role

| Module | `system_admin` | `hr_manager` | `hr_officer` | `payroll_officer` | `sales_manager` | `sales_officer` | `store_officer` | `operations_manager` | `operations_officer` | `timekeeper` | `accounting_manager` | `accounting_officer` | `client_user` | `employee_self` | `executive` |
|--------|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `overview_dashboard` — แดชบอร์ดหลัก | VCEDA | VCEDA | VCEDA | V | VCEDA | VCEDA | V | VCEDA | V | V | VCEDA | VCEDA | — | — | V |
| `customers` — ทะเบียนลูกค้า | VCEDA | VCEDA | V | — | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | VCED | — | — | V |
| `main_contracts` — สัญญาหลัก | VCEDA | VCEDA | V | — | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | VC | V | — | V |
| `customer_pos` — ใบสั่งซื้อลูกค้า | VCEDA | VCEDA | V | — | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | VC | V | — | V |
| `quotations` — ใบเสนอราคา | VCEDA | VCEDA | — | — | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | VC | V | — | V |
| `sales_contract_terms` — เงื่อนไขการขาย | VCEDA | VCEDA | — | — | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | — | — | — | V |
| `rate_conditions` — กฎการคำนวณราคา | VCEDA | VCEDA | — | — | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | — | — | — | V |
| `profit_estimates` — ประมาณการกำไร | VCEDA | VCEDA | — | — | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | — | — | — | V |
| `hr_hub` — ศูนย์กลาง HR | VCEDA | VCEDA | VCEDA | V | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | — | — | — | V |
| `timesheets` — ลงเวลาทำงาน | VCEDA | VCEDA | VCE | VCE | VCEDA | VCEDA | — | VCEDA | VCEDA | VCEDA | VCEDA | — | V | — | V |
| `worker_payroll` — จ่ายเงินคนงาน | VCEDA | VCEDA | — | VCE | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | VCED | — | — | V |
| `payroll_runs` — รอบจ่ายคนงาน | VCEDA | VCEDA | — | VCE | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | — | — | — | V |
| `payslips` — สลิปเงินเดือนคนงาน | VCEDA | VCEDA | — | VCE | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | — | — | — | V |
| `office_payroll` — เงินเดือนออฟฟิศ | VCEDA | VCEDA | — | VCE | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | VCED | — | — | V |
| `payment_export_batches` — ไฟล์โอนเงินธนาคาร | VCEDA | VCEDA | — | VCE | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | — | — | — | V |
| `labor_cost_contract_terms` — เงื่อนไขต้นทุน | VCEDA | VCEDA | VCEDA | V | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | — | — | — | V |
| `positions` — ตำแหน่งงาน | VCEDA | VCEDA | VCEDA | V | VCEDA | VCEDA | — | VCEDA | VCEA | V | VCEDA | — | — | — | V |
| `workers` — ทะเบียนคนงาน | VCEDA | VCEDA | VCE | VCEA | VCEDA | VCEDA | — | VCEDA | VCEA | V | VCEDA | — | V | — | V |
| `worker_documents` — เอกสารบุคลากรกลาง | VCEDA | VCEDA | VCE | VCE | VCEDA | VCEDA | — | VCEDA | V | V | VCEDA | — | — | — | V |
| `office_staff` — พนักงานออฟฟิศ | VCEDA | VCEDA | — | VCE | VCEDA | VCEDA | — | VCEDA | — | — | VCEDA | — | — | — | V |
| `cash_advances` — เบิกเงินล่วงหน้า | VCEDA | VCEDA | — | VCEDA | — | — | — | VCEDA | — | — | VCEDA | V | — | VC | V |
| `employee_self_profile` — โปรไฟล์ของฉัน | VCEDA | VCE | VCE | VCE | VCE | VCE | VCE | VCE | VCE | VCE | VCE | VCE | — | VCE | V |
| `waves` — กลุ่มรอบการทำงาน | VCEDA | VCEDA | VCEDA | — | VCEDA | VCEDA | — | VCEDA | VCEDA | — | VCEDA | VCEA | — | — | V |
| `assignments` — การมอบหมายงาน | VCEDA | VCEDA | VCEDA | — | VCEDA | VCEDA | — | VCEDA | VCEDA | — | VCEDA | VCEA | — | — | V |
| `mobilization` — การเตรียมส่งตัว | VCEDA | VCEDA | VCEDA | — | VCEDA | VCEDA | — | VCEDA | VCEDA | — | VCEDA | VCEA | — | — | V |
| `draft_invoices` — รายการใบแจ้งหนี้ — เรียกเก็บลูกค้า | VCEDA | VCEDA | — | — | V | — | — | VCEDA | — | — | VCEDA | VCEA | — | — | V |
| `operations_petty_cash` — Petty Cash — เบิกจ่ายหน้างาน | VCEDA | — | — | — | — | — | — | VCEDA | — | — | — | — | — | — | V |
| `vendors` — คู่ค้า/ผู้ขาย | VCEDA | VCEDA | VCEDA | — | VCEDA | VCEDA | VCEDA | VCEDA | — | — | VCEDA | VCEDA | — | — | V |
| `purchases` — ใบสั่งซื้อ | VCEDA | VCEDA | VCEDA | — | VCEDA | VCEDA | VCEDA | VCEDA | — | — | VCEDA | VCEDA | — | — | V |
| `store_inventory` — คลังอุปกรณ์ | VCEDA | VCEDA | VCEDA | — | VCEDA | VCEDA | VCEDA | VCEDA | VCEDA | — | VCEDA | VCEDA | — | — | V |
| `accounting_dashboard` — แดชบอร์ดบัญชี | VCEDA | — | — | — | — | — | — | — | — | — | VCEDA | VCEDA | — | — | V |
| `billing_notes` — ใบวางบิลลูกหนี้ | VCEDA | — | — | — | — | — | — | — | — | — | VCEDA | VCED | — | — | V |
| `tax_invoices` — ใบกำกับภาษี | VCEDA | VE | VE | VE | VE | VE | VE | VE | — | — | VCEDA | VCED | — | — | V |
| `receipts` — ใบเสร็จรับเงิน | VCEDA | — | — | — | — | — | — | — | — | — | VCEDA | VCED | — | — | V |
| `ap_bills` — รับวางบิลเจ้าหนี้ | VCEDA | — | — | — | — | — | — | — | — | — | VCEDA | VCED | — | — | V |
| `accounts_receivable` — ลูกหนี้การค้า | VCEDA | — | — | — | — | — | — | — | — | — | VCEDA | VCED | — | — | V |
| `accounts_payable` — เจ้าหนี้การค้า | VCEDA | — | — | — | — | — | — | — | — | — | VCEDA | VCED | — | — | V |
| `withholding_tax_items` — รายการหัก ณ ที่จ่าย | VCEDA | — | — | — | — | — | — | — | — | — | VCEDA | VCED | — | — | V |
| `cashbook` — รายรับรายจ่าย | VCEDA | — | — | — | — | — | — | — | — | — | VCEDA | — | — | — | V |
| `bank_accounts` — บัญชีธนาคาร | VCEDA | — | — | — | — | — | — | — | — | — | VCEDA | — | — | — | V |
| `executive_payroll` — เงินเดือนผู้บริหาร | VCEDA | — | — | — | — | — | — | — | — | — | VCEDA | — | — | — | V |
| `system_admin` — จัดการผู้ใช้/ระบบ | VCEDA | — | — | — | — | — | — | — | — | — | — | — | — | — | V |
| `client_portal` — Client Portal | VCEDA | — | — | — | — | — | — | — | — | — | — | — | V | — | V |
| `document_numbering` — รันเลขที่เอกสาร | VCEDA | — | — | — | — | — | — | — | — | — | — | — | — | — | V |
| `audit_logs` — ประวัติกิจกรรม | VCEDA | — | — | — | — | — | — | — | — | — | — | — | — | — | V |

## Firestore capabilities (target model)

Rules should map collections to these predicates — not duplicate UI module names.

| Capability | Roles / condition |
|------------|-------------------|
| `isSystemAdmin` | `system_admin` |
| `isAccounting` | `accounting_manager`, `accounting_officer` |
| `isInternalStaff` | any internal `userType`, ACTIVE or staff-doc read paths |
| `isPettyCashSite` | `operations_manager` (+ ops manager partition) |
| `canBankCashbook` | accounting + petty site + payroll readers where needed |
| `isClientPortal` | `client_user` scoped by `customerId` |
| `isPayrollPrivileged` | `payroll_officer`, `hr_manager`, `operations_manager` |

## Legacy fields (do not use on new writes)

Remove on save via `buildUserAuthFirestoreUpdate`: `permissionProfileKey`, `permissionProfileKeys`,
`roleId`, `roleIds`, `assignedRoleKeys`, `role`, `department`, `level`, `departmentGroup`.
