'use client';

import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EquipmentRentalContractDetailInput } from '@/lib/services/equipment-rental-contract-service';

export type EquipmentRentalLineDraft = {
  description: string;
  brand: string;
  serialNumber: string;
  size: string;
  horsepower: string;
  quantity: string;
  unitPrice: string;
  unit: string;
  ratePeriod: 'DAY' | 'MONTH';
};

export type EquipmentRentalDetailsDraft = {
  madeAtTambon: string;
  madeAtAmphoe: string;
  madeAtProvince: string;
  contractDate: string;
  lesseeAuthorizedSignatory: string;
  lesseeCertificateDate: string;
  customerAddressSnapshot: string;
  customerTaxIdSnapshot: string;
  lessorName: string;
  lessorAddress: string;
  lessorTaxId: string;
  lessorAuthorizedSignatory: string;
  insuranceClass: string;
  rentalDurationValue: string;
  rentalDurationUnit: 'DAY' | 'MONTH';
  appendix1Pages: string;
  appendix2Pages: string;
  appendix3Pages: string;
  invoiceLeadWorkingDays: string;
  bankName: string;
  bankBranch: string;
  bankAccountName: string;
  bankAccountNumber: string;
  interruptionThresholdDays: string;
  storageReturnNoticeDays: string;
  maxEquipmentAgeYears: string;
  deliveryLocation: string;
  deliveryDate: string;
  deliveryNoticeWorkingDays: string;
  replacementDeliveryDays: string;
  repairCorrectionDays: string;
  replacementPenaltyPerDay: string;
  maxReplacementDelayDays: string;
  relocationNoticeDays: string;
  performanceBondType: string;
  performanceBondAmount: string;
  performanceBondPercent: string;
  performanceBondTopUpDays: string;
  lossReplacementDays: string;
  alternateRentalWindowValue: string;
  alternateRentalWindowUnit: 'DAY' | 'MONTH';
  lateDeliveryPenaltyPerDay: string;
  penaltyDebtPayDays: string;
  equipmentReturnDays: string;
  addressChangeNoticeDays: string;
  witness1Name: string;
  witness2Name: string;
};

export function emptyEquipmentRentalDetailsDraft(
  overrides?: Partial<EquipmentRentalDetailsDraft>,
): EquipmentRentalDetailsDraft {
  return {
    madeAtTambon: '',
    madeAtAmphoe: '',
    madeAtProvince: '',
    contractDate: '',
    lesseeAuthorizedSignatory: '',
    lesseeCertificateDate: '',
    customerAddressSnapshot: '',
    customerTaxIdSnapshot: '',
    lessorName: 'บริษัท โอเปค เอ็นจิเนียริ่ง แอนด์ แมนเนจเม้นท์ จำกัด',
    lessorAddress: '',
    lessorTaxId: '',
    lessorAuthorizedSignatory: '',
    insuranceClass: '',
    rentalDurationValue: '',
    rentalDurationUnit: 'MONTH',
    appendix1Pages: '',
    appendix2Pages: '',
    appendix3Pages: '',
    invoiceLeadWorkingDays: '7',
    bankName: '',
    bankBranch: '',
    bankAccountName: '',
    bankAccountNumber: '',
    interruptionThresholdDays: '',
    storageReturnNoticeDays: '',
    maxEquipmentAgeYears: '',
    deliveryLocation: '',
    deliveryDate: '',
    deliveryNoticeWorkingDays: '',
    replacementDeliveryDays: '',
    repairCorrectionDays: '',
    replacementPenaltyPerDay: '',
    maxReplacementDelayDays: '',
    relocationNoticeDays: '',
    performanceBondType: '',
    performanceBondAmount: '',
    performanceBondPercent: '',
    performanceBondTopUpDays: '',
    lossReplacementDays: '',
    alternateRentalWindowValue: '',
    alternateRentalWindowUnit: 'DAY',
    lateDeliveryPenaltyPerDay: '',
    penaltyDebtPayDays: '15',
    equipmentReturnDays: '',
    addressChangeNoticeDays: '',
    witness1Name: '',
    witness2Name: '',
    ...overrides,
  };
}

