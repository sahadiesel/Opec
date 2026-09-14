import type { JobMode } from './rbac';
import type { PositionRequirementKind } from './worker';

/** Domain types: mobilization (from master types.ts split). */

/** บรรทัดความครบเบิกต่อ mobilization + รายการในตำแหน่ง — เก็บใต้ `mobilizations/{id}/fulfillment_lines` */
export type RequirementFulfillmentLineStatus = 'PENDING' | 'PARTIAL' | 'ISSUED' | 'WAIVED' | 'RETURNED';

export interface MobilizationRequirementFulfillmentLine {
  id: string;
  kind: PositionRequirementKind;
  positionRequirementId: string;
  quantityRequired: number;
  quantityIssued: number;
  status: RequirementFulfillmentLineStatus;
  storeItemId?: string;
  lastIssueSlipId?: string;
  lastIssueNo?: string;
  waivedAt?: number;
  waivedBy?: string;
  returnedAt?: number;
  updatedAt: number;
  updatedBy?: string;
}

/** Deployment/Mobilization Status */
export type DeploymentStatus = 
  | 'DRAFT'               // ร่างรายการ
  | 'READINESS_CHECK'     // อยู่ระหว่างตรวจความพร้อม
  | 'CLIENT_SUBMITTED'    // ส่งรายชื่อให้ลูกค้าพิจารณา
  | 'CLIENT_APPROVED'     // ลูกค้าอนุมัติแล้ว
  | 'CONFIRMED'           // ยืนยันการมอบหมาย (Internal Manager Confirmation)
  | 'READY_TO_MOB'        // พร้อมเดินทาง
  | 'MOBILIZING'          // อยู่ระหว่างเดินทาง
  | 'ACTIVE'              // ปฏิบัติงาน (On-site)
  | 'DEMOBILIZED'         // จบภารกิจ/เดินทางกลับ
  | 'CLOSED';             // ปิดรายการ

export type ClientApprovalStatus = 
  | 'NOT_SUBMITTED'       // ยังไม่ส่งข้อมูล
  | 'PENDING'             // รอพิจารณา
  | 'APPROVED'            // อนุมัติ
  | 'REJECTED';           // ขอเปลี่ยนตัว/ไม่ผ่าน

export type WaveStatus = 
  | 'PLANNING'            // วางแผน
  | 'READY'               // พร้อมระดม (UI / legacy)
  | 'RECRUITING'          // สรรหา/มอบหมาย
  | 'MOBILIZING'          // ดำเนินการส่งตัว
  | 'DEMOBILIZING'        // กำลังถอนกำลัง
  | 'ACTIVE'              // กำลังดำเนินโครงการ
  | 'COMPLETED'           // จบโครงการ
  | 'CLOSED';             // ปิดโครงการและสรุปบัญชี

/** Mobilization workflow (mobilizations collection) — คู่กับ deploymentStatus */
export type MobilizationStatus =
  | 'PENDING'
  | 'READY_TO_MOBILIZE'
  | 'MOBILIZING'
  | 'ACTIVE'
  | 'DEMOBILIZED';

export type MobWorkflowVersion = 'legacy' | 'po_active_v2';

/**
 * ขั้นชีวิต “อยู่ที่ไซต์” ต่อรอบ mob — แยกจาก deploymentStatus เพื่อรองรับ finished_location แล้วเปิดรอบใหม่
 * ข้อมูลเก่า: ฟิลด์ว่าง → UI/logic เดิมยังใช้ timestamps / deploymentStatus ได้
 */

export type MobLocationPhase =
  | 'unset'
  /** เลือก/ยืนยันไซต์แล้ว แต่ยังไม่ถึงขั้นบันทึก working */
  | 'location_selected'
  /** กำลังปฏิบัติที่ไซต์ (มี working / auto daily ตามเฟสถัดไป) */
  | 'active_at_location'
  /** จบที่ไซต์นี้แล้ว — พร้อมเปิด mobCycleNumber ถัดไปหรือกลับคิว */
  | 'finished_location';

