import type { JobMode } from './rbac';

/** Domain types: contracts (from master types.ts split). */

export type BillingStatus = 
  | 'DRAFT'               // ฉบับร่าง
  | 'ISSUED'              // ออกเอกสารแล้ว
  | 'SUBMITTED'           // ส่งลูกค้าแล้ว
  | 'PARTIALLY_PAID'      // ชำระบางส่วน
  | 'PAID'                // ชำระครบถ้วน
  | 'OVERDUE'             // เกินกำหนดชำระ
  | 'CANCELLED';          // ยกเลิก

export interface Customer {
  id: string;
  customerCode: string;
  name: string;
  taxId: string;
  branchType?: 'head_office' | 'branch';
  branchNo?: string;
  registeredAddress: string;
  billingAddress: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  creditTerms?: string;
  billingTerms?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContactPerson {
  id: string;
  name: string;
  department: string;
  role: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  /** Optional contract-scoped contact. Empty means customer-level shared contact. */
  contractId?: string;
  notes?: string;
}

/** Mob/demob embarkation point — column headers on contract rate sheet. */

export interface ContractMobDemobLocation {
  /** Stable key for `mobDemobRoundTrip` lookups (e.g. `songkhla`). */
  key: string;
  label: string;
  displayOrder: number;
}

/** Offshore rate bundle per position (working / standby / OT / trips / mob). */

export interface PositionRateOffshoreSide {
  /** Working day (12 hr) — mirrors legacy `sellRateOffshore` / cost offshore daily. */
  workingDay?: number;
  standbyDay?: number;
  /** OT ×1.5 ต่อชม. (ช่อง OT 1.5 / ชม.) */
  otPerHour?: number;
  ot2PerHour?: number;
  ot3PerHour?: number;
  /** M1 และ D1 ใช้ราคาขายเดียวกัน — UI รวมเป็นช่องเดียว แต่เก็บทั้งสองฟิลด์ */
  m1PerTrip?: number;
  d1PerTrip?: number;
  /** ตัวหารชม.ปกติจากราคารายวัน สำหรับคำนวณ OT (12 หรือ 14) — ค่าเริ่มต้น 14 */
  hourlyDivisor?: 12 | 14;
  /** Round-trip mob/demob per `ContractMobDemobLocation.key`. */
  mobDemobRoundTrip?: Record<string, number>;
}

/** Onshore rate bundle per position. */

export interface PositionRateOnshoreSide {
  /** Working day (8 hr) — mirrors legacy `sellRateOnshore` / cost onshore daily. */
  workingDay?: number;
  standbyDay?: number;
  otNormalPerHour?: number;
  ot2PerHour?: number;
  ot3PerHour?: number;
}

/** Onshore + offshore sides for sell or cost. */

export interface PositionRateWorkModeBundle {
  offshore?: PositionRateOffshoreSide;
  onshore?: PositionRateOnshoreSide;
}

/** Extended rate sheet per position (sell + cost). */

export interface PositionRateMatrix {
  sell?: PositionRateWorkModeBundle;
  cost?: PositionRateWorkModeBundle;
}

export type PositionRateMatrixCategory =
  | 'offshore_working_day'
  | 'offshore_standby_day'
  | 'offshore_ot_per_hour'
  | 'offshore_ot2_per_hour'
  | 'offshore_ot3_per_hour'
  | 'offshore_m1_per_trip'
  | 'offshore_d1_per_trip'
  | 'offshore_mob_demob_round_trip'
  | 'onshore_working_day'
  | 'onshore_standby_day'
  | 'onshore_ot_normal_per_hour'
  | 'onshore_ot2_per_hour'
  | 'onshore_ot3_per_hour';

export type ContractBillingMode = 'MONTHLY' | 'TRIP';

export type MobCycleBillingReviewStatus =
  | 'open'
  | 'pending_billing'
  | 'approved'
  | 'invoiced'
  | 'void';

/** งวดวางบิลต่อคน/ต่อรอบ mobilization (mobCycleId) */

export interface MobCycleBillingReview {
  id: string;
  mobCycleId: string;
  assignmentId: string;
  workerId: string;
  workerNameSnapshot: string;
  poId: string;
  contractId?: string;
  customerId: string;
  waveId?: string;
  positionId?: string;
  /** วัน M1 แรก — ใช้จัดกลุ่ม batch ร่วมกับคนอื่น */
  tripAnchorStartDate: string;
  tripStartDate: string;
  tripEndDate?: string;
  spansYearMonths?: string[];
  status: MobCycleBillingReviewStatus;
  tripBillingBatchId?: string;
  demobilizationTimesheetId?: string;
  /**
   * ปิดรอบวางบิลแบบ standby-only (ไม่มี M1/D1) — sync จะคง tripEndDate เดิมไว้
   * จนกว่าจะมี mobilization_day / work_day / demobilization_day
   */
  standbyOnlyClosed?: boolean;
  standbyOnlyClosedAt?: number;
  standbyOnlyClosedByName?: string;
  createdAt: number;
  updatedAt: number;
}

export type TripBillingBatchStatus =
  | 'draft'
  | 'ready'
  | 'pending_manager'
  | 'approved'
  | 'invoiced'
  | 'void';

/** ชุดวางบิลร่วม — หลายคนที่ mobilize พร้อมกัน (เช่น 2 หรือ 4 คน) → invoice เดียว */

export interface TripBillingBatch {
  id: string;
  poId: string;
  contractId?: string;
  customerId: string;
  waveId?: string;
  /** คีย์จัดกลุ่ม: po + wave + วัน M1 แรก */
  tripAnchorStartDate: string;
  memberMobCycleIds: string[];
  memberWorkerIds: string[];
  memberWorkerNames?: string[];
  periodStart: string;
  periodEnd?: string;
  status: TripBillingBatchStatus;
  sourceCommercialInvoiceId?: string;
  submittedAt?: number;
  reviewedAt?: number;
  reviewedByUserId?: string;
  reviewedByName?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MainContract {
  id: string;
  contractNumber: string;
  /** เลขที่สัญญา/เอกสารอ้างอิงฝั่งลูกค้า (Service Agreement No.) */
  serviceAgreementNo?: string;
  contractType?: 'master' | 'supplemental';
  parentContractId?: string;
  inheritTermsFromContractId?: string;
  customerId: string;
  title: string;
  projectId?: string;
  startDate: number;
  endDate: number;
  status: 'pending' | 'active' | 'revised' | 'expired' | 'closed';
  currency: string;
  /** อัตรา VAT (%) สำหรับใบแจ้งหนี้เรียกเก็บ — อ้างอิงจากสัญญาเท่านั้น */
  vatPercent?: number;
  billingTerms: string;
  paymentTerms: string;
  rateMultiplierPolicy?: {
    sell: {
      otAfterShift: number;
      holiday: number;
      publicHoliday: number;
      sunday: number;
      sundayOt: number;
      standby: number;
      mobilization: number;
      demobilization: number;
      travel: number;
    };
    cost: {
      otAfterShift: number;
      holiday: number;
      publicHoliday: number;
      sunday: number;
      sundayOt: number;
      standby: number;
      mobilization: number;
      demobilization: number;
      travel: number;
    };
  };
  /** วันหยุดร่วมทั้งสัญญา (ทุกตำแหน่งใช้ชุดเดียวกัน) — ฝั่งวางบิล */
  contractSellWeeklyRestPattern?: 'none' | 'sat_sun' | 'sunday_only';
  contractSellCalendarHolidays?: { date: string; label: string }[];
  contractSellSpecialDays?: string[];
  /** วันหยุดร่วมทั้งสัญญา — ฝั่ง payroll */
  contractCostWeeklyRestPattern?: 'none' | 'sat_sun' | 'sunday_only';
  contractCostCalendarHolidays?: { date: string; label: string }[];
  contractCostSpecialDays?: string[];
  notes?: string;
  approvedAt?: number;
  approvedBy?: string;
  supersededByContractId?: string;
  lastSubmittedAt?: number;
  lastSubmittedBy?: string;
  /** ฝ่ายที่เริ่มเงื่อนไขเชิงพาณิชย์ (ราคา/ฝั่งขาย) — ต้นทุนแรง OPEC อยู่ที่ /positions */
  commercialTermsOwner?: 'sales' | 'operations';
  /**
   * ฐานต้นทุนค่าแรง (บาท/วัน) ต่อตำแหน่ง **ภายใต้สัญญานี้** — ทับ `Position.defaultLaborCost*`
   * เมื่อคำนวณ payroll สำหรับ daily_timesheets ที่ `contractId` ตรงกับสัญญานี้ (เฟส A)
   */
  laborCostBaselinesByPositionId?: Record<string, { onshore?: number; offshore?: number }>;
  /** Mob/demob location columns for this contract's rate sheet (Thai Nippon-style). */
  mobDemobLocations?: ContractMobDemobLocation[];
  /** MONTHLY = ปิด PO+เดือนแล้วออก invoice รวม | TRIP = วางบิลตามรอบ M1→D1 (หลายคนต่อ invoice ได้) */
  billingMode?: ContractBillingMode;
  /**
   * TRIP billing — คิดค่า Mob/Demob ไป-กลับ (round trip) ต่อคนต่อรอบเดินทาง
   * อัตราจากตารางราคาสัญญา (mobDemobRoundTrip) — ไม่รวม M1/D1 รายวัน
   */
  tripBillMobDemobFee?: boolean;
  /** Cached position rates subcollection for payroll/billing resolution. */
  positionRates?: PositionRate[];
  /**
   * @deprecated ถูก sync ฝั่งสัญญา (เฟส 4–6) — ไม่ใช้ block อนุมัติแล้ว; ดูฐานต้นทุนได้ที่ /positions
   * รัน `migrate:phase6` เพื่อลบ field เหล่านี้จาก Firestore
   */
  costingStatus?: string;
  /** @deprecated เหมือน costingStatus */
  costingMissingPositionsCount?: number;
  /** @deprecated เหมือน costingStatus */
  costingUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PositionRate {
  id: string;
  positionId: string;
  sellRate: number;
  /** ราคาขาย Onshore — ถ้าไม่มีให้ใช้ `sellRate` */
  sellRateOnshore?: number;
  /** ราคาขาย Offshore — ถ้าไม่มีให้ใช้ `sellRate` */
  sellRateOffshore?: number;
  /** @deprecated ฝั่งสัญญาไม่เขียน field นี้แล้ว; อาจยังอ่านได้ถ้าเอกสารยังไม่รัน migrate เฟส 5 */
  costBaseline?: number;
  billingUnit: 'daily' | 'monthly' | 'hourly';
  active: boolean;
  overtimeRule: string;
  /** @deprecated ไม่ใช้คิดเงินแล้ว — ราคา OT มาจาก rateMatrix OT 1.5 / OT2 / OT3; คงไว้ในเอกสารเก่าและ PO snapshot */
  overtimeRuleKey?: 'NONE' | 'MULT_1_0' | 'MULT_1_5' | 'MULT_2_0';
  /** Weekly rest pattern for sell-side day classification */
  sellWeeklyRestPattern?: 'none' | 'sat_sun' | 'sunday_only';
  /** Weekly rest pattern for cost-side */
  costWeeklyRestPattern?: 'none' | 'sat_sun' | 'sunday_only';
  sellCalendarHolidays?: { date: string; label: string }[];
  costCalendarHolidays?: { date: string; label: string }[];
  /** @deprecated ใช้ normalWorkHoursOnshore / normalWorkHoursOffshore — คงไว้ให้เอกสารเก่าและ PO snapshot */
  normalWorkHours?: 8 | 12;
  /** ชม.งานปกติ/วัน งาน Onshore (มาตรฐาน 8) */
  normalWorkHoursOnshore?: 8 | 12;
  /** ชม.งานปกติ/วัน งาน Offshore (มาตรฐาน 12) */
  normalWorkHoursOffshore?: 8 | 12;
  sellOtRules?: {
    afterShift?: number;
    holiday?: number;
    publicHoliday?: number;
    sunday?: number;
    sundayOt?: number;
  };
  costOtRules?: {
    afterShift?: number;
    holiday?: number;
    publicHoliday?: number;
    sunday?: number;
    sundayOt?: number;
  };
  sellSpecialDays?: string[];
  costSpecialDays?: string[];
  notes?: string;
  /** Extended rate sheet (mob, standby, OT, M1/D1) — billing/payroll source when populated. */
  rateMatrix?: PositionRateMatrix;
}

export interface PurchaseOrder {
  id: string;
  poCode: string;
  /** Customer-issued PO document number (external reference) */
  customerPONumber?: string;
  /** วันที่ลูกค้าออกเอกสาร PO (อ้างอิงฝั่งลูกค้า) */
  customerPoIssueDate?: number;
  /** contract = based on active contract, quotation = based on approved/sent quotation */
  poType?: 'contract' | 'quotation';
  contractId: string;
  /** Snapshot จากสัญญาหลัก ณ เวลาสร้าง PO (Service Agreement No. ฝั่งลูกค้า) */
  serviceAgreementNo?: string;
  quotationId?: string;
  customerId: string;
  title: string;
  projectName: string;
  description: string;
  startDate: number;
  endDate: number;
  status: 'pending' | 'active' | 'closed';
  /** โหมดงานของ PO — รวมกลุ่ม PO Active / timesheet (default Offshore สำหรับเอกสารเก่า) */
  poWorkMode?: JobMode;
  /** MONTHLY | TRIP — override สัญญาหลัก (Guangzhou = MONTHLY, Thai Nippon offshore = TRIP) */
  billingMode?: ContractBillingMode;
  /** อ้างอิง `po_active_bundles` — sync อัตโนมัติเมื่อ PO Active */
  poActiveBundleId?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  createdByUid?: string;
  createdByName?: string;
  /** แชร์ให้ officer ที่ระบุ — ดูได้แม้ไม่ได้เป็นผู้สร้าง */
  sharedWith?: { uid: string; displayName: string; roleKey?: string }[];
  sharedWithUids?: string[];
}

/** กลุ่ม PO Active ต่อลูกค้า + Onshore/Offshore */

export interface PoActiveBundle {
  id: string;
  customerId: string;
  workMode: JobMode;
  poIds: string[];
  updatedAt: number;
  /** true = ปิด Scheduler/UI silent sync — ไม่ลบแถวเก่า; ใช้ลงมือหรือปุ่ม Auto gen */
  poActiveAutoDailyDisabled?: boolean;
}

export interface OtRulesSnapshot {
  afterShift?: number;
  holiday?: number;
  publicHoliday?: number;
  sunday?: number;
  sundayOt?: number;
}

export interface POLine {
  id: string;
  poId: string;
  positionId: string;
  /** สถานที่ปฏิบัติงานตามที่ลูกค้าระบุต่อบรรทัด (แยกจาก site ของ Wave) */
  workLocation?: string;
  quantity: number;
  startDate: number;
  endDate: number;
  sellRateSnapshot: number;
  /** Snapshot ราคาขายแยกโหมด — ถ้าไม่มีให้ใช้ `sellRateSnapshot` */
  sellRateSnapshotOnshore?: number;
  sellRateSnapshotOffshore?: number;
  costBaselineSnapshot: number;
  billingUnitSnapshot: string;
  overtimeRuleSnapshot: string;
  sellOtRulesSnapshot?: OtRulesSnapshot;
  costOtRulesSnapshot?: OtRulesSnapshot;
  normalWorkHoursSnapshot?: 8 | 12;
  /** Snapshot of `PositionRate.rateMatrix` at PO line creation (Phase 5+). */
  rateMatrixSnapshot?: PositionRateMatrix;
  status: 'active' | 'cancelled' | 'completed';
}

export type SalesContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'CLOSED' | 'CANCELLED';

export interface SalesContractTerm {
  id: string;
  customerId: string;
  /** สายสัญญา — ว่างได้ถ้าผูกกับใบเสนอราคาแทน */
  mainContractId?: string;
  /** สายใบเสนอราคา — ต้องมีเมื่อไม่มี main contract */
  quotationId?: string;
  purchaseOrderId: string;
  title: string;
  contractNo: string;
  status: SalesContractStatus;
  effectiveDate: string; // Date-only string (e.g., YYYY-MM-DD)
  endDate: string; // Date-only string (e.g., YYYY-MM-DD)
  currency: string;
  billingCycle: string;
  paymentTermsDays: number;
  vatPercent: number;
  withholdingTaxPercent: number;
  notes?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type LaborCostContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'CLOSED' | 'CANCELLED';

export type LaborScopeType = 'SPECIFIC_PO' | 'GENERAL_CUSTOMER' | 'MASTER_CONTRACT' | 'PROJECT_BASED' | 'OTHER';

export interface LaborCostContractTerm {
  id: string;
  title: string;
  relatedCustomerId: string;
  relatedPurchaseOrderId?: string;
  relatedContractId?: string;
  scopeType: LaborScopeType;
  status: LaborCostContractStatus;
  effectiveDate: string; // Date-only string (e.g., YYYY-MM-DD)
  endDate: string; // Date-only string (e.g., YYYY-MM-DD)
  notes?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Workflow บนข้อมูล mobilization — ข้อมูลเก่าไม่มีฟิลด์นี้ (= legacy เทียบเท่า wave-centric)
 * เฟส 1+ จะใช้ `po_active_v2` เป็นแกน PO Active / location / finished_location
 */

export type RateConditionEventType = 
  | 'work_day' 
  | 'off_day_worked' 
  | 'public_holiday_worked' 
  | 'travel_day' 
  | 'standby_day' 
  | 'mobilization_day' 
  | 'demobilization_day' 
  | 'training_day' 
  | 'sick_leave_paid' 
  | 'vacation_paid' 
  | 'unpaid_leave' 
  | 'night_shift' 
  | 'half_day' 
  | 'early_return' 
  | 'client_cancellation' 
  | 'replacement_day' 
  | 'other';

export type RateConditionUnitType = 'DAY' | 'HALF_DAY' | 'HOUR' | 'TRIP' | 'FIXED';

export type RateConditionCalculationMethod = 'FLAT' | 'FIXED' | 'MULTIPLIER' | 'PERCENTAGE' | 'FORMULA';

export type RateConditionParentType = 'SALES_CONTRACT' | 'LABOR_COST_CONTRACT' | 'PO_SNAPSHOT' | 'WAVE_SNAPSHOT';

export type RateConditionAppliesTo = 'SALES' | 'COST';

export interface RateCondition {
  id: string;
  parentType: RateConditionParentType;
  parentId: string;
  appliesTo: RateConditionAppliesTo;
  eventType: RateConditionEventType;
  unitType: RateConditionUnitType;
  calculationMethod: RateConditionCalculationMethod;
  isActive: boolean;
  positionId?: string;
  siteId?: string;
  workMode?: JobMode | 'BOTH';
  baseRate?: number;
  multiplier?: number;
  percentageOfBase?: number;
  fixedAmount?: number;
  displayOrder: number;
  effectiveDate: string;
  endDate?: string;
  billableConditionText?: string;
  payableConditionText?: string;
  requiresApproval?: boolean;
}

export interface GlobalRateMultiplierPolicy {
  id: string;
  sell: {
    otAfterShift: number;
    holiday: number;
    publicHoliday: number;
    sunday: number;
    sundayOt: number;
    standby: number;
    mobilization: number;
    demobilization: number;
    travel: number;
  };
  cost: {
    otAfterShift: number;
    holiday: number;
    publicHoliday: number;
    sunday: number;
    sundayOt: number;
    standby: number;
    mobilization: number;
    demobilization: number;
    travel: number;
  };
  updatedAt: number;
  updatedBy: string;
}

