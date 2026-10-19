'use client';

import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatDateTimeThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';
import {
  EMPLOYMENT_END_REASONS,
  formatEmploymentEndReasonDisplay,
  seedEmploymentTenures,
  type EmploymentEndReason,
  type EmploymentTenure,
} from '@/lib/hr/employment-tenure';
import { normalizeStaffDateYmd } from '@/lib/payroll/office-staff-date-ymd';

export function EmploymentTenureFields({
  startDate,
  endDate,
  endReason,
  endReasonNote,
  tenures,
  legacyStart,
  legacyEnd,
  disabled,
  onChange,
}: {
  startDate: string;
  endDate: string;
  endReason: EmploymentEndReason | '';
  endReasonNote: string;
  tenures?: EmploymentTenure[] | null;
  legacyStart?: unknown;
  legacyEnd?: unknown;
  disabled?: boolean;
  onChange: (patch: {
    startDate: string;
    endDate: string;
    endReason: EmploymentEndReason | '';
    endReasonNote: string;
  }) => void;
}) {
  const history = seedEmploymentTenures(tenures, legacyStart, legacyEnd);
  const latest = history[history.length - 1];
  const startYmd = normalizeStaffDateYmd(startDate) || '';
  const endYmd = normalizeStaffDateYmd(endDate) || '';
  const willOpenNewCycle = Boolean(latest?.endDate && startYmd && startYmd > latest.endDate);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <div className="space-y-2">
          <Label className="font-bold">วันที่เริ่มงาน</Label>
          <DatePickerThaiBE
            className="h-10"
            disabled={disabled}
            value={startDate ? htmlDateValueToTimestampMs(startDate) : undefined}
            onChange={(ms) => {
              const nextStart = ms ? timestampToHtmlDateValue(ms) : '';
              const nextYmd = normalizeStaffDateYmd(nextStart) || '';
              const opensNewCycle = Boolean(latest?.endDate && nextYmd && nextYmd > latest.endDate);
              onChange({
                startDate: nextStart,
                endDate: opensNewCycle ? '' : endDate,
                endReason: opensNewCycle ? '' : endReason,
                endReasonNote: opensNewCycle ? '' : endReasonNote,
              });
            }}
          />
        </div>
        <div className="space-y-2">
          <Label className="font-bold">วันที่สิ้นสุดการทำงาน</Label>
          <DatePickerThaiBE
            className="h-10"
            placeholder="ยังไม่ระบุ"
            allowClear
            disabled={disabled}
            onClear={() => onChange({ startDate, endDate: '', endReason: '', endReasonNote: '' })}
            value={endDate ? htmlDateValueToTimestampMs(endDate) : undefined}
            onChange={(ms) => {
              const nextEnd = ms ? timestampToHtmlDateValue(ms) : '';
              onChange({
                startDate,
                endDate: nextEnd,
                endReason: nextEnd ? endReason : '',
                endReasonNote: nextEnd ? endReasonNote : '',
              });
            }}
          />
        </div>
      </div>
      {endYmd ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="font-bold">เหตุผลการสิ้นสุดการทำงาน</Label>
            <Select
              disabled={disabled}
              value={endReason || undefined}
              onValueChange={(v) =>
                onChange({
                  startDate,
                  endDate,
                  endReason: v as EmploymentEndReason,
                  endReasonNote: v === 'OTHER' ? endReasonNote : '',
                })
              }
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="เลือกเหตุผล" />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_END_REASONS.map((o) => (
                  <SelectItem key={o.code} value={o.code}>
                    {o.labelTh}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {endReason === 'OTHER' ? (
            <div className="space-y-2">
              <Label className="font-bold">รายละเอียดเหตุผล</Label>
              <Textarea
                disabled={disabled}
                value={endReasonNote}
                onChange={(e) =>
                  onChange({ startDate, endDate, endReason, endReasonNote: e.target.value })
                }
                className="min-h-[40px]"
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {willOpenNewCycle ? (
        <p className="text-xs text-primary">
          วันเริ่มนี้อยู่หลังรอบที่สิ้นสุดแล้ว เมื่อบันทึกจะเปิดรอบใหม่ และรอบก่อนหน้ายังอยู่ในประวัติ
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          ทุกครั้งที่เริ่มงานหรือสิ้นสุดงานจะถูกเก็บเป็นประวัติ พร้อมเหตุผลและชื่อผู้บันทึก ไม่เขียนทับรอบเก่า
        </p>
      )}
      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">ครั้ง</TableHead>
              <TableHead>เริ่มงาน</TableHead>
              <TableHead>สิ้นสุด</TableHead>
              <TableHead>เหตุผล</TableHead>
              <TableHead>ผู้บันทึก</TableHead>
              <TableHead>บันทึกเมื่อ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-muted-foreground">
                  ยังไม่มีประวัติการเริ่มงานและสิ้นสุดงาน
                </TableCell>
              </TableRow>
            ) : (
              history.map((row, index) => (
                <TableRow key={row.id || index}>
                  <TableCell className="font-mono text-xs">{index + 1}</TableCell>
                  <TableCell>{formatYmdLocalThaiBE(row.startDate)}</TableCell>
                  <TableCell>{row.endDate ? formatYmdLocalThaiBE(row.endDate) : '—'}</TableCell>
                  <TableCell>{formatEmploymentEndReasonDisplay(row.endReason, row.endReasonNote) || '—'}</TableCell>
                  <TableCell>{row.recordedByName || '—'}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {row.recordedAt ? formatDateTimeThaiBE(row.recordedAt) : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
