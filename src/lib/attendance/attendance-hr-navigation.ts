export type AttendanceListNavState = {
  month?: string;
  q?: string;
  openStaff?: string;
};

export function buildAttendanceListHref(state: AttendanceListNavState = {}): string {
  const sp = new URLSearchParams();
  if (state.month?.trim()) sp.set('month', state.month.trim());
  if (state.q?.trim()) sp.set('q', state.q.trim());
  if (state.openStaff?.trim()) sp.set('openStaff', state.openStaff.trim());
  const qs = sp.toString();
  return qs ? `/hr/attendance?${qs}` : '/hr/attendance';
}

export function buildAttendanceDayDetailHref(input: {
  staffId: string;
  ymd: string;
  month: string;
  q?: string;
  openStaff?: string;
}): string {
  const sp = new URLSearchParams({
    staffId: input.staffId,
    ymd: input.ymd.slice(0, 10),
    month: input.month.slice(0, 7),
  });
  if (input.q?.trim()) sp.set('q', input.q.trim());
  sp.set('openStaff', (input.openStaff ?? input.staffId).trim());
  return `/hr/attendance/day?${sp.toString()}`;
}
