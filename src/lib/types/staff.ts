/** Domain types: staff (from master types.ts split). */

export type OfficeStaffPayrollLineRef = {
  runCollection: 'office_payroll_runs' | 'executive_payroll_runs';
  runId: string;
  lineId: string;
  payrollMonth?: string;
  updatedAt: number;
};

export interface OfficeStaff {
  id: string;
  staffCode: string;
  fullName: string;
  /** คำนำหน้าสำหรับนำส่งประกันสังคม — นาย / นาง / นางสาว */
  nameTitle?: string;
  /** ชื่อ สำหรับไฟล์นำส่ง สปส. — แยกจาก fullName */
  firstName?: string;
  /** นามสกุล สำหรับไฟล์นำส่ง สปส. */
  lastName?: string;
  nickname?: string;
  /** เบอร์ติดต่อ */
  phone?: string;
  department: string;
  /** Optional link to {@link Position} when chosen from ตำแหน่งงาน (category OFFICE). */
  positionId?: string;
  positionTitle: string;
  /** แยกงวดเงินเดือน: พนักงานทั่วไป vs ผู้บริหาร (จัดการในบัญชี — ไม่รวมในงวด office ทั่วไป) */
  payrollBand?: 'OFFICE' | 'EXECUTIVE';
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  salaryType: 'MONTHLY' | 'DAILY';
  monthlySalary: number;
  /** ค่าจ้างรายวัน (เมื่อจ่ายแบบรายวันหรืออ้างอิงประกอบสลิป) */
  dailyWage?: number;
  /** รายเดือนแต่ไม่อ้างอิงการสแกน/เวลาเข้างาน */
  monthlyAttendanceExempt?: boolean;
  /**
   * ฐานคิดหักสาย/ขาดจากเวลาเข้างาน (admin เท่านั้นที่ตั้ง)
   * — BASE_SALARY = ไม่หักจากสแกน แต่ยังหักจากวันลา/ขาดที่บันทึกในระบบ
   */
  officePayrollTimeDeductionBasis?: 'SCAN' | 'BASE_SALARY';
  /** ไม่นำเข้างวดจ่ายเงินเดือนออฟฟิศอัตโนมัติ (เช่น ฝึกงาน / จ่ายนอกระบบ) */
  excludeFromPayrollRuns?: boolean;
  startDate: string;
  /** วันสิ้นสุดการจ้าง (ถ้ามี) */
  employmentEndDate?: string;
  /** เลขบัตรประชาชน */
  nationalId?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactPhone?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  taxId?: string;
  socialSecurityNo?: string;
  /** สถานะการขึ้นทะเบียนประกันสังคม */
  socialSecurityStatus?: 'ENROLLED' | 'EXEMPT';
  /** โรงพยาบาลประกันสังคมที่เลือก */
  socialSecurityHospital?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'RESIGNED';
  notes?: string;
  linkedUserId?: string;
  /** อ้างอิงบรรทัด payroll ของตนเอง — sync จากงวดจ่าย (My Profile อ่านด้วย get รายบรรทัด) */
  payrollLineRefs?: OfficeStaffPayrollLineRef[];
  /** @deprecated ไม่ใช้ใน UI — เก็บไว้เฉพาะข้อมูลเก่าใน Firestore */
  supervisorId?: string;
  /** snapshot ตอนผู้ดูแลระบบผูกบัญชี — ให้ HR ดูชื่อ/อีเมลโดยไม่ต้องอ่าน users/{id} */
  linkedUserDisplayName?: string;
  linkedUserDisplayEmail?: string;
  /** snapshot บรรทัดสรุปสิทธิ์ตอนบันทึกการผูกบัญชี */
  linkedUserAccessSummary?: string[];
  createdAt: number;
  createdBy?: string;
  updatedAt: number;
  updatedBy?: string;
}

/**
 * ทะเบียนผู้บริหารสำหรับงวดจ่ายในเมนูบัญชี — แยกจาก `office_staff`
 * การคำนวณภาษี/ประกันสังคมใช้นโยบายชุดเดียวกับพนักงานออฟฟิศ (HR settings / `office`)
 */

export interface ExecutivePayrollStaff {
  id: string;
  staffCode: string;
  fullName: string;
  /** คำนำหน้าสำหรับนำส่งประกันสังคม — นาย / นาง / นางสาว */
  nameTitle?: string;
  firstName?: string;
  lastName?: string;
  department: string;
  positionTitle: string;
  monthlySalary: number;
  employmentType?: OfficeStaff['employmentType'];
  salaryType?: OfficeStaff['salaryType'];
  /** ไม่นำเข้างวดคำนวณอัตโนมัติ */
  excludeFromPayrollRuns?: boolean;
  /** ประเภทรายได้เมื่อไม่นำเข้าคำนวณเงินเดือนอัตโนมัติ */
  nonPayrollIncomeType?: ExecutiveNonPayrollIncomeType;
  /** รายละเอียดเมื่อเลือก OTHER */
  nonPayrollIncomeOtherLabel?: string;
  /** อัตราหัก ณ ที่จ่ายแบบคงที่ */
  nonPayrollWhtPercent?: ExecutiveNonPayrollWhtPercent;
  status: 'ACTIVE' | 'INACTIVE';
  notes?: string;
  /** อ้างอิงทะเบียน office_staff เดิม (ถ้ามี) — ไม่บังคับ */
  linkedOfficeStaffId?: string;
  /** เชื่อมบัญชีล็อกอิน (My Profile / portal) — จัดการได้เฉพาะผู้ดูแลระบบ */
  linkedUserId?: string;
  linkedUserDisplayName?: string;
  linkedUserDisplayEmail?: string;
  linkedUserAccessSummary?: string[];
  /** สำหรับออกใบหัก ณ ที่จ่าย — ถ้าไม่กรอกและมี linkedOfficeStaffId ระบบดึงจาก office_staff */
  nationalId?: string;
  taxId?: string;
  address?: string;
  bankName?: string;
  bankAccountNumber?: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
}

export type ExecutiveNonPayrollIncomeType = 'MEETING_ALLOWANCE' | 'DIVIDEND' | 'OTHER';

export type ExecutiveNonPayrollWhtPercent = 5 | 10 | 15 | 20 | 25 | 30 | 35;

/** Aliases for forms / imports (mirror OfficeStaff fields). */

export type StaffStatus = OfficeStaff['status'];

export type EmploymentType = OfficeStaff['employmentType'];

export type StaffSalaryType = OfficeStaff['salaryType'];

