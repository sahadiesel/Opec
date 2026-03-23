# User Auth Migration Guide

See `docs/permissions-architecture.md` for permission source of truth and primary fields.

## Overview

Migration helper สำหรับ normalize ข้อมูลสิทธิ์ผู้ใช้จาก legacy ไปสู่โครงสร้างใหม่ โดย**ไม่ลบข้อมูลเก่า**

## สเปกสิทธิ์ใหม่

| Group | Domains | หมายเหตุ |
|-------|---------|----------|
| **admin** | ทุกเมนู ทุก collection | รวม system management |
| **operation** | sales / operations / hr / store | store ย้ายมาอยู่ operation |
| **accounting** | sales / hr / accounting | ไม่มี store write |
| **client** | read only | เฉพาะ customerId ของตัวเอง |

## Mapping

| Legacy | Mapped To |
|--------|-----------|
| system_admin, super_admin, admin | admin_admin |
| hr_*, operations_*, sales_*, store_* | operation_officer หรือ operation_manager |
| finance_*, accounting_* | accounting_officer หรือ accounting_manager |
| client* | client_user |

## วิธีใช้งาน

1. **Dry Run ก่อน** — กด "Dry Run" เพื่อดูรายงานโดยไม่เขียน Firestore
2. **ตรวจสอบรายงาน** — ดู user ที่ needs_review หรือ conflict
3. **Apply Migration** — กด "Apply Migration" เมื่อมั่นใจแล้ว

## Baseline Profiles ที่สร้าง

- `admin_admin` — System Administrator
- `operation_officer` — เจ้าหน้าที่ปฏิบัติการ (รวม sales/hr/ops/store)
- `operation_manager` — ผู้จัดการปฏิบัติการ (รวม)
- `accounting_officer` — เจ้าหน้าที่ฝ่ายบัญชี
- `accounting_manager` — ผู้จัดการฝ่ายบัญชี
- `client_user` — ลูกค้า Portal

## Fields ที่เพิ่ม (ไม่ลบของเดิม)

- `departmentGroup` / `accessGroup`
- `accessLevel`
- `assignedRoleKey` / `assignedRoleKeys`
- `permissionProfileKey` / `permissionProfileKeys`
- `roleIds` (compatibility)

## needs_review

ผู้ใช้ที่ข้อมูลไม่ชัดจะถูก mark เป็น `migrationNeedsReview: true` แทนการเดาสุ่ม — ต้องตรวจมือ

## Setup Admin / Repair

หน้า setup-admin (Account Repair) ใช้ mapping ใหม่แล้ว และเพิ่มตัวเลือก operation_officer, operation_manager

## ข้อจำกัด

- รันได้เฉพาะ admin
- ไม่ลบ users หรือ legacy fields
- ไม่แก้ business records อื่น
- ไม่เปลี่ยน customer ownership