/**
 * ค่าคิดเงินวัน Pre-Mob / Mob แยกฝั่งวางบิลกับจ่ายลูกจ้าง
 * — ใช้เฉพาะคน/งานที่บันทึกในหน้า Mobilization
 */

export type MobDayChargeKind = 'STANDBY' | 'WORKING' | 'M1' | 'D1';

export interface MobDayChargeSpec {
  kind: MobDayChargeKind;
  /**
   * ชม.อ้างอิง — STANDBY/WORKING = ชม.คิดเงิน
   * M1/D1 = ชม.ที่ราคาในสัญญาอ้างอิง (มาตรฐาน OFF 12 / ON 8) และโชว์บนตารางรายวัน
   */
  hours?: number;
  /** ทับจำนวนเงิน M1/D1 จากตารางสัญญา (บาท) — ว่าง = ใช้ค่าสัญญา */
  m1AmountOverride?: number;
}

/**
 * ช่วงค่าแรงบน assignment หนึ่งรอบไซต์ — ปิดด้วย untilYmd ตอนจบงาน
 * (เก็บ 1800 ก่อน remob แม้ทะเบียนลูกจ้างจะถูกแก้เป็น 2600 ภายหลัง)
 */

export interface AssignmentLaborCostEpoch {
  /** รวมวันนี้ — วันหลัง untilYmd ใช้ epoch ถัดไปหรือทะเบียนปัจจุบัน */
  untilYmd: string;
  laborCostOffshore?: number;
  laborCostOnshore?: number;
  /** false = ใช้ custom ด้านบน; true/undefined ตามค่าที่จับตอนจบงาน */
  laborCostUsePositionDefault?: boolean;
  positionId?: string;
  capturedAt?: number;
}

/** ค่า mobilization ก่อนกดจบงานบน Wave Board — ใช้ยกเลิกจบงาน */

export interface MobFinishUndoSnapshot {
  deploymentStatus?: DeploymentStatus;
  mobilizationStatus?: string;
  mobCycleNumber?: number;
  mobCycleId?: string;
  mobStandbyDate?: string;
  mobStandbyDayEventType?: 'standby_day' | 'mobilization_day';
  mobStep2Choice?: 'PRE_MOB' | 'MOB';
  mobStep2BillingCharge?: MobDayChargeSpec;
  mobStep2PayrollCharge?: MobDayChargeSpec;
  mobStandbyRecordedAt?: number;
  mobStandbyRecordedByUserId?: string;
  mobMobSkipped?: boolean;
  mobPreMobDate?: string;
  mobPreMobSkipped?: boolean;
  mobPreMobRecordedAt?: number;
  mobPreMobRecordedByUserId?: string;
  mobWorkingStartDate?: string;
  mobWorkingStartedAt?: number;
  mobWorkingStartedByUserId?: string;
  mobReadyToTravelAt?: number;
  mobReadyToTravelByUserId?: string;
  mobReadyToTravelDate?: string;
  mobLocationPhase?: MobLocationPhase;
  /** ไซต์ก่อนจบงาน — คืนเมื่อยกเลิกจบงาน */
  mobLocationKey?: string;
  workLocation?: string;
  poActiveAutoWorkSuspended?: boolean;
  poActiveStandbyAutoStartYmd?: string;
  poActiveStandbyAutoEndYmd?: string;
}

