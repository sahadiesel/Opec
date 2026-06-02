'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDateThaiBE, formatDateTimeThaiBE } from '@/lib/date-thai';

type ContractChangeLog = {
  id: string;
  actionType: string;
  changedFields?: string[];
  beforeSummary?: string;
  afterSummary?: string;
  actorUserId?: string;
  actorName?: string;
  eventAt: number;
};

interface ContractLogsTabProps {
  changeLogs: ContractChangeLog[] | null;
}

function formatValueByKey(key: string, value: any) {
  if (value === undefined || value === null || value === '') return '-';
  if ((key === 'startDate' || key === 'endDate') && typeof value === 'number') {
    return formatDateThaiBE(value);
  }
  if ((key === 'sellRate' || key === 'costBaseline') && typeof value === 'number') {
    return value.toLocaleString();
  }
  return String(value);
}

const fieldLabels: Record<string, string> = {
  title: 'ชื่อสัญญา',
  startDate: 'วันที่เริ่ม',
  endDate: 'วันที่สิ้นสุด',
  billingTerms: 'Billing Terms',
  paymentTerms: 'Payment Terms',
  notes: 'หมายเหตุ',
  positionId: 'ตำแหน่งงาน',
  sellRate: 'ราคาขาย',
  costBaseline: 'ราคาต้นทุน',
  normalWorkHours: 'ชั่วโมงงานปกติ (legacy)',
  normalWorkHoursOnshore: 'ชม.ปกติ Onshore',
  normalWorkHoursOffshore: 'ชม.ปกติ Offshore',
};

function formatDiffSummary(raw?: string) {
  if (!raw) return '-';
  try {
    const parsed = JSON.parse(raw) as Record<string, any>;
    const rows = Object.entries(parsed).map(([key, value]) => {
      const label = fieldLabels[key] || key;
      const formattedValue =
        (key === 'startDate' || key === 'endDate') && typeof value === 'number'
          ? formatDateThaiBE(value)
          : String(value ?? '-');
      return `${label}: ${formattedValue}`;
    });
    return rows.join('\n');
  } catch {
    return raw;
  }
}

function formatDiffPairs(beforeRaw?: string, afterRaw?: string) {
  if (!beforeRaw && !afterRaw) return '-';
  try {
    const beforeObj = beforeRaw ? (JSON.parse(beforeRaw) as Record<string, any>) : {};
    const afterObj = afterRaw ? (JSON.parse(afterRaw) as Record<string, any>) : {};
    const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
    const changedOnly = keys.filter((k) => JSON.stringify(beforeObj[k]) !== JSON.stringify(afterObj[k]));
    if (changedOnly.length === 0) return '-';
    return changedOnly
      .map((k) => `${fieldLabels[k] || k}: ${formatValueByKey(k, beforeObj[k])} -> ${formatValueByKey(k, afterObj[k])}`)
      .join('\n');
  } catch {
    return `${beforeRaw || '-'} -> ${afterRaw || '-'}`;
  }
}

export function ContractLogsTab({ changeLogs }: ContractLogsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>ประวัติการแก้ไขสัญญา (Contract Change Logs)</CardTitle>
        <CardDescription>บันทึกการแก้ไขราคา/วันสัญญา/การอนุมัติ พร้อมผู้ดำเนินการและค่าก่อน-หลัง</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เวลา</TableHead>
              <TableHead>ผู้แก้ไข</TableHead>
              <TableHead>ประเภท</TableHead>
              <TableHead>ฟิลด์ที่เปลี่ยน</TableHead>
              <TableHead>ก่อนแก้</TableHead>
              <TableHead>หลังแก้</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changeLogs?.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-xs whitespace-nowrap">{formatDateTimeThaiBE(log.eventAt)}</TableCell>
                <TableCell className="text-sm font-medium">{log.actorName || '-'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">{log.actionType}</Badge>
                </TableCell>
                <TableCell className="text-xs">{(log.changedFields || []).join(', ') || '-'}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[300px] whitespace-pre-wrap align-top">
                  {formatDiffPairs(log.beforeSummary, log.afterSummary)}
                </TableCell>
                <TableCell className="text-xs max-w-[300px] whitespace-pre-wrap align-top">
                  {formatDiffSummary(log.afterSummary)}
                </TableCell>
              </TableRow>
            ))}
            {!changeLogs?.length && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">
                  ยังไม่มีประวัติการแก้ไขสัญญา
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
