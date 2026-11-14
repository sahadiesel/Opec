'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** หลังกดติ๊กโดยยังไม่มีลายเซ็น — ค้าง tooltip ไว้ให้อ่านทัน แม้เลื่อนเมาส์ออก */
const BLOCKED_TIP_HOLD_MS = 6000;
/** การกดบน trigger ทำให้ tooltip สั่งปิดตัวเอง — ไม่รับคำสั่งปิดช่วงสั้น ๆ หลังกดติ๊ก */
const BLOCKED_TIP_IGNORE_CLOSE_MS = 500;

/**
 * ข้อความเฉพาะเอกสาร — ค่าเริ่มต้นเป็นของเอกสารที่ต้องกดขออนุมัติลายเซ็น (ใบเสนอราคา ใบแจ้งหนี้ ใบกำกับภาษี)
 * ใบสั่งซื้อไม่มีปุ่มขอลายเซ็น: ลายเซ็นผู้อนุมัติมาจากการอนุมัติของผู้จัดการ จึงใช้ข้อความของตัวเอง
 */
export type PrintMarksCopy = {
  /** ชื่อข้อ 1 เช่น「ลายเซ็นผู้จัดทำ」 */
  preparerLabel?: string;
  /** ชื่อข้อ 2 เช่น「ลายเซ็นผู้อนุมัติ」 */
  authorizedLabel?: string;
  /** ตำแหน่งข้อ 2 บนเอกสาร เช่น「ช่องขวา」 */
  authorizedSlot?: string;
  /** หมายเหตุเมื่อพร้อมติ๊ก */
  authorizedReadyNote?: string;
  /** หมายเหตุสั้นเมื่อยังติ๊กไม่ได้ */
  authorizedBlockedNote?: string;
  /** ข้อความ tooltip เมื่อกดติ๊กแต่ยังไม่มีลายเซ็น */
  authorizedBlockedTip?: string;
  /** ตำแหน่งตรายางบนเอกสาร */
  stampPlacement?: string;
  /** คำอธิบายใต้หัวกล่อง */
  dialogDescription?: string;
};

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
  authorizedPending,
  authorizedName,
  stampReady,
  copy,
}: {
  includePreparerSignature: boolean;
  includeAuthorizedSignature: boolean;
  includeStamp: boolean;
  onPreparerSignature: (v: boolean) => void;
  onAuthorizedSignature: (v: boolean) => void;
  onStamp: (v: boolean) => void;
  preparerReady: boolean;
  preparerName?: string;
  /** มีลายเซ็นผู้มีอำนาจลงนามที่แนบหรืออนุมัติแล้ว — ถ้าไม่มี ติ๊กข้อ 2 และ 3 ไม่ได้ */
  authorizedReady: boolean;
  /** ส่งขออนุมัติลายเซ็นแล้ว รอผู้อนุมัติ */
  authorizedPending?: boolean;
  authorizedName?: string;
  stampReady: boolean;
  copy?: PrintMarksCopy;
}) {
  const preparerLabel = copy?.preparerLabel || 'ลายเซ็นผู้จัดเตรียมเอกสาร';
  const authorizedLabel = copy?.authorizedLabel || 'ลายเซ็นผู้มีอำนาจลงนาม';
  const preparerWho = (preparerName || '').trim();
  const authorizedWho = (authorizedName || '').trim();
  /** ไม่มีลายเซ็นที่อนุมัติแล้ว = ถือว่าไม่ได้ติ๊ก ไม่ว่าค่าที่ส่งมาจะเป็นอะไร */
  const authorizedOn = authorizedReady && includeAuthorizedSignature;
  const stampOn = authorizedOn && includeStamp;

  const authorizedStatusId = useId();
  const [blockedTipOpen, setBlockedTipOpen] = useState(false);
  const blockedAttemptAtRef = useRef(0);
  const blockedTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearBlockedTipTimer = () => {
    if (blockedTipTimerRef.current) {
      clearTimeout(blockedTipTimerRef.current);
      blockedTipTimerRef.current = null;
    }
  };

  useEffect(() => clearBlockedTipTimer, []);

  const showBlockedTipAfterAttempt = () => {
    blockedAttemptAtRef.current = Date.now();
    setBlockedTipOpen(true);
    clearBlockedTipTimer();
    blockedTipTimerRef.current = setTimeout(() => setBlockedTipOpen(false), BLOCKED_TIP_HOLD_MS);
  };

  const blockedTipText =
    copy?.authorizedBlockedTip ||
    (authorizedPending
      ? 'ส่งขออนุมัติลายเซ็นแล้ว — รอผู้อนุมัติในศูนย์อนุมัติ เมื่ออนุมัติแล้วจึงจะติ๊กได้'
      : 'ยังไม่มีลายเซ็นผู้มีอำนาจลงนาม — กดปุ่ม "ขออนุมัติลายเซ็นต์" ที่หน้าเอกสารเพื่อขอลายเซ็นก่อน เมื่ออนุมัติแล้วจึงจะติ๊กได้');

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <p className="text-sm font-medium">จะให้เพิ่มลายเซ็นและตรายางลงในเอกสารหรือไม่?</p>
      <p className="text-xs text-muted-foreground">
        เลือกแล้วระบบจำไว้สำหรับเอกสารนี้ในการพิมพ์ครั้งถัดไป จนกว่าจะติ๊กออก
      </p>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={includePreparerSignature}
          onCheckedChange={(v) => onPreparerSignature(v === true)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">1. {preparerLabel}</span>
          <span className="block text-xs text-muted-foreground">
            ช่องซ้าย{preparerWho ? ` · ${preparerWho}` : ''}
            {preparerReady ? ' · มีลายเซ็นในโปรไฟล์' : ' · ยังไม่มีลายเซ็น — ถ้าเลือกไว้จะพิมพ์ช่องว่าง'}
          </span>
        </span>
      </label>
      <TooltipProvider delayDuration={150}>
        <Tooltip
          open={!authorizedReady && blockedTipOpen}
          onOpenChange={(next) => {
            if (authorizedReady) return;
            if (next) {
              setBlockedTipOpen(true);
              return;
            }
            if (Date.now() - blockedAttemptAtRef.current < BLOCKED_TIP_IGNORE_CLOSE_MS) return;
            clearBlockedTipTimer();
            setBlockedTipOpen(false);
          }}
        >
          <TooltipTrigger asChild>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={authorizedOn}
                aria-describedby={authorizedReady ? undefined : authorizedStatusId}
                onCheckedChange={(v) => {
                  const on = v === true;
                  if (on && !authorizedReady) {
                    /** ยังไม่มีลายเซ็น — ไม่ให้ติ๊กค้าง และบอกวิธีขอลายเซ็น */
                    showBlockedTipAfterAttempt();
                    onAuthorizedSignature(false);
                    return;
                  }
                  onAuthorizedSignature(on);
                  if (!on) onStamp(false);
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">2. {authorizedLabel}</span>
                <span id={authorizedStatusId} className="block text-xs text-muted-foreground">
                  {copy?.authorizedSlot || 'ช่องกลาง'}
                  {authorizedWho ? ` · ${authorizedWho}` : ''}
                  {authorizedReady
                    ? ` · ${copy?.authorizedReadyNote || 'ลายเซ็นที่แนบหรืออนุมัติแล้ว'}`
                    : copy?.authorizedBlockedNote
                      ? ` · ${copy.authorizedBlockedNote}`
                      : authorizedPending
                        ? ' · รออนุมัติลายเซ็น — ยังติ๊กไม่ได้'
                        : ' · ยังไม่มีลายเซ็น — ต้องขออนุมัติลายเซ็นก่อนจึงจะติ๊กได้'}
                </span>
              </span>
            </label>
          </TooltipTrigger>
          {/* แสดงด้านล่าง — ทับเฉพาะแถวตรายางที่ยังเลือกไม่ได้อยู่แล้ว ไม่บังข้อ 1 */}
          <TooltipContent side="bottom" align="start" className="max-w-xs text-xs leading-relaxed">
            {blockedTipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <label className={`flex items-start gap-2 text-sm ${authorizedOn ? '' : 'opacity-60'}`}>
        <Checkbox
          checked={stampOn}
          disabled={!authorizedOn}
          onCheckedChange={(v) => onStamp(v === true)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">3. ตรายาง</span>
          <span className="block text-xs text-muted-foreground">
            {!authorizedReady
              ? copy?.authorizedLabel
                ? `ต้องมี${authorizedLabel}ก่อน จึงจะเลือกตรายางได้`
                : 'ต้องมีลายเซ็นผู้มีอำนาจลงนามที่อนุมัติแล้วก่อน จึงจะเลือกตรายางได้'
              : !authorizedOn
                ? `เลือก${authorizedLabel}ก่อน จึงจะเลือกตรายางได้`
                : stampReady
                  ? `${copy?.stampPlacement || 'วางระหว่างผู้จัดเตรียมกับผู้มีอำนาจลงนาม'} · จากหัวเอกสารบริษัท`
                  : 'ยังไม่มีรูปตรายางในหัวเอกสารบริษัท'}
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
  authorizedPending,
  authorizedName,
  stampReady,
  copy,
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
  authorizedPending?: boolean;
  authorizedName?: string;
  stampReady: boolean;
  copy?: PrintMarksCopy;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>ตัวเลือกก่อนพิมพ์</DialogTitle>
          <DialogDescription>
            {copy?.dialogDescription ||
              'ตัวเลือกถูกจำไว้กับเอกสารนี้ ลายเซ็นผู้มีอำนาจลงนามและตรายางเลือกได้เมื่อลายเซ็นได้รับอนุมัติแล้ว'}
          </DialogDescription>
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
          authorizedPending={authorizedPending}
          authorizedName={authorizedName}
          stampReady={stampReady}
          copy={copy}
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
