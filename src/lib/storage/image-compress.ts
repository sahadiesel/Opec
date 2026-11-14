/**
 * Client-side image compression for uploads (e.g. timesheet photos).
 * Target: under maxBytes (default 500 KB) using canvas + JPEG re-encode.
 */

/** รูปที่บันทึกเข้าระบบต้องไม่เกินขนาดนี้ — ไฟล์ใหญ่กว่านี้ถูกบีบก่อนอัปโหลด */
export const MAX_STORED_IMAGE_BYTES = 500 * 1024;

const DEFAULT_MAX_BYTES = MAX_STORED_IMAGE_BYTES;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('ไม่สามารถโหลดรูปได้'));
    };
    img.src = url;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('บีบอัดรูปไม่สำเร็จ'));
      },
      'image/jpeg',
      quality
    );
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('บีบอัดรูปไม่สำเร็จ'));
    }, 'image/png');
  });
}

/** โลโก้ / ตรายางแสดงบนเอกสารไม่เกิน ~2 นิ้ว — 1600 px ยังคมที่ 600 dpi */
const TRANSPARENT_MAX_DIMENSION = 1600;
const TRANSPARENT_MIN_DIMENSION = 320;

/**
 * สำหรับโลโก้ / ตรายาง: ลดขนาดให้ไม่เกิน maxBytes โดย **คงพื้นหลังโปร่งใส**
 * PNG/WebP ถูกย่อแล้วเก็บเป็น PNG (ไม่แปลงเป็น JPEG เพราะ JPEG ไม่มีช่องโปร่งใส)
 * JPEG ไม่มีพื้นโปร่งใสอยู่แล้ว จึงใช้การบีบแบบ JPEG ตามปกติ
 */
export async function compressImageKeepingTransparency(
  file: File,
  maxBytes: number = DEFAULT_MAX_BYTES
): Promise<Blob> {
  if (file.size <= maxBytes) {
    return file;
  }
  if (file.type === 'image/jpeg') {
    return compressImageFileToMaxSize(file, maxBytes);
  }

  const img = await loadImageFromFile(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error('ไม่สามารถโหลดรูปได้');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ไม่รองรับการประมวลผลรูปในเบราว์เซอร์นี้');

  const longest = Math.max(srcW, srcH);
  let scale = Math.min(1, TRANSPARENT_MAX_DIMENSION / longest);
  for (;;) {
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    // ตั้งขนาดใหม่ = ล้างผืนผ้าเป็นโปร่งใสทั้งหมด ห้ามเทสีพื้นก่อนวาด
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await canvasToPngBlob(canvas);
    if (blob.size <= maxBytes) return blob;
    if (Math.max(w, h) <= TRANSPARENT_MIN_DIMENSION) break;
    // ขนาดไฟล์ PNG แปรตามพื้นที่โดยประมาณ — กระโดดไปใกล้เป้าแทนการลดทีละน้อย
    const estimate = Math.sqrt(maxBytes / blob.size) * 0.97;
    const nextScale = scale * Math.min(0.9, estimate);
    scale = Math.max(nextScale, TRANSPARENT_MIN_DIMENSION / longest);
  }

  throw new Error(
    `ย่อแล้วยังใหญ่กว่า ${Math.round(maxBytes / 1024)} KB — ลองใช้รูปที่ความละเอียดต่ำลง`
  );
}

/**
 * Returns a Blob (JPEG) at or below maxBytes when possible.
 * PNG/WebP are converted to JPEG for predictable size reduction.
 * ห้ามใช้กับรูปที่ต้องคงพื้นโปร่งใส (โลโก้ / ตรายาง) — ใช้ compressImageKeepingTransparency
 */
export async function compressImageFileToMaxSize(
  file: File,
  maxBytes: number = DEFAULT_MAX_BYTES
): Promise<Blob> {
  if (file.size <= maxBytes) {
    return file;
  }

  const img = await loadImageFromFile(file);
  let { width, height } = img;
  const maxDimension = 2400;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ไม่รองรับการประมวลผลรูปในเบราว์เซอร์นี้');
  ctx.drawImage(img, 0, 0, width, height);

  let quality = 0.88;
  let blob = await canvasToJpegBlob(canvas, quality);
  while (blob.size > maxBytes && quality > 0.35) {
    quality -= 0.07;
    blob = await canvasToJpegBlob(canvas, quality);
  }

  if (blob.size > maxBytes) {
    let scale = 0.92;
    while (blob.size > maxBytes && scale > 0.35) {
      const w = Math.max(320, Math.round(width * scale));
      const h = Math.max(320, Math.round(height * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      blob = await canvasToJpegBlob(canvas, quality);
      scale -= 0.08;
    }
  }

  if (blob.size > maxBytes) {
    throw new Error(
      `บีบอัดแล้วยังใหญ่กว่า ${Math.round(maxBytes / 1024)} KB — ลองใช้รูปที่ความละเอียดต่ำลง`
    );
  }

  return blob;
}
