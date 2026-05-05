/**
 * Placeholder services สำหรับส่งออก XML ในอนาคต
 *
 * This is an internal XML-ready payload for payroll WHT.
 * Official RD schema mapping must be added before real submission.
 */

/** @deprecated ใช้เมื่อมีการบันทึก payroll_wht_certificates แล้ว — ยังไม่ผูก collection */
export async function generatePayrollWhtXmlPayload(_payrollWhtCertificateId: string): Promise<string> {
  void _payrollWhtCertificateId;
  throw new Error('generatePayrollWhtXmlPayload: ยังไม่เปิดใช้งาน — ใช้ buildPayrollWhtElectronicDataFromVm จากข้อมูล preview แทน');
}

export async function validatePayrollWhtBeforeExport(_payrollWhtCertificateId: string): Promise<{ ok: boolean; message?: string }> {
  void _payrollWhtCertificateId;
  return { ok: false, message: 'ยังไม่มี workflow บันทึกใบหัก Payroll ลงคอลเลกชัน — ไม่สามารถ validate ก่อนส่งออก XML ได้' };
}

export async function markPayrollWhtReadyForExport(_payrollWhtCertificateId: string): Promise<void> {
  void _payrollWhtCertificateId;
  throw new Error('markPayrollWhtReadyForExport: ยังไม่เปิดใช้งาน');
}
