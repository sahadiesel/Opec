# เฟส 0 — สเปกและเกณฑ์รับงาน (PO Active / Workflow)

เอกสารนี้เป็นฐาน sign-off ก่อนเริ่มเฟส 1–5 (ไม่รวมการแก้โค้ดในเฟส 0)

---

## 1. นิยามหลัก

### 1.1 PO Active หนึ่งชุด (bundle)

- **หนึ่งชุด** = **ลูกค้าเดียว (customerId)** + **ประเภทงานเดียว** ในความหมาย **Onshore หรือ Offshore** (ไม่ผสม on/off ในชุดเดียว)
- PO หลายใบที่ `status === active`, เป็นสายสัญญา (`poType === contract`), มีสัญญาหลักที่ยัง active และ **โหมดงาน (`poWorkMode`) เดียวกัน** → อยู่ **ชุดเดียวกัน**
- ลูกค้า A มีทั้ง on และ off → **อย่างน้อย 2 ชุด**  
- ลูกค้า A + B → **อย่างน้อย 2 ชุด** (ยังแยก on/off ต่อลูกค้าได้อีก)

**การอ้างอิงในระบบปัจจุบัน:** คอลเลกชัน `po_active_bundles`, id แบบ `{customerId}__{ONSHORE|OFFSHORE}`, ฟิลด์ `poIds[]`, และ `poActiveBundleId` บนแต่ละ PO

### 1.2 โควต้าและการเติมคนระหว่างเดือน

- **โควต้าว่าง** = ยังมอบหมายได้จนครบโควต้าที่สัญญา/บรรทัด PO กำหนด (ตามการคำนวณรวมในชุด)
- **ตัวอย่างที่ยืนยัน:** โควต้า 4 คน — ต้นเดือน mob ไป 2 คน → ลงเวลาได้ — **กลางเดือน assign + mob อีก 2** → เข้า timesheet ลงเวลาได้ตามปกติ

### 1.3 Location (ไซต์)

- **ระยะแรก:** มุมมองและการพิมพ์ **รวมในชุด PO Active เดียวกัน** (ไม่แยก filter location ในเฟสแรกของแผน)
- **อนาคต:** อาจเพิ่ม filter ตาม location และพิมพ์เอกสารตาม filter

### 1.4 การปิด PO (อ้างอิงจากที่คุยก่อนหน้า)

- ปิด PO กลางเดือน → **เดือนปัจจุบันยังสรุป timesheet ได้ตามช่วงที่ทำงานจริง** — **โควต้าเดือนถัดไปไม่มี** (รายละเอียดจังหวะหายจาก PO Active UI vs สิ้นเดือนปฏิทิน — ระบุในเฟสถัดไปเมื่อลง implementation)

---

## 2. ลำดับผู้ใช้งานที่ต้องการ (happy path)

1. มี **Customer PO** (active)
2. เข้าสู่ **PO Active / คิวเติมโควต้า** — เห็นชุดตามลูกค้า + on/offshore **ไม่แยกการ์ดทีละ PO** เมื่ออยู่ชุดเดียวกัน
3. **Assign** — เลือกชุด PO Active ก่อน (ถ้ามี N ชุด มี N รายการบนหน้าเข้า assign); มอบหมายตามโควต้าของชุดนั้น
4. **Mob** — ตามคนที่ assign ภายใต้ชุดเดียวกัน
5. **Timesheet** — ศูนย์ลงเวลา **จัดกลุ่มตามชุด PO Active** (N ชุด ≈ N กลุ่มที่มองเห็นชัด ไม่แตกเป็นหลาย PO ใต้ลูกค้าเดียวจนสับสน)
6. **สรุปรายเดือน / ส่งอนุมัติ** — โครงการแสดงผลและการส่งอนุมัติ (ลูกค้า/ผู้จัดการ) **สอดคล้องชุด PO Active**; คงปุ่มส่งและแนบเอกสารกระดาษตามระบบเดิม

---

## 3. เกณฑ์รับงานร่วมกัน (สำหรับเฟส 1–5)

ใช้เป็น checklist หลังแต่ละเฟส:

| ID | เกณฑ์ | หมายเหตุ |
|----|--------|----------|
| A1 | จากหน้า Customer PO ผู้ใช้ไปยัง PO Active / คิวโควต้าได้โดยไม่ถูกชี้ไป Waves/Assignments เป็นทางหลัก | เฟส 1 |
| A2 | คิวโควต้าแสดง **หนึ่งการ์ดต่อหนึ่ง bundle**; โควต้าและตำแหน่งเป็นการ **รวมทุก PO ในชุด** | เฟส 2 |
| A3 | **ปุ่ม Assign หลักหนึ่งปุ่มต่อหนึ่งชุด** (รายละเอียดตำแหน่งอาจขยาย/ย่อยได้) | เฟส 2 |
| A4 | Flow assign มีขั้นเห็น **รายการชุด PO Active** ก่อน drill-down | เฟส 3 |
| A5 | Hub timesheet จัดกลุ่มตาม **ชุด PO Active** ไม่ลิสต์แยกทุก PO เป็นหลัก | เฟส 4 |
| A6 | การส่งอนุมัติ/คิวที่เกี่ยวข้อง **ป้ายหรือ grouping** สะท้อนชุด PO Active | เฟส 5 |
| A7 | รองรับการเติม assign + mob กลางเดือนจนครบโควต้า (ข้อ 1.2) | ข้ามเฟส — ทดสอบหลังเฟส 2–4 |

