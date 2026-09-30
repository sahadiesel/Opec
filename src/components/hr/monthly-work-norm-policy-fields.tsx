'use client';

import type { ReactNode } from 'react';
import { Clock, Info, Plus, Scale, Trash2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  absenceLatePayrollRates,
  computeShiftWindowsLabels,
  computeWorkDayEndDisplay,
  DEFAULT_OFFICE_LATE_PENALTY_BANDS,
  hmmAddMinutes,
  latePenaltyMinutesFromMinutesAfterStart,
  minutesAfterWorkStartFromHmm,
  type MonthlyWorkNormPolicyConfig,
  type OfficeLatePenaltyBand,
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
  latePenaltyBands: OfficeLatePenaltyBand[];
  onLatePenaltyBands: (v: OfficeLatePenaltyBand[]) => void;
  officeHolidayNormalWorkMultiplier: number;
  onOfficeHolidayNormalWorkMultiplier: (v: number) => void;
  officeWeekdayOvertimeMultiplier: number;
  onOfficeWeekdayOvertimeMultiplier: (v: number) => void;
  officeHolidayOvertimeMultiplier: number;
  onOfficeHolidayOvertimeMultiplier: (v: number) => void;
  absenceDemoSalary: number;
  onAbsenceDemoSalary: (v: number) => void;
  /** ซ่อนกล่องตัวอย่างการคำนวณ (แสดงที่อื่นแทน) */
  hideAbsenceDemo?: boolean;
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
  latePenaltyBands,
  onLatePenaltyBands,
  officeHolidayNormalWorkMultiplier,
  onOfficeHolidayNormalWorkMultiplier,
  officeWeekdayOvertimeMultiplier,
  onOfficeWeekdayOvertimeMultiplier,
  officeHolidayOvertimeMultiplier,
  onOfficeHolidayOvertimeMultiplier,
  absenceDemoSalary,
  onAbsenceDemoSalary,
  hideAbsenceDemo,
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
    latePenaltyBands,
    officeHolidayNormalWorkMultiplier,
    officeWeekdayOvertimeMultiplier,
    officeHolidayOvertimeMultiplier,
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
              ถ้าอยู่ในช่วงเช้าหรือบ่ายแต่<strong className="text-foreground">สายเกินนาทีผ่อนผัน</strong> → หักตามตารางช่วงสายด้านล่าง
              (นาทีที่หัก × เงินเดือนจริง ÷ วันทำงาน ÷ นาทีทำงานต่อวัน)
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
            ผ่อนผัน {lateGraceMinutes} นาที → ช่วงเช้าเริ่มนับสายตั้งแต่{' '}
            <span className="font-mono">{shiftWindows?.morningLateCutoff ?? '—'}</span> · ช่วงบ่ายเริ่มนับสายตั้งแต่{' '}
            <span className="font-mono">{shiftWindows?.afternoonLateCutoff ?? '—'}</span>
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
        <div className="rounded-md border bg-background px-3 py-3 space-y-3 sm:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">ตารางหักสายตามประกาศบริษัท</p>
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                ตั้งช่วงเวลาเข้างานและนาทีที่หัก — ยอดเงินหักใช้เงินเดือนจริงของแต่ละคน (เงินเดือน ÷ {workDaysPerMonth} วัน ÷{' '}
                {Math.round(normalWorkHoursPerDay * 60)} นาที)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onLatePenaltyBands(DEFAULT_OFFICE_LATE_PENALTY_BANDS.map((b) => ({ ...b })))}
              >
                ตามประกาศ HR
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  const last = latePenaltyBands[latePenaltyBands.length - 1];
                  const fromAfterStartMinutes = last ? last.toAfterStartMinutes + 1 : 1;
                  onLatePenaltyBands([
                    ...latePenaltyBands,
                    {
                      fromAfterStartMinutes,
                      toAfterStartMinutes: fromAfterStartMinutes + 4,
                      deductMinutes: last ? last.deductMinutes + 10 : 10,
                    },
                  ]);
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                เพิ่มช่วง
              </Button>
            </div>
          </div>

          {latePenaltyBands.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              ไม่มีช่วง — ระบบจะหักตามนาทีที่สายจริงหลังผ่อนผัน
            </p>
          ) : (
            <div className="space-y-2">
              <div className="hidden sm:grid grid-cols-[1fr_1fr_7rem_auto] gap-2 text-[11px] font-medium text-muted-foreground px-0.5">
                <span>ตั้งแต่</span>
                <span>ถึง</span>
                <span>นาทีที่หัก</span>
                <span />
              </div>
              {latePenaltyBands.map((band, idx) => (
                <div
                  key={`${band.fromAfterStartMinutes}-${idx}`}
                  className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem_auto] items-end"
                >
                  <div className="grid gap-1">
                    <Label className="sm:sr-only text-[11px] text-muted-foreground">ตั้งแต่</Label>
                    <Input
                      type="time"
                      disabled={disabled}
                      value={hmmAddMinutes(workStartTime, band.fromAfterStartMinutes)}
                      onChange={(e) => {
                        const mins = minutesAfterWorkStartFromHmm(workStartTime, e.target.value);
                        if (mins == null) return;
                        onLatePenaltyBands(
                          latePenaltyBands.map((b, i) =>
                            i === idx ? { ...b, fromAfterStartMinutes: mins } : b,
                          ),
                        );
                      }}
                      className="font-mono"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="sm:sr-only text-[11px] text-muted-foreground">ถึง</Label>
                    <Input
                      type="time"
                      disabled={disabled}
                      value={hmmAddMinutes(workStartTime, band.toAfterStartMinutes)}
                      onChange={(e) => {
                        const mins = minutesAfterWorkStartFromHmm(workStartTime, e.target.value);
                        if (mins == null) return;
                        onLatePenaltyBands(
                          latePenaltyBands.map((b, i) =>
                            i === idx ? { ...b, toAfterStartMinutes: mins } : b,
                          ),
                        );
                      }}
                      className="font-mono"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="sm:sr-only text-[11px] text-muted-foreground">นาทีที่หัก</Label>
                    <Input
                      type="number"
                      min={1}
                      max={480}
                      step={1}
                      disabled={disabled}
                      value={band.deductMinutes}
                      onChange={(e) => {
                        const n = Math.max(1, Math.round(Number(e.target.value) || 0));
                        onLatePenaltyBands(
                          latePenaltyBands.map((b, i) => (i === idx ? { ...b, deductMinutes: n } : b)),
                        );
                      }}
                      className="font-mono"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    className="h-9 w-9 text-muted-foreground"
                    onClick={() => onLatePenaltyBands(latePenaltyBands.filter((_, i) => i !== idx))}
                    aria-label="ลบช่วง"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <LatePenaltyExample
            workStartTime={workStartTime}
            lateGraceMinutes={lateGraceMinutes}
            latePenaltyBands={latePenaltyBands}
            perMinute={absenceDemoRates.perMinute}
          />
        </div>
        <div className="grid gap-3 sm:col-span-2 rounded-md border border-dashed bg-muted/40 px-3 py-3 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">
              A. ตัวคูณทำงานวันหยุด/อาทิตย์ (เวลาปกติ)
            </Label>
            <Input
              type="number"
              min={0.5}
              max={10}
              step={0.1}
              disabled={disabled}
              value={officeHolidayNormalWorkMultiplier}
              onChange={(e) => onOfficeHolidayNormalWorkMultiplier(Number(e.target.value))}
              className="font-mono max-w-[120px] bg-muted"
            />
            <p className="text-[11px] text-muted-foreground leading-snug">
              สแกน/OT ในช่วงเวลางานปกติของวันหยุด = (เงินเดือน ÷ {workDaysPerMonth} ÷ {normalWorkHoursPerDay}) ×{' '}
              {officeHolidayNormalWorkMultiplier} × ชม.
            </p>
          </div>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">B. ตัวคูณ OT วันทำงานปกติ</Label>
            <Input
              type="number"
              min={0.5}
              max={10}
              step={0.1}
              disabled={disabled}
              value={officeWeekdayOvertimeMultiplier}
              onChange={(e) => onOfficeWeekdayOvertimeMultiplier(Number(e.target.value))}
              className="font-mono max-w-[120px] bg-muted"
            />
            <p className="text-[11px] text-muted-foreground leading-snug">
              OT ก่อน/หลังเวลางานวันธรรมดา = (เงินเดือน ÷ {workDaysPerMonth} ÷ {normalWorkHoursPerDay}) ×{' '}
              {officeWeekdayOvertimeMultiplier} × ชม.
            </p>
          </div>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">C. ตัวคูณ OT วันหยุด/อาทิตย์</Label>
            <Input
              type="number"
              min={0.5}
              max={10}
              step={0.1}
              disabled={disabled}
              value={officeHolidayOvertimeMultiplier}
              onChange={(e) => onOfficeHolidayOvertimeMultiplier(Number(e.target.value))}
              className="font-mono max-w-[120px] bg-muted"
            />
            <p className="text-[11px] text-muted-foreground leading-snug">
              OT นอกเวลางานปกติในวันหยุด (เช่น หลัง {shiftWindows?.afternoonEnd ?? '17:00'}) = (เงินเดือน ÷{' '}
              {workDaysPerMonth} ÷ {normalWorkHoursPerDay}) × {officeHolidayOvertimeMultiplier} × ชม.
            </p>
          </div>
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
            เริ่มคิดสายช่วงเช้า: <span className="font-mono">{shiftWindows?.morningLateCutoff ?? '—'}</span> · เริ่มคิดสายช่วงบ่าย:{' '}
            <span className="font-mono">{shiftWindows?.afternoonLateCutoff ?? '—'}</span> · ทำงานปกติ{' '}
            {normalWorkHoursPerDay} ชม. ({Math.round(normalWorkHoursPerDay * 60)} นาที) · พัก {breakHoursPerDay} ชม.
          </li>
        </ul>
      </div>

      {!hideAbsenceDemo ? (
        <MonthlyWorkNormAbsenceDemo
          disabled={disabled}
          workDaysPerMonth={workDaysPerMonth}
          absenceDemoSalary={absenceDemoSalary}
          onAbsenceDemoSalary={onAbsenceDemoSalary}
          absenceDemoRates={absenceDemoRates}
        />
      ) : null}

      {footerNote && (
        <p className="text-xs text-muted-foreground flex gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{footerNote}</span>
        </p>
      )}
    </div>
  );
}

function LatePenaltyExample({
  workStartTime,
  lateGraceMinutes,
  latePenaltyBands,
  perMinute,
}: {
  workStartTime: string;
  lateGraceMinutes: number;
  latePenaltyBands: OfficeLatePenaltyBand[];
  perMinute: number;
}) {
  const exampleClock = hmmAddMinutes(workStartTime, 3);
  const afterStart = minutesAfterWorkStartFromHmm(workStartTime, exampleClock) ?? 3;
  const penaltyMin = latePenaltyMinutesFromMinutesAfterStart(afterStart, {
    lateGraceMinutes,
    latePenaltyBands,
  });
  const amount = Math.round(penaltyMin * perMinute * 100) / 100;
  return (
    <p className="text-[11px] text-muted-foreground leading-snug rounded-md bg-muted/50 px-2 py-1.5">
      ตัวอย่าง: เข้า {exampleClock} น. (สาย {afterStart} นาที) → หัก {penaltyMin} นาที ={' '}
      <span className="font-mono font-semibold text-foreground">
        {amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
      </span>{' '}
      จากฐานเงินเดือนในกล่องตัวอย่างด้านขวา — พนักงานแต่ละคนใช้เงินเดือนของตนเอง
    </p>
  );
}

export function MonthlyWorkNormAbsenceDemo({
  disabled,
  workDaysPerMonth,
  absenceDemoSalary,
  onAbsenceDemoSalary,
  absenceDemoRates,
}: {
  disabled: boolean;
  workDaysPerMonth: number;
  absenceDemoSalary: number;
  onAbsenceDemoSalary: (v: number) => void;
  absenceDemoRates?: ReturnType<typeof absenceLatePayrollRates>;
}) {
  const rates =
    absenceDemoRates ??
    absenceLatePayrollRates(absenceDemoSalary, {
      standardWorkingDaysPerMonth: workDaysPerMonth,
      normalWorkingHoursPerDay: 8,
      breakHoursPerDay: 1,
      workStartTime: '08:00',
    });

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 h-fit">
      <p className="text-xs font-semibold text-foreground flex items-center gap-2">
        <Scale className="h-4 w-4 text-primary" /> ตัวอย่างการคำนวณหัก (รายวัน / รายนาที)
      </p>
      <div className="space-y-3">
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
            {rates.perDay.toLocaleString('th-TH', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            บาท/วัน
          </p>
        </div>
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">
            รายนาที (รายวัน ÷ {rates.dailyMinutes} นาที — ทศนิยม 2 จุด)
          </p>
          <p className="font-mono text-base font-bold tabular-nums text-primary">
            {rates.perMinute.toLocaleString('th-TH', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            บาท/นาที
          </p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        ขาดงาน / ลาไม่จ่าย → หัก <span className="font-mono">รายวัน × จำนวนวัน</span> · สายตามตารางช่วง → หัก{' '}
        <span className="font-mono">รายนาที × นาทีที่หักตามช่วง</span> จากเงินเดือนจริงของคนนั้น
      </p>
    </div>
  );
}
