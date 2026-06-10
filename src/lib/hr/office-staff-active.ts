/** สถานะทะเบียนพนักงานออฟฟิศที่ถือว่า "ทำงานอยู่" — รองรับ ACTIVE / active */
export function isActiveOfficeStaffStatus(status?: string | null): boolean {
  return (status ?? '').trim().toUpperCase() === 'ACTIVE';
}

export function filterActiveOfficeStaffForSelection<T extends { status?: string | null }>(
  list: T[] | null | undefined,
): T[] {
  return (list ?? []).filter((s) => isActiveOfficeStaffStatus(s.status));
}
