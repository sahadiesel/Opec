'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

type StoreItemConsumableFieldProps = {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export function StoreItemConsumableField({ id, checked, onCheckedChange }: StoreItemConsumableFieldProps) {
  return (
    <div className="flex flex-row items-start gap-2 col-span-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(!!v)} className="mt-0.5" />
      <div className="grid gap-0.5 leading-snug">
        <Label htmlFor={id} className="font-normal cursor-pointer">
          วัสดุสิ้นเปลือง
        </Label>
        <p className="text-[11px] text-muted-foreground">
          เบิกแล้วใช้หมด ตัดสต็อก — ไม่ติดตามรับคืน (ไม่ติ๊ก = ของที่ต้องคืน)
        </p>
      </div>
    </div>
  );
}
