import { normalizeStaffDateYmd } from '@/lib/payroll/office-staff-date-ymd';

export const EMPLOYMENT_END_REASONS = [
  { code: 'RESIGNED', labelTh: 'ลาออก' },
  { code: 'DISMISSED_DISCIPLINE', labelTh: 'ให้ออกผิดวินัยการทำงาน' },
  { code: 'OTHER', labelTh: 'อื่นๆ' },
] as const;

export type EmploymentEndReason = (typeof EMPLOYMENT_END_REASONS)[number]['code'];

/** หนึ่งรอบเริ่มงาน–สิ้นสุดงาน เก็บไว้ไม่ให้รอบถัดไปเขียนทับ */
export interface EmploymentTenure {
  id: string;
  startDate: string;
  endDate?: string;
  endReason?: EmploymentEndReason;
  endReasonNote?: string;
  recordedByUid: string;
  recordedByName: string;
  recordedAt: number;
}

export function isEmploymentEndReason(v: unknown): v is EmploymentEndReason {
  return v === 'RESIGNED' || v === 'DISMISSED_DISCIPLINE' || v === 'OTHER';
}

export function employmentEndReasonLabelTh(code: EmploymentEndReason | string | undefined | null): string {
  const found = EMPLOYMENT_END_REASONS.find((o) => o.code === code);
  return found?.labelTh ?? '';
}

export function formatEmploymentEndReasonDisplay(
  code: EmploymentEndReason | string | undefined | null,
  note?: string | null,
): string {
  const base = employmentEndReasonLabelTh(code);
  const extra = (note || '').trim();
  if (!base) return extra;
  if (code === 'OTHER') return extra ? `อื่นๆ · ${extra}` : 'อื่นๆ';
  return extra ? `${base} · ${extra}` : base;
}

