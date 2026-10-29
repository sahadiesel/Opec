'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/** กรอบบนจอตรงสัดส่วน 35 มม. × 15 มม. */
const FRAME_W = 350;
const FRAME_H = 150;
const EXPORT_W = 700;
const EXPORT_H = 300;

type Props = {
  existingUrl?: string | null;
  onCroppedBlob: (blob: Blob | null) => void;
  onClearExisting: () => void;
  cleared?: boolean;
};

/**
 * อัปโหลดลายเซ็นแล้วลาก/ซูมให้พอดีกรอบ 35×15 มม. ก่อนบันทึก
 */
export function SignatureFrameEditor({ existingUrl, onCroppedBlob, onClearExisting, cleared }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [userScale, setUserScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const exportBlob = (img: HTMLImageElement, nextOffset: { x: number; y: number }, scale: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_W;
    canvas.height = EXPORT_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, EXPORT_W, EXPORT_H);
    const ratio = EXPORT_W / FRAME_W;
    ctx.drawImage(
      img,
      nextOffset.x * ratio,
      nextOffset.y * ratio,
      img.naturalWidth * scale * ratio,
      img.naturalHeight * scale * ratio,
    );
    canvas.toBlob((blob) => onCroppedBlob(blob), 'image/png');
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setUserScale(1);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const nextFit = FRAME_W / img.naturalWidth;
      const h = img.naturalHeight * nextFit;
      const nextOffset = { x: 0, y: (FRAME_H - h) / 2 };
      offsetRef.current = nextOffset;
      scaleRef.current = nextFit;
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      setFitScale(nextFit);
      setOffset(nextOffset);
      exportBlob(img, nextOffset, nextFit);
    };
    img.src = url;
  };

  const scale = fitScale * userScale;
  const shown = objectUrl;
  const previewExisting = !shown && !cleared && existingUrl;

  return (
    <div className="space-y-2">
      <Label>ลายเซ็น (กรอบ 35 × 15 มม.)</Label>
      <p className="text-[11px] text-muted-foreground">
        อัปโหลดรูป แล้วลากหรือซูมให้ลายเซ็นอยู่ในกรอบ — ขนาดนี้คือขนาดที่จะพิมพ์บนเอกสาร
      </p>
      <div
        className="relative overflow-hidden rounded-md border-2 border-dashed border-primary/40 bg-white"
        style={{ width: FRAME_W, maxWidth: '100%', height: FRAME_H, touchAction: 'none' }}
        onPointerDown={(e) => {
          if (!shown) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragRef.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          const img = imgRef.current;
          if (!drag || !img) return;
          const next = { x: drag.ox + (e.clientX - drag.px), y: drag.oy + (e.clientY - drag.py) };
          offsetRef.current = next;
          setOffset(next);
        }}
        onPointerUp={() => {
          const img = imgRef.current;
          if (dragRef.current && img) exportBlob(img, offsetRef.current, scaleRef.current);
          dragRef.current = null;
        }}
      >
        {shown && natural.w > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: offset.x,
              top: offset.y,
              width: natural.w * scale,
              height: natural.h * scale,
              maxWidth: 'none',
              userSelect: 'none',
            }}
          />
        ) : previewExisting ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={existingUrl || ''} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">ยังไม่มีลายเซ็น</div>
        )}
      </div>
      {shown ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          ซูม
          <input
            type="range"
            min={0.4}
            max={3}
            step={0.05}
            value={userScale}
            onChange={(e) => {
              const nextUser = Number(e.target.value);
              const nextScale = fitScale * nextUser;
              scaleRef.current = nextScale;
              setUserScale(nextUser);
              const img = imgRef.current;
              if (img) exportBlob(img, offsetRef.current, nextScale);
            }}
            className="flex-1"
          />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" asChild>
          <label className="cursor-pointer">
            อัปโหลดลายเซ็น
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </label>
        </Button>
        {(existingUrl || shown) && !cleared ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => {
              if (objectUrl) URL.revokeObjectURL(objectUrl);
              setObjectUrl(null);
              imgRef.current = null;
              onCroppedBlob(null);
              onClearExisting();
            }}
          >
            ลบลายเซ็น
          </Button>
        ) : null}
      </div>
    </div>
  );
}