---

## 4. สิ่งที่อยู่นอกขอบเขตเฟส 0

- การแก้โค้ดใดๆ (ยกเว้นเอกสารนี้)
- Filter location และพิมพ์ตาม filter (**เฟส 6 / อนาคต**)

---

## 5. แมปโครงสร้างข้อมูลจริงใน repo (สำหรับเฟส 1+)

อ้างอิง TypeScript หลัก: `src/lib/types.ts`  
**Timezone เป้าหมาย workflow:** `Asia/Bangkok` (ยังไม่บังคับทุกจุดในโค้ดปัจจุบัน — ระบุในเฟสที่แตะวันที่)

### 5.1 สาย PO Active → PO → สัญญา (มีอยู่แล้ว)

| แนวคิด | Firestore / ที่เก็บ | ชนิดในโค้ด |
|--------|---------------------|------------|
| PO Active (bundle) | `po_active_bundles` | `PoActiveBundle` — `customerId`, `workMode`, `poIds[]` |
| PO | `purchase_orders/{poId}` | `PurchaseOrder` — `contractId`, `customerId`, `poActiveBundleId?`, `poWorkMode?`, `status` |
| บรรทัด PO / โควต้า | `purchase_orders/{poId}/po_lines/{lineId}` | `POLine` — `quantity`, `positionId`, `workLocation?`, `status` |
| สัญญาหลัก (ขาย) | `main_contracts/{contractId}` | `MainContract` |

หมายเหตุ: `POLine` มีคอมเมนต์ว่าสถานที่แยกจาก site ของ Wave — เฟสใหม่จะอ้าง **บรรทัด PO / workLocation** เป็นหลัก ไม่ผูก Wave

### 5.2 Assignment + Mob (ปัจจุบันผูก Wave)

| แนวคิด | Firestore / ที่เก็บ | ชนิดในโค้ด |
|--------|---------------------|------------|
| มอบหมาย + หน้า Mob | **`mobilizations/{id}`** (ไม่มีคอลเลกชัน `assignments` แยก) | **`Assignment`** — doc เดียวกันทั้ง Assign และ Mobilization list |
| Wave (legacy) | `waves/{waveId}` | `Wave` — `Assignment.waveId` บังคับใน type ปัจจุบัน |
| สถานะ deployment UI | field บน mobilization | `deploymentStatus`: `DeploymentStatus` (เช่น `CONFIRMED`, `READY_TO_MOB`, `ACTIVE`, …) |
| สถานะ mobilization doc | `mobilizationStatus?` | `MobilizationStatus` (`PENDING` … `DEMOBILIZED`) — คู่กับ deployment |

ฟิลด์สำคัญบน `Assignment` ที่โครงการใหม่ต้องใช้ต่อ:  
`workerId`, `poId`, `poLineId`, `contractId?`, `positionId`, `customerId`, `workMode`, `workLocation?`, `startDate` / `endDate` (logic เฟสใหม่จะ **ไม่ใช้เป็นตัวเปิดสิทธิ์หลัก** — deprecate ทีละจุด), `deploymentStatus`, `readinessSummary`, ฯลฯ

**เฟส 0 (additive — มีใน `types.ts` + migration backfill `mobCycleId`)**

- **`mobCycleId`** — คีย์คงที่ต่อรอบ รูปแบบ `${mobilizationId}_c${mobCycleNumber}` (`buildMobCycleDocId`)
- **`mobWorkflowVersion`** — `'legacy' | 'po_active_v2'`; mobilization ใหม่จากหน้า Assign ตั้งเป็น `po_active_v2`
- **`mobLocationKey`** — คีย์ไซต์จากทะเบียน (ยังไม่บังคับตอน assign — UI เฟสถัดไป)
- **`mobLocationPhase`** — `'unset' | 'location_selected' | 'active_at_location' | 'finished_location'` (รองรับ finished_location แล้วเปิดรอบใหม่)
- **`daily_timesheets`**: เพิ่ม optional **`mobCycleId`**, **`mobLocationKey`** สำหรับ denormalize ในเฟสถัดไป

**สิ่งที่ยังไม่มีใน schema และต้องออกแบบในเฟส 1**

- **`poActiveBundleId`** บน mobilization — มีแล้วในโค้ด/migration เฟส 1 script
- **Mob cycle** — มี `mobCycleNumber` + `mobCycleId` (เฟส 0); subcollection `mob_cycles` ยังไม่บังคับ
- **Final clearance 3 ขั้น** — มีฟิลด์ timestamp/วันที่บน Assignment แล้ว (`mobReadyToTravelAt`, `mobStandbyDate`, …); UI/กฎละเอียดเฟส 1
- **`unassignedAt`** — มีแล้วบน Assignment

