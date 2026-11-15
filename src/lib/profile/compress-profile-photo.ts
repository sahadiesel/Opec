const MAX_BYTES = 100 * 1024;

function renderJpeg(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('ไม่สามารถย่อรูปได้'));
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('ไม่สามารถย่อรูปได้'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Shrink a square crop until the JPEG is at most 100 KB. */
export async function compressProfilePhotoCanvas(source: HTMLCanvasElement): Promise<Blob> {
  let edge = Math.min(512, source.width);
  let quality = 0.86;
  let blob = await renderJpeg(source, edge, edge, quality);
  while (blob.size > MAX_BYTES && (quality > 0.42 || edge > 160)) {
    if (quality > 0.46) quality = Math.round((quality - 0.08) * 100) / 100;
    else edge = Math.round(edge * 0.82);
    blob = await renderJpeg(source, edge, edge, quality);
  }
  if (blob.size > MAX_BYTES) throw new Error('ย่อรูปให้ไม่เกิน 100 KB ไม่สำเร็จ');
  return blob;
}

/** Shrink a chosen image until the JPEG is at most 100 KB. */
export async function compressProfilePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    let edge = Math.min(512, longest);
    let quality = 0.86;
    const scale = () => {
      const ratio = edge / longest;
      return {
        width: Math.max(1, Math.round(bitmap.width * ratio)),
        height: Math.max(1, Math.round(bitmap.height * ratio)),
      };
    };
    let { width, height } = scale();
    let blob = await renderJpeg(bitmap, width, height, quality);
    while (blob.size > MAX_BYTES && (quality > 0.42 || edge > 160)) {
      if (quality > 0.46) quality = Math.round((quality - 0.08) * 100) / 100;
      else edge = Math.round(edge * 0.82);
      ({ width, height } = scale());
      blob = await renderJpeg(bitmap, width, height, quality);
    }
    if (blob.size > MAX_BYTES) throw new Error('ย่อรูปให้ไม่เกิน 100 KB ไม่สำเร็จ');
    return blob;
  } finally {
    bitmap.close();
  }
}
