/** สถานะทะเบียนพนักงานออฟฟิศที่ถือว่า "ทำงานอยู่" — รองรับ ACTIVE / active */
export function isActiveOfficeStaffStatus(status?: string | null): boolean {
  return (status ?? '').trim().toUpperCase() === 'ACTIVE';
}