function ymd(value: unknown): string {
  return normalizeStaffDateYmd(value) || '';
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

function cleanTenures(list: EmploymentTenure[] | null | undefined): EmploymentTenure[] {
  if (!Array.isArray(list)) return [];
  return list.filter((t) => t && ymd(t.startDate));
}

/** รอบจากวันที่เดิมในทะเบียน ก่อนมีประวัติ */
export function seedEmploymentTenures(
  existing: EmploymentTenure[] | null | undefined,
  legacyStart: unknown,
  legacyEnd: unknown,
): EmploymentTenure[] {
  const stored = cleanTenures(existing);
  if (stored.length > 0) return stored;
  const startDate = ymd(legacyStart);
  if (!startDate) return [];
  const endDate = ymd(legacyEnd);
  return [
    {
      id: 'legacy',
      startDate,
      endDate: endDate || undefined,
      recordedByUid: '',
      recordedByName: 'ข้อมูลเดิม',
      recordedAt: 0,
    },
  ];
}

export type EmploymentTenureCommitResult =
  | {
      ok: true;
      skipped: boolean;
      tenures: EmploymentTenure[];
      startDate: string;
      employmentEndDate: string;
      endReason: EmploymentEndReason | '';
      endReasonNote: string;
      /** true เมื่อวันเริ่มอยู่หลังวันสิ้นสุดรอบก่อน — เปิดรอบใหม่โดยไม่ลบรอบเก่า */
      openedNewCycle: boolean;
    }
  | { ok: false; error: string };

export function commitEmploymentTenure(input: {
  existingTenures?: EmploymentTenure[] | null;
  legacyStart?: unknown;
  legacyEnd?: unknown;
  startDate: unknown;
  endDate: unknown;
  endReason?: EmploymentEndReason | '' | null;
  endReasonNote?: string | null;
  actor: { uid: string; name: string };
  now: number;
}): EmploymentTenureCommitResult {
  const startDate = ymd(input.startDate);
  const endDate = ymd(input.endDate);
  const reason = isEmploymentEndReason(input.endReason) ? input.endReason : '';
  const note = (input.endReasonNote || '').trim();
  const prior = seedEmploymentTenures(input.existingTenures, input.legacyStart, input.legacyEnd);

  if (!startDate && !endDate && prior.length === 0) {
    return {
      ok: true,
      skipped: true,
      tenures: [],
      startDate: '',
      employmentEndDate: '',
      endReason: '',
      endReasonNote: '',
      openedNewCycle: false,
    };
  }
  const latest = prior[prior.length - 1];
  const endUnchanged =
    Boolean(latest) && latest!.startDate === startDate && (latest!.endDate || '') === endDate;

  if (!startDate) return { ok: false, error: 'กรุณาระบุวันที่เริ่มงาน' };
  if (endDate && endDate < startDate) {
    return { ok: false, error: 'วันสิ้นสุดการทำงานต้องไม่ก่อนวันที่เริ่มงาน' };
  }
  if (endDate && !reason && !(endUnchanged && !latest?.endReason)) {
    return { ok: false, error: 'กรุณาระบุเหตุผลการสิ้นสุดการทำงาน' };
  }
  if (endDate && reason === 'OTHER' && !note) {
    return { ok: false, error: 'กรุณาระบุรายละเอียดเหตุผล เมื่อเลือก อื่นๆ' };
  }

  const actorName = input.actor.name.trim() || input.actor.uid || '—';
  const stamp = {
    recordedByUid: input.actor.uid,
    recordedByName: actorName,
    recordedAt: input.now,
  };
  const closedFields = endDate
    ? {
        endDate,
        ...(reason ? { endReason: reason, endReasonNote: note || undefined } : {}),
      }
    : { endDate: undefined, endReason: undefined, endReasonNote: undefined };

  const openedNewCycle = Boolean(latest?.endDate && startDate > latest.endDate);

  if (latest?.endDate && startDate <= latest.endDate) {
    const previous = prior.slice(0, -1);
    const previousEnd = previous[previous.length - 1]?.endDate;
    if (previousEnd && startDate <= previousEnd) {
      return { ok: false, error: 'วันเริ่มรอบนี้ต้องอยู่หลังวันสิ้นสุดรอบก่อน' };
    }
    const unchanged =
      latest.startDate === startDate &&
      (latest.endDate || '') === endDate &&
      (latest.endReason || '') === (endDate ? reason : '') &&
      (latest.endReasonNote || '') === (endDate ? note : '');
    const nextLatest = stripUndefined({
      ...latest,
      startDate,
      ...closedFields,
      ...(unchanged
        ? {
            recordedByUid: latest.recordedByUid,
            recordedByName: latest.recordedByName,
            recordedAt: latest.recordedAt,
          }
        : stamp),
    }) as EmploymentTenure;
    return {
      ok: true,
      skipped: false,
      tenures: [...previous, nextLatest],
      startDate,
      employmentEndDate: endDate,
      endReason: endDate ? reason : '',
      endReasonNote: endDate ? note : '',
      openedNewCycle: false,
    };
  }

  if (openedNewCycle && latest) {
    const next = stripUndefined({
      id: `tenure-${input.now}`,
      startDate,
      ...closedFields,
      ...stamp,
    }) as EmploymentTenure;
    return {
      ok: true,
      skipped: false,
      tenures: [...prior, next],
      startDate,
      employmentEndDate: endDate,
      endReason: endDate ? reason : '',
      endReasonNote: endDate ? note : '',
      openedNewCycle: true,
    };
  }

  const previous = latest ? prior.slice(0, -1) : [];
  const previousEnd = previous[previous.length - 1]?.endDate;
  if (previousEnd && startDate <= previousEnd) {
    return { ok: false, error: 'วันเริ่มรอบนี้ต้องอยู่หลังวันสิ้นสุดรอบก่อน' };
  }
  const base = latest ?? {
    id: `tenure-${input.now}`,
    startDate,
    recordedByUid: '',
    recordedByName: '',
    recordedAt: 0,
  };
  const unchanged =
    Boolean(latest) &&
    latest!.startDate === startDate &&
    (latest!.endDate || '') === endDate &&
    (latest!.endReason || '') === (endDate ? reason : '') &&
    (latest!.endReasonNote || '') === (endDate ? note : '') &&
    latest!.recordedAt > 0;
  const nextLatest = stripUndefined({
    ...base,
    startDate,
    ...closedFields,
    ...(unchanged
      ? {
          recordedByUid: latest!.recordedByUid,
          recordedByName: latest!.recordedByName,
          recordedAt: latest!.recordedAt,
        }
      : stamp),
  }) as EmploymentTenure;
  return {
    ok: true,
    skipped: false,
    tenures: [...previous, nextLatest],
    startDate,
    employmentEndDate: endDate,
    endReason: endDate ? reason : '',
    endReasonNote: endDate ? note : '',
    openedNewCycle: false,
  };
}

/** สถานะทะเบียนออฟฟิศให้สอดคล้องกับรอบล่าสุด */
export function officeStatusForEmploymentTenure(
  endDate: string,
  endReason: EmploymentEndReason | '',
  currentStatus: 'ACTIVE' | 'INACTIVE' | 'RESIGNED' | undefined,
): 'ACTIVE' | 'INACTIVE' | 'RESIGNED' {
  if (!endDate) {
    if (currentStatus === 'RESIGNED') return 'ACTIVE';
    return currentStatus || 'ACTIVE';
  }
  if (endReason === 'RESIGNED') return 'RESIGNED';
  return 'INACTIVE';
}
