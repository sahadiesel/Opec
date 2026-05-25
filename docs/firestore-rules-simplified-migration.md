# Firestore Rules — Simplified (Matrix-driven) Migration

> **เป้าหมาย**: ลดความซับซ้อน `firestore.rules` จาก 99.4 KB / 2155 บรรทัด / 156 helpers
> → 84.8 KB ที่อ่านง่าย, auto-generate ได้, และ deploy ผ่านได้ง่ายขึ้น

---

## โครงสร้างใหม่

```
firestore.rules.simplified.draft  (84.8 KB)
├── rules_version + service wrapper
├── Core helpers (~10 functions) — isInternalUser, isAdmin, userRole(), ฯลฯ
├── PRESERVED HELPERS (~84 functions) — ดึงจาก firestore.rules เดิม
│   ใช้โดย match block ที่ต้อง preserve business logic
├── MATRIX-DERIVED GATES — auto-generated จาก /system-admin/menu-permissions
│   45 modules × (1 canFullX() หรือ 5 per-cap functions)
├── MATCH BLOCKS (matrix-gated) — 74 collections ที่ใช้ gate ตรงๆ
└── PRESERVED ORIGINAL LOGIC — 18 collections ที่ต้อง preserve
    เช่น users, audit_logs, system, client_portal, commercial_invoices,
    purchase_orders, workers, daily_timesheets, withholding_certificates ฯลฯ
```

---

## คำสั่งสำคัญ

```bash
# 1. Generate ไฟล์ใหม่จาก matrix baseline (เริ่มต้นทุกครั้ง)
npm run generate:rules-simplified
# → firestore.rules.simplified.draft (45.5 KB, มี 18 placeholders)

# 2. Merge preserved blocks + dependencies จาก firestore.rules เดิม
npm run rules:merge-preserved
# → ไฟล์เดิม +84 helpers + 18 match blocks (84.8 KB พร้อม deploy)
```

ทั้งสองคำสั่งทำตามลำดับครั้งเดียวก็เสร็จ:

```bash
npm run generate:rules-simplified ; npm run rules:merge-preserved
```

---

## ขั้นตอน Migration (ปลอดภัย)

### 1. ตรวจไฟล์ที่ generate

```bash
npm run generate:rules-simplified
npm run rules:merge-preserved
```

ผลลัพธ์ควรเป็น:
- `Match blocks   : success=18 fail=0`
- `Helpers pulled : 84 (recursive)`
- `✅ ไม่มี helper functions ที่ขาด`
- `✅ Brace balance: สมดุล`

### 2. Test ใน Emulator (ไม่ต้อง 503)

```bash
npx firebase emulators:start --only firestore
# ถ้า rules compile ผิด — emulator จะแจ้ง error ทันที
```

ถ้า emulator เริ่มได้ปกติ = rules ถูกต้อง syntactically

### 3. Backup + Swap

```bash
# Backup ไฟล์เดิมไว้ก่อน
Copy-Item firestore.rules firestore.rules.before-simplify.bak

# Swap
Move-Item firestore.rules.simplified.draft firestore.rules -Force
```

### 4. Deploy

```bash
npm run deploy:rules
# ถ้า 503 — retry 1-2 ครั้ง
```

### 5. Verify in production

- ทดสอบ login admin → เปิดเมนู Admin/Accounting/HR
- ทดสอบ portal user → ดูข้อมูลของตนเอง
- ทดสอบ payroll/petty cash flow
- ถ้ามี regression → revert: `Copy-Item firestore.rules.before-simplify.bak firestore.rules ; npm run deploy:rules`

---

## ทำไมยังขนาด ~85 KB ไม่ได้ลงเหลือ 30-40 KB?

- **PRESERVED HELPERS (~37 KB)**: 84 functions ที่ preserved match blocks ใช้
  (portal scope, status guard, payroll validation, attendance logic, ฯลฯ)
  — ลดต่อได้แค่ใน-line สำหรับ single-use helpers (มี ~20 ตัว) → ลดเพิ่มได้อีก ~3-5 KB
- **MATRIX GATES (~10 KB)**: 45 modules × predicate — แทบ optimize ต่อไม่ได้
- **PRESERVED MATCH BLOCKS (~25 KB)**: 18 collections มี business logic ซับซ้อน
  ถ้าจะลด ต้อง refactor business rule (เช่น ย้าย status guard ไป cloud function)

**สรุป**: ลดได้ ~15% โดยไม่กระทบ business logic
ถ้าจะลดอีก 30-40% ต้องเปลี่ยน architecture (cloud functions intercept writes)

---

## ทุกครั้งที่ admin แก้ matrix ใน UI

1. ใน `/system-admin/menu-permissions` → Export JSON
2. บันทึก `overrides.json`
3. Regenerate rules + merge:
   ```bash
   npm run generate:rules-simplified -- --overrides=overrides.json
   npm run rules:merge-preserved
   ```
4. Test ใน emulator → swap + deploy

---

## Architecture (ทำไม split เป็น 2 steps?)

```
+-------------------+      +-----------------------+      +------------------+
| Matrix (UI/JSON)  |  →   | Generator             |  →   | draft (45.5 KB) |
| /system-admin/    |      | (matrix → gates +     |      | 18 placeholders  |
|  menu-permissions |      |  simple match blocks) |      | + matrix gates   |
+-------------------+      +-----------------------+      +------------------+
                                                                  ↓
                                         +--------------------------------+
                                         | Preserved Extractor            |
                                         | (ดึง match block + helper      |
                                         |  dependencies จาก rules เดิม)  |
                                         +--------------------------------+
                                                                  ↓
                                         +--------------------------------+
                                         | Final draft (84.8 KB)          |
                                         | ✅ no missing helpers          |
                                         | ✅ brace balanced              |
                                         | → emulator test → deploy      |
                                         +--------------------------------+
```

**ข้อดี**:
- Matrix UI กับ Firestore rules sync ทันที (single source of truth)
- Preserved business logic ไม่หาย (extractor หยิบมาให้)
- Auditable — diff `firestore.rules.simplified.draft` vs `firestore.rules` ตรวจได้ก่อน deploy
- Idempotent — generate ใหม่ได้ทุกครั้ง

**ข้อจำกัด**:
- Preserved blocks ยังต้องอ้าง helper จาก firestore.rules เดิม (ดึงอัตโนมัติ แต่ผูกอยู่)
- ถ้าลบ collection จาก `MODULE_FIRESTORE_SPECS` → match block หาย ต้องระวัง
- Generator ยังไม่ครอบคลุม 100% ของ collections (ปัจจุบัน 74/109)
  collections ที่หายไปคือพวกที่ไม่อยู่ใน `module-to-firestore-paths.ts`
  → ถ้าต้องการครอบคลุม → เพิ่ม spec ใหม่
