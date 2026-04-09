/**
 * Client-side image compression for uploads (e.g. timesheet photos).
 * Target: under maxBytes (default 500 KB) using canvas + JPEG re-encode.
 */

const DEFAULT_MAX_BYTES = 500 * 1024;

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

/**
 * Returns a Blob (JPEG) at or below maxBytes when possible.
 * PNG/WebP are converted to JPEG for predictable size reduction.
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
