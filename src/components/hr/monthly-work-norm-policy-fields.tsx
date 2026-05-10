'use client';

import type { ReactNode } from 'react';
import { Clock, Info, Scale } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  absenceLatePayrollRates,
  computeShiftWindowsLabels,
  computeWorkDayEndDisplay,
  type MonthlyWorkNormPolicyConfig,
} from '@/lib/hr/monthly-work-norm-policy';

export type MonthlyWorkNormPolicyFieldsProps = {
  disabled: boolean;
  workDaysPerMonth: number;
  onWorkDaysPerMonth: (v: number) => void;
  normalWorkHoursPerDay: number;
  onNormalWorkHoursPerDay: (v: number) => void;
  breakHoursPerDay: number;
  onBreakHoursPerDay: (v: number) => void;
  workStartTime: string;
  onWorkStartTime: (v: string) => void;
  breakStartTime: string;
  onBreakStartTime: (v: string) => void;
  lateGraceMinutes: number;
  onLateGraceMinutes: (v: number) => void;
  absenceDemoSalary: number;
  onAbsenceDemoSalary: (v: number) => void;
  /** แสดงคำอธิบายกติกา 3 ช่วง (สแกนเข้าหลังช่วงที่ 1 / 2) */
  showThreePeriodRules?: boolean;
  /** หมายเหตุด้านล่าง (เช่น ที่เก็บใน Firestore) */
  footerNote?: ReactNode;
};

