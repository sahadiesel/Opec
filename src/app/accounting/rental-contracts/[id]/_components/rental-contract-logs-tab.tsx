'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTimeThaiBE } from '@/lib/date-thai';

export type RentalContractChangeLog = {
  id: string;
  actionType: string;
  changedFields?: string[];
  beforeSummary?: string;
  afterSummary?: string;
  actorUserId?: string;
  actorName?: string;
  actorRoleKey?: string;
  eventAt: number;
};

const fieldLabels: Record<string, string> = {
  monthlyRentAmount: 'ค่าเช่า/เดือน (ก่อน VAT)',
  vatRatePercent: 'VAT %',
  vatSource: 'ที่มา VAT',
  withholdingTaxRatePercent: 'หัก ณ ที่จ่าย %',
  paymentDayOfMonth: 'วันครบกำหนดจ่าย',
  startDate: 'วันเริ่มสัญญา',
  endDate: 'วันสิ้นสุดสัญญา',
  notes: 'หมายเหตุ',
  madeAtLocation: 'ทำสัญญาที่',
  contractDate: 'วันที่ทำสัญญา',
  propertyAddress: 'ที่ตั้งทรัพย์สิน',
  propertyCategory: 'ประเภททรัพย์สิน',
  vehicleBrand: 'ยี่ห้อรถ',
  vehiclePlateNo: 'เลขทะเบียน',
  leaseDurationMonths: 'ระยะเวลาเช่า (เดือน)',
  advanceRentMonths: 'ค่าเช่าล่วงหน้า (เดือน)',
  securityDepositAmount: 'เงินประกัน',
  rentedItemDescription: 'รายละเอียดสิ่งที่เช่า',
};

function formatValueByKey(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (
    typeof value === 'number' &&
    (key === 'monthlyRentAmount' || key === 'securityDepositAmount')
  ) {
    return value.toLocaleString('th-TH', { minimumFractionDigits: 2 });
  }
  return String(value);
}

function formatDiffPairs(beforeRaw?: string, afterRaw?: string): string {
  if (!beforeRaw && !afterRaw) return '—';
  try {
    const beforeObj = beforeRaw ? (JSON.parse(beforeRaw) as Record<string, unknown>) : {};
    const afterObj = afterRaw ? (JSON.parse(afterRaw) as Record<string, unknown>) : {};
    const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
    const changedOnly = keys.filter((k) => JSON.stringify(beforeObj[k]) !== JSON.stringify(afterObj[k]));
    if (changedOnly.length === 0) return '—';
    return changedOnly
      .map(
        (k) =>
          `${fieldLabels[k] || k}: ${formatValueByKey(k, beforeObj[k])} → ${formatValueByKey(k, afterObj[k])}`,
      )
      .join('\n');
  } catch {
    return `${beforeRaw || '—'} → ${afterRaw || '—'}`;
  }
}

export function RentalContractLogsTab({
  changeLogs,
}: {
  changeLogs: RentalContractChangeLog[] | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>ประวัติการแก้ไขสัญญา</CardTitle>
        <CardDescription>
          บันทึกค่าก่อน–หลังเมื่อมีการแก้ไข พร้อมผู้ดำเนินการและเวลา
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">เวลา</TableHead>
              <TableHead>ผู้แก้ไข</TableHead>
              <TableHead>ประเภท</TableHead>
              <TableHead>รายละเอียดการเปลี่ยน</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(changeLogs ?? []).map((log) => (
              <TableRow key={log.id}>
                <TableCell className="pl-6 text-xs whitespace-nowrap">
                  {formatDateTimeThaiBE(log.eventAt)}
                </TableCell>
                <TableCell className="text-sm font-medium">
                  <div>{log.actorName || '—'}</div>
                  {log.actorRoleKey ? (
                    <div className="text-[10px] font-normal text-muted-foreground">{log.actorRoleKey}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">{log.actionType}</TableCell>
                <TableCell className="text-xs whitespace-pre-line">
                  {formatDiffPairs(log.beforeSummary, log.afterSummary)}
                </TableCell>
              </TableRow>
            ))}
            {(changeLogs?.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  ยังไม่มีประวัติการแก้ไข
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
