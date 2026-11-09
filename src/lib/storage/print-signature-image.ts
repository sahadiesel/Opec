import { FIREBASE_STORAGE_BUCKET } from '@/firebase/config';

export const COMPANY_STAMP_STORAGE_PATH = 'company_profile_branding/document_header_stamp';

/** ดึงรหัสผู้ใช้จากลิงก์ลายเซ็นเก่า ถ้าเอกสารไม่ได้เก็บ signerUid */
export function userIdFromSignatureUrl(url: string | null | undefined): string {
  const match = (url || '').match(/user_signatures(?:%2F|\/)([^./?]+)\.png/i);
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function userSignatureStoragePath(userId: string | null | undefined): string {
  const safeId = (userId || '').replace(/[^\w-]/g, '');
  return safeId ? `user_signatures/${safeId}.png` : '';
}

/** URL อ่านตรงจากถังสิงคโปร์ — ไม่ใช้ลิงก์เก่าที่ชี้ถังเดิมหลังย้ายไฟล์ */
export function publicStorageMediaUrl(path: string): string {
  const clean = path.trim().replace(/^\/+/, '');
  const bucket = FIREBASE_STORAGE_BUCKET.replace(/^gs:\/\//, '');
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(clean)}?alt=media`;
}

/**
 * คืน URL ของถังปัจจุบันให้แท็ก img ในใบพิมพ์
 * ไม่ใช้ลิงก์ดาวน์โหลดที่ยังชี้ถังเก่าหลังย้ายไฟล์ไปสิงคโปร์
 */
export async function inlineStorageImageForPrint(path: string): Promise<string | undefined> {
  const clean = path.trim().replace(/^\/+/, '');
  if (!clean) return undefined;
  return publicStorageMediaUrl(clean);
}

export async function inlineUserSignatureForPrint(
  userId: string | null | undefined,
): Promise<string | undefined> {
  return inlineStorageImageForPrint(userSignatureStoragePath(userId));
}

export async function inlineCompanyStampForPrint(): Promise<string | undefined> {
  return inlineStorageImageForPrint(COMPANY_STAMP_STORAGE_PATH);
}

type PrintImageSet = {
  preparer?: string;
  authorized?: string;
  stamp?: string;
};

/** โหลดลายเซ็นผู้จัดทำ ผู้มีอำนาจ และตรายาง สำหรับใส่ในใบพิมพ์ */
export async function loadDocumentPrintImages(opts: {
    includePreparer: boolean;
    preparerUid?: string | null;
    includeAuthorized: boolean;
    signerUid?: string | null;
    includeStamp: boolean;
  },
): Promise<PrintImageSet> {
  const [preparer, authorized, stamp] = await Promise.all([
    opts.includePreparer ? inlineUserSignatureForPrint(opts.preparerUid) : Promise.resolve(undefined),
    opts.includeAuthorized ? inlineUserSignatureForPrint(opts.signerUid) : Promise.resolve(undefined),
    opts.includeStamp ? inlineCompanyStampForPrint() : Promise.resolve(undefined),
  ]);
  return { preparer, authorized, stamp };
}
