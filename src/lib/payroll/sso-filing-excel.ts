import * as XLSX from 'xlsx';
import type { PayrollSsoTableRow } from '@/components/accounting/payroll-sso-list-table';
import {
  resolveSsoFilingName,
  ssoFilingMonthTitle,
  ssoFilingNameKey,
  type SsoFilingPersonKind,
  type SsoFilingPersonRow,
  type SsoFilingStoredName,
} from '@/lib/payroll/sso-filing-name';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function cleanNationalId(raw: string): string {
  const t = String(raw || '').trim();
  if (!t || t === '—') return '';
  return t.replace(/\s+/g, '');
}

/** หนึ่งแถวต่อคนในเดือนที่กรอง — ค่าจ้างรวมทุกชุดจ่ายในเดือน, สมทบ 5% คือยอด ปกส. ลูกจ้าง (มีเพดาน) */
export function buildSsoFilingRows(
  tableRows: readonly PayrollSsoTableRow[],
  names: ReadonlyMap<string, SsoFilingStoredName>,
): SsoFilingPersonRow[] {
  const leaders = tableRows.filter(
    (r) => r.isGroupLeader !== false && r.personKind && r.personId,
  );
  const out: SsoFilingPersonRow[] = [];
  for (const leader of leaders) {
    const kind = leader.personKind as SsoFilingPersonKind;
    const personId = leader.personId as string;
    const members = leader.groupKey
      ? tableRows.filter((r) => r.groupKey === leader.groupKey)
      : [leader];
    const wage = round2(members.reduce((sum, r) => sum + (Number(r.paid) || 0), 0));
    const stored = names.get(ssoFilingNameKey(kind, personId));
    const name = resolveSsoFilingName(stored, leader.earnerName);
    out.push({
      key: ssoFilingNameKey(kind, personId),
      personKind: kind,
      personId,
      nationalId: cleanNationalId(leader.earnerId),
      nameTitle: name.nameTitle,
      firstName: name.firstName,
      lastName: name.lastName,
      wage,
      contrib: round2(leader.sso),
    });
  }
  out.sort((a, b) => {
    const an = `${a.firstName} ${a.lastName}`.trim() || a.nationalId;
    const bn = `${b.firstName} ${b.lastName}`.trim() || b.nationalId;
    return an.localeCompare(bn, 'th');
  });
  return out;
}

export function downloadSsoFilingWorkbook(params: {
  yearCe: number;
  monthMm: string;
  rows: SsoFilingPersonRow[];
}): void {
  const title = ssoFilingMonthTitle(params.yearCe, params.monthMm);
  const aoa: (string | number)[][] = [
    [title, '', '', '', '', '', ''],
    ['', 'เลขบัตรประชาชน', 'คำนำหน้า', 'ชื่อ', 'สกุล', 'ค่าจ้าง', 'สมทบ 5%'],
  ];
  let contribSum = 0;
  for (let i = 0; i < params.rows.length; i++) {
    const row = params.rows[i]!;
    contribSum += row.contrib;
    aoa.push([i + 1, row.nationalId, row.nameTitle, row.firstName.trim(), row.lastName.trim(), row.wage, row.contrib]);
  }
  aoa.push(['', '', '', '', '', '', round2(contribSum)]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
  ws['!cols'] = [
    { wch: 6 },
    { wch: 18 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
  ];

  for (let i = 0; i < params.rows.length; i++) {
    const excelRow = i + 3;
    const idAddr = `B${excelRow}`;
    const idCell = ws[idAddr];
    if (idCell) {
      idCell.t = 's';
      idCell.v = params.rows[i]!.nationalId;
      idCell.z = '@';
    }
    const wage = ws[`F${excelRow}`];
    const contrib = ws[`G${excelRow}`];
    if (wage) wage.z = '#,##0.00';
    if (contrib) contrib.z = '#,##0.00';
  }
  const totalAddr = `G${params.rows.length + 3}`;
  const totalCell = ws[totalAddr];
  if (totalCell) totalCell.z = '#,##0.00';

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SSO');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const mm = String(params.monthMm).padStart(2, '0');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SSO-${params.yearCe + 543}-${mm}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