### 5.3 Worker สถานะระดับทะเบียน

| แนวคิด | ที่เก็บ | หมายเหตุ |
|--------|---------|----------|
| สถานะลูกจ้าง | `workers` — `Worker.status` | `WorkerStatus`: `AVAILABLE`, `ASSIGNED`, … — ต้องสอดคล้องกับกฎ “assign แล้วเลือก PO ชุดอื่นไม่ได้” (เฟส 2 rules + UI) |

### 5.4 Timesheet รายวัน / รายเดือน / หัวงวด PO–สถานที่

| แนวคิด | Firestore / ที่เก็บ | ชนิดในโค้ด |
|--------|---------------------|------------|
| รายวัน | `daily_timesheets` | `DailyTimesheet` — มี `waveId` (หรือค่า synthetic `po_ts_scope_{poId}` — ดู `src/lib/constants/timesheet-po-scope.ts`), `purchaseOrderId`, `poLineId`, `contractId`, **`poActiveBundleId?`**, `assignmentId`, `eventType` (`work_day`, `standby_day`, …), ชม./หน่วย |
| สรุป PO + เดือน (อนุมัติ/ล็อกงวด) | `po_month_timesheet_reviews` id = `poId_yyyy-MM` | `PoMonthTimesheetReview` — `status`, `periodStartDate`/`periodEndDate`, `relatedWaveIds?` (legacy) |
| แนบรูปก่อนส่งผู้จัดการ | `po_month_timesheet_photo_bundles` | `PoMonthTimesheetPhotoBundle` |
| หัวงวด PO + เดือน + **สถานที่** | `po_location_month_timesheets` | `PoLocationMonthTimesheet` — `locationKey`, `sourcePoLineIds?`; สร้างได้จาก `ensurePoLocationMonthShellsForPo` |
| เลขที่เอกสาร TS รายเดือน | `monthly_timesheet_documents` id = `yyyy-MM` | `MonthlyTimesheetDocument` |

**กฎที่ล็อกจาก stakeholder (ใช้ออกแบบเฟส 4–5):**

- แก้จาก **ตารางรายเดือน** → ต้อง **สะท้อนในการคำนวณ** และ **sync ลงรายวัน** (แก้รายเดือนชนะ auto)
- เดือนถัดไปดึงคนที่ **confirm mob** แล้ว; คน **unassign** แล้วไม่ขึ้น — แต่ในเดือนที่ unassign กลางเดือน **ชื่อค้างจนปิดงวด** (`PoMonthTimesheetReview` / shell ที่เกี่ยว)

### 5.5 Wave-month (legacy)

- คอลเลกชัน: `wave_month_timesheet_reviews`, `wave_month_timesheet_photo_bundles` — คู่กับ `WaveMonthTimesheetReview` ใน `types.ts`; หน้า `timesheets/wave-month` และ hub ที่ยังอ้าง wave  
- **เป้าหมายผลิตภัณฑ์:** hub หลักและ flow ใหม่ผูก **PO month + PO Active** ไม่ใช้ Wave เป็นแกนหลัก

### 5.6 Checklist สำหรับเริ่มเฟส 1 (migration / schema)

**สคริปต์รัน migration (Admin SDK):**

```bash
npm run migrate:po-active-phase1 -- --dry-run
npm run migrate:po-active-phase1
```

รายละเอียด: `scripts/po-active-workflow-phase1-migration.ts` — backfill `poActiveBundleId` + `mobCycleNumber` บน `mobilizations`, sync `poActiveBundleId` บน `daily_timesheets`  
หลัง merge index ใหม่: `npm run deploy:indexes` (หรือ deploy firestore ตามกระบวนการทีม)

1. ตัดหรือแมป `waveId` บน `mobilizations` และ `daily_timesheets` → **`poActiveBundleId` + po context** (คง `po_ts_scope_*` ชั่วคราวได้ถ้าต้องการความเข้ากันได้ย้อนหลัง) — **ทำบางส่วนแล้วด้วยสคริปต์ + assign ใหม่**
2. Backfill `poActiveBundleId` บน mobilization จาก `purchase_orders.poActiveBundleId`
3. เพิ่มโครง **mob cycle** + **3 ปุ่ม final clearance** + **จบงาน / unassign** ตามนิยามในแชท
4. นิยาม index/query ใหม่สำหรับ “คนที่ยัง assigned กับ bundle นี้” และ “พร้อมขึ้น timesheet เดือนใหม่เฉพาะ CONFIRM mob”
5. เอกสาร Po month ที่อ้าง `relatedWaveIds` — แผนลดการพึ่งพาหรือ derive จาก assignment/mob

---

## 6. Sign-off

| บทบาท | ชื่อ | วันที่ | หมายเหตุ |
|--------|------|--------|----------|
| เจ้าของธุรกิจ / ผู้อนุมัติ | พี่โจ้ | | |
| Product / Ops | | | |

เมื่อ sign-off แล้ว → เริ่ม **เฟส 1** ตามแผนแยกเฟสที่แจ้งไว้
