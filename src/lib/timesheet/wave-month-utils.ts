import type { DailyTimesheet, RateConditionEventType, WaveMonthTimesheetPhotoAttachment } from '@/lib/types';

/** คืน yyyy-mm-dd สำหรับวันสุดท้ายของเดือน yyyy-mm */
/** แนบเป็น PDF หรือไม่ (รองรับข้อมูลเก่าที่ไม่มี contentType) */
export function isWaveMonthAttachmentPdf(att: Pick<WaveMonthTimesheetPhotoAttachment, 'fileName' | 'contentType'>): boolean {
  if (att.contentType === 'application/pdf') return true;
  return att.fileName.toLowerCase().endsWith('.pdf');
}

export function lastDayOfCalendarMonth(ym: string): string {
  const [ys, ms] = ym.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!y || !m || m < 1 || m > 12) return `${ys}-${ms}-28`;
  const last = new Date(y, m, 0);
  const d = String(last.getDate()).padStart(2, '0');
  return `${y}-${String(m).padStart(2, '0')}-${d}`;
}

/** รายการวันที่ในเดือน (yyyy-mm-dd) */
export function listDaysInMonth(ym: string): string[] {
  const end = lastDayOfCalendarMonth(ym);
  const [y, m] = ym.split('-').map(Number);
  const out: string[] = [];
  const lastNum = Number(end.slice(8, 10));
  for (let d = 1; d <= lastNum; d++) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

export function timesheetEventAbbrev(et: RateConditionEventType | string | undefined): string {
  const map: Record<string, string> = {
    work_day: 'W',
    standby_day: 'SB',
    travel_day: 'T',
    mobilization_day: 'M',
    demobilization_day: 'D',
    unpaid_leave: 'UL',
    off_day_worked: 'OW',
    public_holiday_worked: 'PH',
    training_day: 'TR',
    sick_leave_paid: 'SL',
    vacation_paid: 'V',
    night_shift: 'N',
    half_day: 'H',
    early_return: 'ER',
    client_cancellation: 'X',
    replacement_day: 'R',
    other: '?',
  };
  return map[et || ''] || (et ? String(et).slice(0, 2).toUpperCase() : '—');
}

export function timesheetCellSummary(ts: DailyTimesheet | undefined): string {
  if (!ts) return '';
  const h = ts.normalHours ?? 0;
  const a = timesheetEventAbbrev(ts.eventType);
  return `${h}${a}`;
}

/**
 * สีพื้น/ขอบตามประเภทวัน (อ่านง่ายจากระยะไกล) + วงแหวนแยก DRAFT vs ส่งแล้ว
 */
export function timesheetEventCellBadgeClasses(
  eventType: RateConditionEventType | string | undefined,
  status: string | undefined,
): string {
  const isDraft = status === 'DRAFT';
  let tone: string;
  switch (eventType) {
    case 'work_day':
      tone = 'border-emerald-500/70 bg-emerald-50 text-emerald-950';
      break;
    case 'standby_day':
      tone = 'border-sky-500/70 bg-sky-100 text-sky-950';
      break;
    case 'travel_day':
      tone = 'border-violet-500/70 bg-violet-50 text-violet-950';
      break;
    case 'mobilization_day':
      tone = 'border-orange-500/70 bg-orange-50 text-orange-950';
      break;
    case 'demobilization_day':
      tone = 'border-amber-600/60 bg-amber-50 text-amber-950';
      break;
    case 'unpaid_leave':
      tone = 'border-slate-400 bg-slate-200/80 text-slate-900';
      break;
    case 'off_day_worked':
    case 'public_holiday_worked':
      tone = 'border-fuchsia-500/60 bg-fuchsia-50 text-fuchsia-950';
      break;
    case 'training_day':
      tone = 'border-cyan-600/50 bg-cyan-50 text-cyan-950';
      break;
    case 'sick_leave_paid':
    case 'vacation_paid':
      tone = 'border-pink-400 bg-pink-50 text-pink-950';
      break;
    case 'night_shift':
      tone = 'border-indigo-500/60 bg-indigo-50 text-indigo-950';
      break;
    case 'half_day':
    case 'early_return':
      tone = 'border-teal-500/50 bg-teal-50 text-teal-950';
      break;
    case 'client_cancellation':
    case 'replacement_day':
      tone = 'border-rose-500/50 bg-rose-50 text-rose-950';
      break;
    default:
      tone = 'border-slate-300 bg-slate-100 text-slate-800';
  }
  const statusRing = isDraft
    ? 'ring-2 ring-amber-400 ring-offset-0 shadow-sm'
    : 'ring-1 ring-slate-300/90 ring-offset-0';
  return `font-semibold ${tone} ${statusRing}`;
}
