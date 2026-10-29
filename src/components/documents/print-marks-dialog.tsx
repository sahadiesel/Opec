'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function PrintMarksChoices({
  includePreparerSignature,
  includeAuthorizedSignature,
  includeStamp,
  onPreparerSignature,
  onAuthorizedSignature,
  onStamp,
  preparerReady,
  preparerName,
  authorizedReady,
  authorizedName,
  stampReady,
}: {
  includePreparerSignature: boolean;
  includeAuthorizedSignature: boolean;
  includeStamp: boolean;
  onPreparerSignature: (v: boolean) => void;
  onAuthorizedSignature: (v: boolean) => void;
  onStamp: (v: boolean) => void;
  preparerReady: boolean;
  preparerName?: string;
  authorizedReady: boolean;
  authorizedName?: string;
  stampReady: boolean;
}) {
  const preparerWho = (preparerName || '').trim();
  const authorizedWho = (authorizedName || '').trim();
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <p className="text-sm font-medium">จะให้เพิ่มลายเซ็นและตรายางลงในเอกสารหรือไม่?</p>
      <p className="text-xs text-muted-foreground">ลายเซ็นสองส่วนแยกกัน — เลือกได้ทีละช่อง หรือหลายช่องพร้อมกัน</p>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={includePreparerSignature}
          onCheckedChange={(v) => onPreparerSignature(v === true)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">1. ลายเซ็นผู้จัดเตรียมเอกสาร</span>
          <span className="block text-xs text-muted-foreground">
            ช่องซ้าย{preparerWho ? ` · ${preparerWho}` : ''}
            {preparerReady ? ' · มีลายเซ็นในโปรไฟล์' : ' · ยังไม่มีลายเซ็น — ถ้าเลือกไว้จะพิมพ์ช่องว่าง'}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={includeAuthorizedSignature}
          onCheckedChange={(v) => onAuthorizedSignature(v === true)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">2. ลายเซ็นผู้มีอำนาจลงนาม</span>
          <span className="block text-xs text-muted-foreground">
            ช่องกลาง{authorizedWho ? ` · ${authorizedWho}` : ''}
            {authorizedReady
              ? ' · ลายเซ็นที่แนบหรืออนุมัติแล้ว'
              : ' · ยังไม่มี — ถ้าเลือกไว้จะพิมพ์ช่องว่าง'}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={includeStamp} onCheckedChange={(v) => onStamp(v === true)} className="mt-0.5" />
        <span>
          <span className="font-medium">3. ตรายาง</span>
          <span className="block text-xs text-muted-foreground">
            {stampReady ? 'วางทับช่องผู้มีอำนาจลงนาม · จากหัวเอกสารบริษัท' : 'ยังไม่มีรูปตรายางในหัวเอกสารบริษัท'}
          </span>
        </span>
      </label>
    </div>
  );
}

export function PrintMarksDialog({
  open,
  onOpenChange,
  includePreparerSignature,
  includeAuthorizedSignature,
  includeStamp,
  onPreparerSignature,
  onAuthorizedSignature,
  onStamp,
  preparerReady,
  preparerName,
  authorizedReady,
  authorizedName,
  stampReady,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  includePreparerSignature: boolean;
  includeAuthorizedSignature: boolean;
  includeStamp: boolean;
  onPreparerSignature: (v: boolean) => void;
  onAuthorizedSignature: (v: boolean) => void;
  onStamp: (v: boolean) => void;
  preparerReady: boolean;
  preparerName?: string;
  authorizedReady: boolean;
  authorizedName?: string;
  stampReady: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>ตัวเลือกก่อนพิมพ์</DialogTitle>
          <DialogDescription>ลายเซ็นและตรายางจะถูกใส่เฉพาะรอบพิมพ์นี้ ไม่เปลี่ยนรายการหรือเลขที่เอกสาร</DialogDescription>
        </DialogHeader>
        <PrintMarksChoices
          includePreparerSignature={includePreparerSignature}
          includeAuthorizedSignature={includeAuthorizedSignature}
          includeStamp={includeStamp}
          onPreparerSignature={onPreparerSignature}
          onAuthorizedSignature={onAuthorizedSignature}
          onStamp={onStamp}
          preparerReady={preparerReady}
          preparerName={preparerName}
          authorizedReady={authorizedReady}
          authorizedName={authorizedName}
          stampReady={stampReady}
        />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button type="button" onClick={onConfirm}>
            พิมพ์
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