export function emptyEquipmentRentalLineDraft(): EquipmentRentalLineDraft {
  return {
    description: '',
    brand: '',
    serialNumber: '',
    size: '',
    horsepower: '',
    quantity: '1',
    unitPrice: '',
    unit: 'คัน/เครื่อง',
    ratePeriod: 'MONTH',
  };
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function detailsDraftToInput(d: EquipmentRentalDetailsDraft): EquipmentRentalContractDetailInput {
  return {
    madeAtTambon: d.madeAtTambon || null,
    madeAtAmphoe: d.madeAtAmphoe || null,
    madeAtProvince: d.madeAtProvince || null,
    contractDate: d.contractDate || null,
    lesseeAuthorizedSignatory: d.lesseeAuthorizedSignatory || null,
    lesseeCertificateDate: d.lesseeCertificateDate || null,
    customerAddressSnapshot: d.customerAddressSnapshot || null,
    customerTaxIdSnapshot: d.customerTaxIdSnapshot || null,
    lessorName: d.lessorName || null,
    lessorAddress: d.lessorAddress || null,
    lessorTaxId: d.lessorTaxId || null,
    lessorAuthorizedSignatory: d.lessorAuthorizedSignatory || null,
    insuranceClass: d.insuranceClass || null,
    rentalDurationValue: numOrNull(d.rentalDurationValue),
    rentalDurationUnit: d.rentalDurationUnit,
    appendix1Pages: numOrNull(d.appendix1Pages),
    appendix2Pages: numOrNull(d.appendix2Pages),
    appendix3Pages: numOrNull(d.appendix3Pages),
    invoiceLeadWorkingDays: numOrNull(d.invoiceLeadWorkingDays),
    bankName: d.bankName || null,
    bankBranch: d.bankBranch || null,
    bankAccountName: d.bankAccountName || null,
    bankAccountNumber: d.bankAccountNumber || null,
    interruptionThresholdDays: numOrNull(d.interruptionThresholdDays),
    storageReturnNoticeDays: numOrNull(d.storageReturnNoticeDays),
    maxEquipmentAgeYears: numOrNull(d.maxEquipmentAgeYears),
    deliveryLocation: d.deliveryLocation || null,
    deliveryDate: d.deliveryDate || null,
    deliveryNoticeWorkingDays: numOrNull(d.deliveryNoticeWorkingDays),
    replacementDeliveryDays: numOrNull(d.replacementDeliveryDays),
    repairCorrectionDays: numOrNull(d.repairCorrectionDays),
    replacementPenaltyPerDay: numOrNull(d.replacementPenaltyPerDay),
    maxReplacementDelayDays: numOrNull(d.maxReplacementDelayDays),
    relocationNoticeDays: numOrNull(d.relocationNoticeDays),
    performanceBondType: d.performanceBondType || null,
    performanceBondAmount: numOrNull(d.performanceBondAmount),
    performanceBondPercent: numOrNull(d.performanceBondPercent),
    performanceBondTopUpDays: numOrNull(d.performanceBondTopUpDays),
    lossReplacementDays: numOrNull(d.lossReplacementDays),
    alternateRentalWindowValue: numOrNull(d.alternateRentalWindowValue),
    alternateRentalWindowUnit: d.alternateRentalWindowUnit,
    lateDeliveryPenaltyPerDay: numOrNull(d.lateDeliveryPenaltyPerDay),
    penaltyDebtPayDays: numOrNull(d.penaltyDebtPayDays),
    equipmentReturnDays: numOrNull(d.equipmentReturnDays),
    addressChangeNoticeDays: numOrNull(d.addressChangeNoticeDays),
    witness1Name: d.witness1Name || null,
    witness2Name: d.witness2Name || null,
  };
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className || ''}`}>
      <Label className="text-[10px] text-muted-foreground font-medium leading-tight">{label}</Label>
      {children}
    </div>
  );
}

export function EquipmentRentalLineItemsEditor({
  lines,
  onChange,
}: {
  lines: EquipmentRentalLineDraft[];
  onChange: (next: EquipmentRentalLineDraft[]) => void;
}) {
  const update = (idx: number, patch: Partial<EquipmentRentalLineDraft>) => {
    onChange(lines.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  return (
    <div className="space-y-2">
      {lines.map((line, idx) => (
        <div key={idx} className="rounded border bg-muted/20 p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">รายการที่ {idx + 1}</span>
            {lines.length > 1 && (
              <button
                type="button"
                className="text-[10px] text-destructive hover:underline"
                onClick={() => onChange(lines.filter((_, i) => i !== idx))}
              >
                ลบ
              </button>
            )}
          </div>
          <div className="grid grid-cols-12 gap-1.5">
            <Field label="ชนิดเครื่องจักรกล" className="col-span-6">
              <Input
                className="h-8 text-xs"
                value={line.description}
                onChange={(e) => update(idx, { description: e.target.value })}
                placeholder="ชนิด / ชื่อ"
              />
            </Field>
            <Field label="ยี่ห้อ" className="col-span-3">
              <Input
                className="h-8 text-xs"
                value={line.brand}
                onChange={(e) => update(idx, { brand: e.target.value })}
              />
            </Field>
            <Field label="หมายเลข" className="col-span-3">
              <Input
                className="h-8 text-xs"
                value={line.serialNumber}
                onChange={(e) => update(idx, { serialNumber: e.target.value })}
              />
            </Field>
            <Field label="ขนาด" className="col-span-2">
              <Input
                className="h-8 text-xs"
                value={line.size}
                onChange={(e) => update(idx, { size: e.target.value })}
              />
            </Field>
            <Field label="แรงม้า" className="col-span-2">
              <Input
                className="h-8 text-xs"
                value={line.horsepower}
                onChange={(e) => update(idx, { horsepower: e.target.value })}
              />
            </Field>
            <Field label="จำนวน" className="col-span-2">
              <Input
                className="h-8 text-xs"
                value={line.quantity}
                onChange={(e) => update(idx, { quantity: e.target.value })}
              />
            </Field>
            <Field label="หน่วย" className="col-span-2">
              <Input
                className="h-8 text-xs"
                value={line.unit}
                onChange={(e) => update(idx, { unit: e.target.value })}
              />
            </Field>
            <Field label="วัน/เดือน" className="col-span-2">
              <Select
                value={line.ratePeriod}
                onValueChange={(v) => update(idx, { ratePeriod: v as 'DAY' | 'MONTH' })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTH">เดือน</SelectItem>
                  <SelectItem value="DAY">วัน</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="ราคา/หน่วย" className="col-span-2">
              <Input
                className="h-8 text-xs"
                value={line.unitPrice}
                onChange={(e) => update(idx, { unitPrice: e.target.value })}
              />
            </Field>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EquipmentRentalContractDetailsFields({
  value,
  onChange,
}: {
  value: EquipmentRentalDetailsDraft;
  onChange: (next: EquipmentRentalDetailsDraft) => void;
}) {
  const set = <K extends keyof EquipmentRentalDetailsDraft>(key: K, v: EquipmentRentalDetailsDraft[K]) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold text-primary">รายละเอียดตามแบบสัญญาเช่าเครื่องจักรกล</p>

      <div className="grid grid-cols-3 gap-2">
        <Field label="ทำที่ — ตำบล/แขวง">
          <Input className="h-8 text-xs" value={value.madeAtTambon} onChange={(e) => set('madeAtTambon', e.target.value)} />
        </Field>
        <Field label="อำเภอ/เขต">
          <Input className="h-8 text-xs" value={value.madeAtAmphoe} onChange={(e) => set('madeAtAmphoe', e.target.value)} />
        </Field>
        <Field label="จังหวัด">
          <Input className="h-8 text-xs" value={value.madeAtProvince} onChange={(e) => set('madeAtProvince', e.target.value)} />
        </Field>
        <Field label="วันที่ทำสัญญา">
          <Input type="date" className="h-8 text-xs" value={value.contractDate} onChange={(e) => set('contractDate', e.target.value)} />
        </Field>
        <Field label="ระยะเวลาเช่า (ตัวเลข)">
          <Input className="h-8 text-xs" value={value.rentalDurationValue} onChange={(e) => set('rentalDurationValue', e.target.value)} />
        </Field>
        <Field label="หน่วยระยะเวลา">
          <Select
            value={value.rentalDurationUnit}
            onValueChange={(v) => set('rentalDurationUnit', v as 'DAY' | 'MONTH')}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MONTH">เดือน</SelectItem>
              <SelectItem value="DAY">วัน</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="ที่อยู่ผู้เช่า (snapshot)">
          <Input
            className="h-8 text-xs"
            value={value.customerAddressSnapshot}
            onChange={(e) => set('customerAddressSnapshot', e.target.value)}
          />
        </Field>
        <Field label="เลขผู้เสียภาษีผู้เช่า">
          <Input
            className="h-8 text-xs"
            value={value.customerTaxIdSnapshot}
            onChange={(e) => set('customerTaxIdSnapshot', e.target.value)}
          />
        </Field>
        <Field label="ผู้มีอำนาจลงนาม (ผู้เช่า)">
          <Input
            className="h-8 text-xs"
            value={value.lesseeAuthorizedSignatory}
            onChange={(e) => set('lesseeAuthorizedSignatory', e.target.value)}
          />
        </Field>
        <Field label="วันที่หนังสือรับรองผู้เช่า">
          <Input
            type="date"
            className="h-8 text-xs"
            value={value.lesseeCertificateDate}
            onChange={(e) => set('lesseeCertificateDate', e.target.value)}
          />
        </Field>
      </div>

      <div className="rounded border border-dashed bg-muted/30 px-3 py-2 space-y-1">
        <p className="text-[11px] font-semibold text-primary">ผู้ให้เช่า (ดึงจากระบบอัตโนมัติ)</p>
        <p className="text-xs font-medium">{value.lessorName || '—'}</p>
        <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">
          {value.lessorAddress || 'ยังไม่มีที่อยู่ใน Document Header Profile'}
        </p>
        {value.lessorTaxId ? (
          <p className="text-[11px] text-muted-foreground">เลขผู้เสียภาษี {value.lessorTaxId}</p>
        ) : null}
        {value.lessorAuthorizedSignatory ? (
          <p className="text-[11px] text-muted-foreground">
            ผู้มีอำนาจลงนาม {value.lessorAuthorizedSignatory}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Field label="ประกันภัย ประเภทชั้น">
          <Input className="h-8 text-xs" value={value.insuranceClass} onChange={(e) => set('insuranceClass', e.target.value)} />
        </Field>
        <Field label="ผนวก ๑ (แผ่น)">
          <Input className="h-8 text-xs" value={value.appendix1Pages} onChange={(e) => set('appendix1Pages', e.target.value)} />
        </Field>
        <Field label="ผนวก ๒ (แผ่น)">
          <Input className="h-8 text-xs" value={value.appendix2Pages} onChange={(e) => set('appendix2Pages', e.target.value)} />
        </Field>
        <Field label="ผนวก ๓ (แผ่น)">
          <Input className="h-8 text-xs" value={value.appendix3Pages} onChange={(e) => set('appendix3Pages', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Field label="ส่งใบแจ้งหนี้ล่วงหน้า (วันทำการ)">
          <Input
            className="h-8 text-xs"
            value={value.invoiceLeadWorkingDays}
            onChange={(e) => set('invoiceLeadWorkingDays', e.target.value)}
          />
        </Field>
        <Field label="ธนาคาร">
          <Input className="h-8 text-xs" value={value.bankName} onChange={(e) => set('bankName', e.target.value)} />
        </Field>
        <Field label="สาขา">
          <Input className="h-8 text-xs" value={value.bankBranch} onChange={(e) => set('bankBranch', e.target.value)} />
        </Field>
        <Field label="ชื่อบัญชี">
          <Input className="h-8 text-xs" value={value.bankAccountName} onChange={(e) => set('bankAccountName', e.target.value)} />
        </Field>
        <Field label="เลขที่บัญชี" className="col-span-2">
          <Input
            className="h-8 text-xs"
            value={value.bankAccountNumber}
            onChange={(e) => set('bankAccountNumber', e.target.value)}
          />
        </Field>
        <Field label="หยุดชะงักงดค่าเช่า (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.interruptionThresholdDays}
            onChange={(e) => set('interruptionThresholdDays', e.target.value)}
          />
        </Field>
        <Field label="แจ้งส่งมอบจากคลัง (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.storageReturnNoticeDays}
            onChange={(e) => set('storageReturnNoticeDays', e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Field label="อายุเครื่องไม่เกิน (ปี)">
          <Input
            className="h-8 text-xs"
            value={value.maxEquipmentAgeYears}
            onChange={(e) => set('maxEquipmentAgeYears', e.target.value)}
          />
        </Field>
        <Field label="สถานที่ส่งมอบ" className="col-span-2">
          <Input
            className="h-8 text-xs"
            value={value.deliveryLocation}
            onChange={(e) => set('deliveryLocation', e.target.value)}
          />
        </Field>
        <Field label="วันที่ส่งมอบ">
          <Input type="date" className="h-8 text-xs" value={value.deliveryDate} onChange={(e) => set('deliveryDate', e.target.value)} />
        </Field>
        <Field label="แจ้งส่งมอบล่วงหน้า (วันทำการ)">
          <Input
            className="h-8 text-xs"
            value={value.deliveryNoticeWorkingDays}
            onChange={(e) => set('deliveryNoticeWorkingDays', e.target.value)}
          />
        </Field>
        <Field label="ส่งเครื่องใหม่ (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.replacementDeliveryDays}
            onChange={(e) => set('replacementDeliveryDays', e.target.value)}
          />
        </Field>
        <Field label="แก้ไขให้ถูก (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.repairCorrectionDays}
            onChange={(e) => set('repairCorrectionDays', e.target.value)}
          />
        </Field>
        <Field label="ค่าปรับไม่จัดทดแทน/วัน">
          <Input
            className="h-8 text-xs"
            value={value.replacementPenaltyPerDay}
            onChange={(e) => set('replacementPenaltyPerDay', e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Field label="บอกเลิกถ้าไม่ทดแทนเกิน (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.maxReplacementDelayDays}
            onChange={(e) => set('maxReplacementDelayDays', e.target.value)}
          />
        </Field>
        <Field label="แจ้งขนย้ายล่วงหน้า (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.relocationNoticeDays}
            onChange={(e) => set('relocationNoticeDays', e.target.value)}
          />
        </Field>
        <Field label="ประเภทหลักประกัน">
          <Input
            className="h-8 text-xs"
            value={value.performanceBondType}
            onChange={(e) => set('performanceBondType', e.target.value)}
            placeholder="เงินสด / LG"
          />
        </Field>
        <Field label="จำนวนหลักประกัน (บาท)">
          <Input
            className="h-8 text-xs"
            value={value.performanceBondAmount}
            onChange={(e) => set('performanceBondAmount', e.target.value)}
          />
        </Field>
        <Field label="หลักประกัน % ของค่าเช่า">
          <Input
            className="h-8 text-xs"
            value={value.performanceBondPercent}
            onChange={(e) => set('performanceBondPercent', e.target.value)}
          />
        </Field>
        <Field label="เติมหลักประกันภายใน (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.performanceBondTopUpDays}
            onChange={(e) => set('performanceBondTopUpDays', e.target.value)}
          />
        </Field>
        <Field label="เปลี่ยนเครื่องสูญหาย (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.lossReplacementDays}
            onChange={(e) => set('lossReplacementDays', e.target.value)}
          />
        </Field>
        <Field label="ค่าปรับส่งมอบล่าช้า/วัน">
          <Input
            className="h-8 text-xs"
            value={value.lateDeliveryPenaltyPerDay}
            onChange={(e) => set('lateDeliveryPenaltyPerDay', e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Field label="ชำระค่าปรับภายใน (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.penaltyDebtPayDays}
            onChange={(e) => set('penaltyDebtPayDays', e.target.value)}
          />
        </Field>
        <Field label="นำเครื่องกลับคืน (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.equipmentReturnDays}
            onChange={(e) => set('equipmentReturnDays', e.target.value)}
          />
        </Field>
        <Field label="แจ้งเปลี่ยนที่อยู่ (วัน)">
          <Input
            className="h-8 text-xs"
            value={value.addressChangeNoticeDays}
            onChange={(e) => set('addressChangeNoticeDays', e.target.value)}
          />
        </Field>
        <Field label="เช่าทดแทนหลังบอกเลิก (ตัวเลข)">
          <Input
            className="h-8 text-xs"
            value={value.alternateRentalWindowValue}
            onChange={(e) => set('alternateRentalWindowValue', e.target.value)}
          />
        </Field>
        <Field label="หน่วยช่วงเช่าทดแทน">
          <Select
            value={value.alternateRentalWindowUnit}
            onValueChange={(v) => set('alternateRentalWindowUnit', v as 'DAY' | 'MONTH')}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DAY">วัน</SelectItem>
              <SelectItem value="MONTH">เดือน</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="พยาน 1">
          <Input className="h-8 text-xs" value={value.witness1Name} onChange={(e) => set('witness1Name', e.target.value)} />
        </Field>
        <Field label="พยาน 2">
          <Input className="h-8 text-xs" value={value.witness2Name} onChange={(e) => set('witness2Name', e.target.value)} />
        </Field>
      </div>
    </div>
  );
}
