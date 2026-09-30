import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { sanitizeFirestorePayload } from '@/lib/utils';

export const SSO_NAME_TITLES = ['นาย', 'นาง', 'นางสาว'] as const;
export type SsoNameTitle = (typeof SSO_NAME_TITLES)[number];
export type SsoFilingPersonKind = 'worker' | 'office' | 'executive';

export type SsoFilingStoredName = {
  nameTitle?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
};

export type SsoFilingPersonRow = {
  key: string;
  personKind: SsoFilingPersonKind;
  personId: string;
  nationalId: string;
  nameTitle: SsoNameTitle | '';
  firstName: string;
  lastName: string;
  wage: number;
  contrib: number;
};

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

export function normalizeSsoNameTitle(raw: string | undefined | null): SsoNameTitle | '' {
  const t = String(raw || '').trim();
  return (SSO_NAME_TITLES as readonly string[]).includes(t) ? (t as SsoNameTitle) : '';
}

export function ssoFilingNameKey(kind: SsoFilingPersonKind, personId: string): string {
  return `${kind}::${personId}`;
}

export function composeStaffDisplayName(parts: {
  nameTitle?: string;
  firstName?: string;
  lastName?: string;
}): string {
  return [parts.nameTitle, parts.firstName, parts.lastName]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ');
}

function peelNameTitlePrefix(raw: string): { nameTitle: SsoNameTitle | ''; rest: string } {
  const full = String(raw || '').trim();
  const titles = [...SSO_NAME_TITLES].sort((a, b) => b.length - a.length);
  for (const title of titles) {
    if (!full.startsWith(title)) continue;
    const rest = full.slice(title.length);
    if (!rest || rest.startsWith(' ') || /^[ก-๙A-Za-z]/.test(rest)) {
      return { nameTitle: title, rest: rest.trim() };
    }
  }
  return { nameTitle: '', rest: full };
}

/** ทะเบียนผู้บริหาร/ออฟฟิศ: ใช้ first/last ถ้ามี ไม่งั้นดึงจาก fullName เดิมมาช่องชื่อ */
export function seedStaffNameFields(stored: SsoFilingStoredName | undefined): {
  nameTitle: SsoNameTitle | '';
  firstName: string;
  lastName: string;
} {
  let nameTitle = normalizeSsoNameTitle(stored?.nameTitle);
  let firstName = String(stored?.firstName || '').trim();
  let lastName = String(stored?.lastName || '').trim();
  if (firstName || lastName) {
    if (!firstName && stored?.fullName) {
      const peeled = peelNameTitlePrefix(stored.fullName);
      if (!nameTitle) nameTitle = peeled.nameTitle;
      let rest = peeled.rest;
      if (lastName && rest.endsWith(lastName)) rest = rest.slice(0, rest.length - lastName.length).trim();
      firstName = rest;
    }
    return { nameTitle, firstName, lastName };
  }
  const peeled = peelNameTitlePrefix(String(stored?.fullName || '').trim());
  if (!nameTitle) nameTitle = peeled.nameTitle;
  return { nameTitle, firstName: peeled.rest === '—' ? '' : peeled.rest, lastName: '' };
}

/** เติมจากทะเบียน ถ้ายังไม่เคยแยกชื่อ ให้ใส่ชื่อเต็มไว้ช่องชื่อเพื่อให้ผู้ใช้ตัดเอง */
export function resolveSsoFilingName(
  stored: SsoFilingStoredName | undefined,
  fallbackName: string,
): { nameTitle: SsoNameTitle | ''; firstName: string; lastName: string } {
  const seeded = seedStaffNameFields({
    ...stored,
    fullName: stored?.fullName || fallbackName,
  });
  if (seeded.nameTitle || seeded.firstName || seeded.lastName) return seeded;
  const full = String(fallbackName || '').trim();
  return { nameTitle: '', firstName: full === '—' ? '' : full, lastName: '' };
}

export function ssoFilingMonthTitle(yearCe: number, monthMm: string): string {
  const mi = Number(monthMm);
  const month = THAI_MONTHS[mi - 1] || monthMm;
  return `จ่ายประกันสังคมประจำเดือน${month} ${yearCe + 543}`;
}

export function ssoFilingRowMissingName(row: SsoFilingPersonRow): boolean {
  return !row.nameTitle || !row.firstName.trim() || !row.lastName.trim() || !row.nationalId.trim();
}

function collectionForKind(kind: SsoFilingPersonKind): string {
  if (kind === 'worker') return 'workers';
  if (kind === 'office') return 'office_staff';
  return 'executive_payroll_staff';
}

/** จำคำนำหน้า / ชื่อ / นามสกุลกลับเข้าทะเบียน — ลูกจ้างเขียนชื่อไทย ไม่ทับชื่ออังกฤษ; พนักงานออฟฟิศไม่ทับชื่อเต็ม */
export async function persistSsoFilingNames(db: Firestore, rows: SsoFilingPersonRow[]): Promise<void> {
  const now = Date.now();
  await Promise.all(
    rows.map((row) =>
      updateDoc(
        doc(db, collectionForKind(row.personKind), row.personId),
        sanitizeFirestorePayload(
          row.personKind === 'worker'
            ? {
                nameTitle: row.nameTitle,
                firstNameTh: row.firstName.trim(),
                lastNameTh: row.lastName.trim(),
                updatedAt: now,
              }
            : {
                nameTitle: row.nameTitle,
                firstName: row.firstName.trim(),
                lastName: row.lastName.trim(),
                updatedAt: now,
              },
        ),
      ),
    ),
  );
}