export interface Assignment {
  id: string;
  assignmentNo: string;
  workerId: string;
  /** Denormalized for client portal — avoids extra worker doc read when assignedCustomerIds blocks profile */
  workerName?: string;
  waveId: string;
  /** ไม่บังคับ: ลิงก์ sales_contract_terms แบบเก่า — การมอบหมายใหม่ใช้ PO + contractId เป็นหลัก */
  salesContractTermId?: string;
  poId: string;
  poLineId: string;
  /**
   * Denormalized PO Active bundle (`customerId__ONSHORE|OFFSHORE`) — เฟส 1 PO workflow;
   * sync จาก `purchase_orders.poActiveBundleId` หรือคำนวณแบบเดียวกับ `resolvePoActiveBundleKeyForPo`
   */
  poActiveBundleId?: string;
  /**
   * รอบ mobilization ภายใต้ assignment เดิม (จบงานที่หนึ่งแล้วเริ่มรอบใหม่ → เพิ่มเลข).
   * Legacy / ข้อมูลเก่า = 1
   */
  mobCycleNumber?: number;
  /**
   * คีย์คงที่ต่อรอบ — รูปแบบแนะนำ `${assignmentId}_c${mobCycleNumber}` (ดู `buildMobCycleDocId`)
   * ใช้อ้างอิงร่วมกับ daily_timesheets เมื่อต้องแยกช่วงไซต์ลูกค้าเดียวกัน
   */
  mobCycleId?: string;
  /** ระบุว่า mobilization นี้อยู่ workflow รุ่นใด — ไม่มีฟิลด์ = legacy */
  mobWorkflowVersion?: MobWorkflowVersion;
  /**
   * คีย์ไซต์จากทะเบียน (หรือค่าที่ทีมนิยาม) — คนละอย่างกับข้อความ `workLocation`
   * เฟส 1 จะผูก dropdown เลือกไซต์ตอน mob
   */
  mobLocationKey?: string;
  /** สถานะไซต์ปัจจุบันต่อรอบ — optional เพื่อไม่ทับข้อมูลเก่า */
  mobLocationPhase?: MobLocationPhase;
  /** Final clearance ขั้น 1 — ยืนยันพร้อมเดินทาง */
  mobReadyToTravelAt?: number;
  mobReadyToTravelByUserId?: string;
  /** วันที่พร้อมเดินทางที่เลือก (YYYY-MM-DD, Asia/Bangkok) */
  mobReadyToTravelDate?: string;
  /**
   * Final clearance — วัน Pre-Mob (SB 8 ชม.) แยกจากวัน Mob
   * ว่าง + `mobPreMobSkipped` = ข้าม Pre-Mob
   */
  mobPreMobDate?: string;
  mobPreMobSkipped?: boolean;
  mobPreMobRecordedAt?: number;
  mobPreMobRecordedByUserId?: string;
  /** Final clearance — วัน Mob / Standby เดิม (YYYY-MM-DD) — ใช้เป็นฐานก่อนวันเริ่มงาน */
  mobStandbyDate?: string;
  /** ข้าม Mob — ไม่มีวัน M1 · ตารางเวลาเริ่มที่วันทำงานเลย */
  mobMobSkipped?: boolean;
  /** ประเภทวันที่บันทึก Mob/Standby — standby_day (legacy Pre-Mob) หรือ mobilization_day (Mob) */
  mobStandbyDayEventType?: 'standby_day' | 'mobilization_day';
  /**
   * ทางเลือกขั้น Pre-Mob/Mob
   * PRE_MOB = SB 8 ชม. · MOB = M1 ตามตารางสัญญา
   */
  mobStep2Choice?: 'PRE_MOB' | 'MOB';
  /** ค่าวางบิลลูกค้าสำหรับวัน Mob ของ assignment นี้เท่านั้น */
  mobStep2BillingCharge?: MobDayChargeSpec;
  /** ค่าจ่ายลูกจ้างสำหรับวัน Mob ของ assignment นี้เท่านั้น */
  mobStep2PayrollCharge?: MobDayChargeSpec;
  mobStandbyRecordedAt?: number;
  mobStandbyRecordedByUserId?: string;
  /** Final clearance ขั้น 3 — วันเริ่มนับ working / auto รายวัน */
  mobWorkingStartDate?: string;
  mobWorkingStartedAt?: number;
  mobWorkingStartedByUserId?: string;
  /** จบงานที่สถานที่หนึ่ง — หยุด auto รอบนี้; ยัง assigned PO เดิม → กลับคิว Mob */
  mobLocationEndDate?: string;
  mobLocationEndedAt?: number;
  mobLocationEndedByUserId?: string;
  /** snapshot ก่อนจบงานจาก Wave Board — ใช้ยกเลิกจบงานคืนสถานะ mobilization */
  mobFinishUndoSnapshot?: MobFinishUndoSnapshot;
  /**
   * Epoch ค่าแรงต่อรอบไซต์ — ปิดช่วงด้วย untilYmd ตอนกดจบงาน
   * วัน ≤ untilYmd ใช้แพ็ก/ตำแหน่งใน epoch (เช่น 1800 ก่อน remob)
   * วันหลัง untilYmd ล่าสุดใช้ทะเบียนปัจจุบัน (เช่น 2600 หลังเปลี่ยน Fitter Foreman)
   */
  laborCostEpochs?: AssignmentLaborCostEpoch[];
  /**
   * หยุดแบบ standby จาก Wave Board — หลังช่วง SB อัตโนมัติแล้วไม่สร้าง work_day จนกว่าจะเริ่มงานใหม่ที่ Mobilization
   */
  poActiveAutoWorkSuspended?: boolean;
  /** วันแรกของช่วง SB อัตโนมัติ (yyyy-mm-dd, Bangkok) */
  poActiveStandbyAutoStartYmd?: string;
  /** วันสุดท้ายของช่วง SB อัตโนมัติรวม 7 วัน (yyyy-mm-dd, Bangkok) */
  poActiveStandbyAutoEndYmd?: string;
  /** Unassign — คืนคนให้ไป assign PO Active ชุดอื่นได้ */
  unassignedAt?: number;
  unassignedByUserId?: string;
  /** Optional: copied from PO for downstream screens (e.g. mobilization) */
  contractId?: string;
  positionId: string;
  customerId: string;
  projectName: string;
  /** สถานี/ไซต์ปฏิบัติงาน — คัดลอกจาก PO line ตอน assign, แก้ได้ (เฟส D: ลูกค้าเดิมย้ายสถานที่) */
  workLocation?: string;
  workLocationUpdatedAt?: number;
  workLocationUpdatedByUserId?: string;
  /** วันที่มอบหมาย (yyyy-mm-dd, Asia/Bangkok) — แสดงเป็นหลัก; ช่วง standby/working ตั้งที่หน้า Mobilization */
  assignedDate?: string;
  startDate: string;
  endDate: string;
  /** สถานะขั้น mobilization (เอกสาร mobilizations) */
  mobilizationStatus?: MobilizationStatus | string;
  mobilizationDate?: string;
  deploymentStatus: DeploymentStatus;
  clientApprovalStatus: ClientApprovalStatus;
  readinessStatus: 'incomplete' | 'ready';
  workMode: JobMode;
  readinessSummary: {
    passportValid: ChecklistItemStatus;
    medicalValid: ChecklistItemStatus;
    certificatesComplete: ChecklistItemStatus;
    safetyTrainingComplete: ChecklistItemStatus;
    fitToWork: ChecklistItemStatus;
    ppeIssued: ChecklistItemStatus;
    toolsIssued: ChecklistItemStatus;
    overlapClear: ChecklistItemStatus;
    clientApproved: ChecklistItemStatus;
    /** ผลตรวจสารเสพติด — negative ครบแผง + valid ภายใน 10 วันหลังวันตรวจ (เช็คตอน mob) */
    drugTestValid?: ChecklistItemStatus;
  };
  clientComments?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  updatedBy?: string;
}

export type ChecklistItemStatus = 'pass' | 'fail' | 'warning' | 'missing';

/** โควต้าต่อบรรทัด PO ภายในเวฟเดียว (หลายตำแหน่งใน 1 เวฟ) */

export interface WaveLineAllocation {
  poLineId: string;
  plannedWorkers: number;
}

export interface Wave {
  id: string;
  waveCode: string;
  poId: string;
  poLineId: string;
  customerId: string;
  projectName: string;
  siteLocation: string;
  startDate: string;
  endDate: string;
  status: WaveStatus;
  plannedWorkers: number;
  assignedWorkers: number;
  rotationPattern: string;
  /** ถ้ามี: แตกโควต้าตาม PO line; ถ้าไม่มีใช้ poLineId + plannedWorkers แบบเดิม */
  lineAllocations?: WaveLineAllocation[];
  mobilizationDate?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

