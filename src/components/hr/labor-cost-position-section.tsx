'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Wallet } from 'lucide-react';
import type { Position } from '@/lib/types';

type Props = {
  /** ค่าจริงบนหน้าจอ (หลัง merge edited + position) */
  displayOnshore: number | undefined;
  displayOffshore: number | undefined;
  isEditing: boolean;
  onPatch: (p: Pick<Position, 'defaultLaborCostOnshore' | 'defaultLaborCostOffshore'>) => void;
  canView: boolean;
  canEdit: boolean;
};

function numIn(v: number | undefined) {
  if (v == null || Number.isNaN(Number(v))) return '';
  return String(v);
}

function parseThaiMoneyInput(raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function LaborCostPositionSection({
  displayOnshore,
  displayOffshore,
  isEditing,
  onPatch,
  canView,
  canEdit,
}: Props) {
  if (!canView) return null;
  const disabled = !isEditing || !canEdit;
  const bothEmpty = displayOnshore == null && displayOffshore == null;
  return (
    <Card className="border-amber-200/60 bg-amber-50/30 shadow-sm">
      <CardHeader className="bg-amber-100/40 border-b border-amber-100/80">
        <div className="flex flex-wrap items-center gap-2">
          <Wallet className="h-5 w-5 text-amber-800" />
          <CardTitle className="text-lg text-amber-900">ต้นทุนค่าแรง (OPEC ฝั่งจ่าย)</CardTitle>
          <Badge variant="outline" className="text-[10px] border-amber-700/30 text-amber-900">
            ไม่อ้าง main contract / สัญญา
          </Badge>
        </div>
        <CardDescription className="text-amber-900/80">
          ฐานมาตรฐานต่อวันตามโหมดงาน (onshore / offshore) — รายคนที่ใช้ default ตำแหน่งจะยึดสองค่านี้
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label className="font-bold">ฐานออนชอร์ (Onshore) — บาท/วัน</Label>
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={disabled}
            placeholder="เช่น 1200"
            value={numIn(displayOnshore)}
            onChange={(e) => onPatch({ defaultLaborCostOnshore: parseThaiMoneyInput(e.target.value) })}
            className="font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label className="font-bold">ฐานออฟชอร์ (Offshore) — บาท/วัน</Label>
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={disabled}
            placeholder="เช่น 1500"
            value={numIn(displayOffshore)}
            onChange={(e) => onPatch({ defaultLaborCostOffshore: parseThaiMoneyInput(e.target.value) })}
            className="font-mono"
          />
        </div>
        {bothEmpty && canEdit && (
          <p className="text-sm text-amber-900/80 md:col-span-2">
            {!isEditing
              ? 'ยังไม่มีตัวเลขบน position — กด แก้ไขข้อมูลหลัก มุมขวาด้านบน แล้วกรอก หรือย้ายราคาเดิมจากสัญญาด้วยสคริปต์เฟส 1 ก่อนรันเฟส 5 ที่ลบ field ฝั่งสัญญา'
              : 'สัญญาเดิมมีแค่ตัวเลขเดียว (cost baseline) ระบบ backfill ใส่ onshore+offshore เท่ากัน คุณแก้แยกได้ที่นี่'}
          </p>
        )}
        {bothEmpty && !canEdit && (
          <p className="text-sm text-amber-900/70 md:col-span-2">ยังไม่ได้กำหนดฐาน — ต้องใช้บัญชี HR / Operations / Admin ที่กำหนดไว้ในระบบ</p>
        )}
      </CardContent>
    </Card>
  );
}
