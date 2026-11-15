'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/** สัดส่วนกรอบพิมพ์ 35 มม. × 15 มม. ความกว้างบนจอตามคอลัมน์ */
const ASPECT = 15 / 35;
const EXPORT_W = 700;
const EXPORT_H = 300;

type Props = {
  existingUrl?: string | null;
  /** ลิงก์เดิมในเอกสาร ใช้เมื่อไฟล์ในถังสิงคโปร์โหลดไม่ได้ */
  fallbackUrl?: string | null;
  onCroppedBlob: (blob: Blob | null) => void;
  onClearExisting: () => void;
  cleared?: boolean;
  resolving?: boolean;
};

/**
 * อัปโหลดลายเซ็นแล้วลาก/ซูมให้พอดีกรอบ 35×15 มม. ก่อนบันทึก
 */
export function SignatureFrameEditor({
  existingUrl,
  fallbackUrl,
  onCroppedBlob,
  onClearExisting,
  cleared,
  resolving,
}: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [userScale, setUserScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameW, setFrameW] = useState(280);
  const frameH = Math.max(72, Math.round(frameW * ASPECT));
  const imgRef = useRef<HTMLImageElement | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [useFallback, setUseFallback] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setUseFallback(false);
    setLoadFailed(false);
  }, [existingUrl, fallbackUrl]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrameW(Math.max(160, el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const exportBlob = (img: HTMLImageElement, nextOffset: { x: number; y: number }, scale: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_W;
    canvas.height = EXPORT_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, EXPORT_W, EXPORT_H);
    const ratio = EXPORT_W / Math.max(1, frameRef.current?.clientWidth || frameW);
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
      const boxW = frameRef.current?.clientWidth || frameW;
      const boxH = Math.max(72, Math.round(boxW * ASPECT));
      const nextFit = boxW / img.naturalWidth;
      const h = img.naturalHeight * nextFit;
      const nextOffset = { x: 0, y: (boxH - h) / 2 };
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
  const previewSrc = (useFallback ? fallbackUrl : existingUrl) || '';
  const previewExisting = !shown && !cleared && Boolean(previewSrc) && !loadFailed;

  return (
    <div className="space-y-2">
      <Label>ลายเซ็น (กรอบ 35 × 15 มม.)</Label>
      <p className="text-[11px] text-muted-foreground">
        อัปโหลดรูป แล้วลากหรือซูมให้ลายเซ็นอยู่ในกรอบ — ขนาดนี้คือขนาดที่จะพิมพ์บนเอกสาร
      </p>
      <div
        ref={frameRef}
        className="relative w-full overflow-hidden rounded-md border-2 border-dashed border-primary/40 bg-white"
        style={{ height: frameH, touchAction: 'none' }}
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
          <img
            src={previewSrc}
            alt="ลายเซ็น"
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => {
              const fallback = (fallbackUrl || '').trim();
              if (!useFallback && fallback && fallback !== previewSrc) {
                setUseFallback(true);
                return;
              }
              setLoadFailed(true);
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
            {resolving
              ? 'กำลังโหลดลายเซ็นจากถังสิงคโปร์…'
              : loadFailed
                ? 'ไม่พบไฟล์ลายเซ็นในถังสิงคโปร์ — อัปโหลดใหม่แล้วกดบันทึก'
                : 'ยังไม่มีลายเซ็น'}
          </div>
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