export function MonthlyWorkNormPolicyFields({
  disabled,
  workDaysPerMonth,
  onWorkDaysPerMonth,
  normalWorkHoursPerDay,
  onNormalWorkHoursPerDay,
  breakHoursPerDay,
  onBreakHoursPerDay,
  workStartTime,
  onWorkStartTime,
  breakStartTime,
  onBreakStartTime,
  lateGraceMinutes,
  onLateGraceMinutes,
  absenceDemoSalary,
  onAbsenceDemoSalary,
  showThreePeriodRules,
  footerNote,
}: MonthlyWorkNormPolicyFieldsProps) {
  const preview: MonthlyWorkNormPolicyConfig = {
    standardWorkingDaysPerMonth: workDaysPerMonth,
    normalWorkingHoursPerDay: normalWorkHoursPerDay,
    breakHoursPerDay,
    workStartTime,
    breakStartTime,
    lateGraceMinutes,
  };
  const computedWorkEndLabel = computeWorkDayEndDisplay(preview);
  const shiftWindows = computeShiftWindowsLabels(preview);
  const absenceDemoRates = absenceLatePayrollRates(absenceDemoSalary, preview);

  return (
    <div className="rounded-lg border bg-muted/10 p-4 space-y-4">
      <p className="text-xs font-semibold text-muted-foreground tracking-wide flex items-center gap-2">
        <Clock className="h-4 w-4" /> นโยบายวันทำงานประจำเดือน · เวลาเข้า–ออก · กรอบสาย
      </p>

      {showThreePeriodRules && (
        <div className="rounded-md border border-dashed bg-background/80 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed space-y-1">
          <p className="font-semibold text-foreground">กติกาสแกนเข้า (เช้า — พัก — บ่าย)</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              <strong className="text-foreground">ช่วงที่ 1</strong> = ช่วงเช้า · สแกนเข้า<strong className="text-foreground">หลังจบช่วงที่ 1</strong>{' '}
              (เริ่มเวลาพัก) → <strong className="text-foreground">ขาดครึ่งวัน</strong>
            </li>
            <li>
              <strong className="text-foreground">ช่วงที่ 2</strong> = ช่วงบ่ายจนถึงเลิกงาน · สแกนเข้า<strong className="text-foreground">หลังเลิกงาน</strong>{' '}
              (หลังจบช่วงที่ 2) → <strong className="text-foreground">ขาดทั้งวัน</strong>
            </li>
            <li>
              ถ้าอยู่ในช่วงเช้าหรือบ่ายแต่<strong className="text-foreground">สายเกินนาทีผ่อนผัน</strong> → หักเป็นนาทีตาม (
              เงินเดือน ÷ วันทำงานที่กำหนด ÷ นาทีทำงานต่อวัน )
            </li>
            <li>
              มี<strong className="text-foreground">การอนุมัติแก้ไขเวลา</strong>แล้ว → ใช้เวลาตามที่แก้ในการคำนวณ
            </li>
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label className="text-muted-foreground">วันทำงานมาตรฐานต่อเดือน (วัน)</Label>
          <Input
            type="number"
            min={1}
            max={31}
            step={1}
            disabled={disabled}
            value={workDaysPerMonth}
            onChange={(e) => onWorkDaysPerMonth(Number(e.target.value))}
            className="font-mono max-w-[120px]"
          />
          <p className="text-[11px] text-muted-foreground leading-snug">
            ตัวอย่าง: 26 — ใช้หารเงินเดือนเป็นรายวัน (เช่น 26,000 ÷ 26 = 1,000/วัน) เพื่อหักขาด / ลาไม่จ่าย ฯลฯ
          </p>
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground">นาทีผ่อนผันสาย (นับจากเวลาเริ่มแต่ละช่วง)</Label>
          <Input
            type="number"
            min={0}
            max={120}
            step={1}
            disabled={disabled}
            value={lateGraceMinutes}
            onChange={(e) => onLateGraceMinutes(Number(e.target.value))}
            className="font-mono max-w-[120px]"
          />
          <p className="text-[11px] text-muted-foreground leading-snug">
            เช่น 5 นาที → ช่วงเช้าเริ่มนับสายตั้งแต่{' '}
            <span className="font-mono">{shiftWindows?.lateCutoff ?? '—'}</span> · ช่วงบ่ายเริ่มนับสายหลังเริ่มบ่าย +
            ผ่อนผันเท่ากัน
          </p>
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground">เวลาเริ่มงาน (ช่วงเช้า)</Label>
          <Input
            type="time"
            disabled={disabled}
            value={workStartTime}
            onChange={(e) => onWorkStartTime(e.target.value)}
            className="font-mono max-w-[140px]"
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground">เวลาเริ่มพัก (= จบช่วงเช้า / ช่วงที่ 1)</Label>
          <Input
            type="time"
            disabled={disabled}
            value={breakStartTime}
            onChange={(e) => onBreakStartTime(e.target.value)}
            className="font-mono max-w-[140px]"
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground">ชั่วโมงทำงานปกติต่อวัน (ไม่รวมพัก)</Label>
          <Input
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            disabled={disabled}
            value={normalWorkHoursPerDay}
            onChange={(e) => onNormalWorkHoursPerDay(Number(e.target.value))}
            className="font-mono max-w-[120px]"
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground">ชั่วโมงพักต่อวัน</Label>
          <Input
            type="number"
            min={0}
            max={24}
            step={0.25}
            disabled={disabled}
            value={breakHoursPerDay}
            onChange={(e) => onBreakHoursPerDay(Number(e.target.value))}
            className="font-mono max-w-[120px]"
          />
        </div>
      </div>

      <div className="rounded-md border bg-background px-3 py-2 text-sm space-y-1">
        <p className="text-xs font-semibold text-foreground">ตารางช่วงทำงาน (คำนวณจากค่าด้านบน)</p>
        <ul className="grid gap-1 sm:grid-cols-2 text-xs leading-snug">
          <li>
            ช่วงเช้า (ช่วงที่ 1 — ตัดสินขาดครึ่งวัน):{' '}
            <span className="font-mono">
              {shiftWindows ? `${shiftWindows.morningStart} – ${shiftWindows.morningEnd}` : '—'}
            </span>
          </li>
          <li>
            ช่วงพัก:{' '}
            <span className="font-mono">
              {shiftWindows ? `${shiftWindows.morningEnd} – ${shiftWindows.breakEnd}` : '—'}
            </span>
          </li>
          <li>
            ช่วงบ่าย (ช่วงที่ 2 — ถึงเลิกงาน):{' '}
            <span className="font-mono">
              {shiftWindows ? `${shiftWindows.breakEnd} – ${shiftWindows.afternoonEnd}` : '—'}
            </span>
          </li>
          <li>
            เลิกงาน (หลังจุดนี้ = ขาดทั้งวัน):{' '}
            <span className="font-mono">
              {computedWorkEndLabel === '—' ? '—' : `${computedWorkEndLabel} น.`}
            </span>
          </li>
          <li className="sm:col-span-2 text-muted-foreground">
            เวลาเริ่มคิดสายช่วงเช้า: <span className="font-mono">{shiftWindows?.lateCutoff ?? '—'}</span> · ทำงานปกติ{' '}
            {normalWorkHoursPerDay} ชม. ({Math.round(normalWorkHoursPerDay * 60)} นาที) · พัก {breakHoursPerDay} ชม.
          </li>
        </ul>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
        <p className="text-xs font-semibold text-foreground flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" /> ตัวอย่างการคำนวณหัก (รายวัน / รายนาที)
        </p>
        <div className="grid gap-2 sm:grid-cols-3 items-end">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">เงินเดือนสมมุติ (บาท)</Label>
            <Input
              type="number"
              min={0}
              step={500}
              disabled={disabled}
              value={absenceDemoSalary}
              onChange={(e) => onAbsenceDemoSalary(Number(e.target.value))}
              className="font-mono"
            />
          </div>
          <div className="space-y-1 text-xs">
            <p className="text-muted-foreground">รายวัน (เงินเดือน ÷ {workDaysPerMonth})</p>
            <p className="font-mono text-base font-bold tabular-nums text-primary">
              {absenceDemoRates.perDay.toLocaleString('th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              บาท/วัน
            </p>
          </div>
          <div className="space-y-1 text-xs">
            <p className="text-muted-foreground">
              รายนาที (รายวัน ÷ {absenceDemoRates.dailyMinutes} นาที — ทศนิยม 2 จุด)
            </p>
            <p className="font-mono text-base font-bold tabular-nums text-primary">
              {absenceDemoRates.perMinute.toLocaleString('th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              บาท/นาที
            </p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          ขาดงาน / ลาไม่จ่าย → หัก <span className="font-mono">รายวัน × จำนวนวัน</span> · สายในกรอบช่วง → หัก{' '}
          <span className="font-mono">รายนาที × นาทีที่สาย</span> (รวมกับกติกาขาดครึ่งวัน/ทั้งวันตามด้านบน)
        </p>
      </div>

      {footerNote && (
        <p className="text-xs text-muted-foreground flex gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{footerNote}</span>
        </p>
      )}
    </div>
  );
}
