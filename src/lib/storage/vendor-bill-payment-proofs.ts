import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const MAX_PROOF_BYTES = 10 * 1024 * 1024;

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'file';
}

function proofStorageExtensionFromFilename(name: string): string | null {
  const m = name.match(/(\.[a-z0-9]+)$/i);
  if (!m) return null;
  const e = m[1].toLowerCase();
  if (e === '.jpeg') return '.jpg';
  if (['.pdf', '.png', '.jpg', '.webp', '.gif'].includes(e)) return e;
  return null;
}

/** Content-Type ที่ส่งไป Storage — รองรับกรณีเบราว์เซอร์ไม่ใส่ mime */
export function resolvedVendorBillProofContentType(file: File): string {
  const t = (file.type || '').trim().toLowerCase();
  if (t === 'application/pdf') return 'application/pdf';
  if (t === 'image/jpeg' || t === 'image/jpg' || t === 'image/pjpeg') return 'image/jpeg';
  if (t === 'image/png') return 'image/png';
  if (t === 'image/webp') return 'image/webp';
  if (t === 'image/gif') return 'image/gif';

  const ext = proofStorageExtensionFromFilename(file.name);
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.jpg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';

  return 'application/octet-stream';
}

/** หลักฐานการจ่าย / หัก ณ ที่จ่าย — PDF หรือรูปภาพทั่วไป */
export function validateVendorBillPaymentProof(file: File): string | null {
  if (file.size > MAX_PROOF_BYTES) {
    return 'ไฟล์ต้องไม่เกิน 10 MB';
  }
  const t = (file.type || '').trim().toLowerCase();
  if (t) {
    const ok =
      t === 'application/pdf' ||
      t === 'image/jpeg' ||
      t === 'image/jpg' ||
      t === 'image/pjpeg' ||
      t === 'image/png' ||
      t === 'image/webp' ||
      t === 'image/gif';
    if (!ok) {
      return 'อัปโหลดได้เฉพาะไฟล์ PDF หรือรูปภาพ (JPG, PNG, WEBP, GIF)';
    }
    return null;
  }
  if (proofStorageExtensionFromFilename(file.name)) return null;
  return 'อัปโหลดได้เฉพาะไฟล์ PDF หรือรูปภาพ (JPG, PNG, WEBP, GIF)';
}

/** @deprecated ใช้ {@link validateVendorBillPaymentProof} */
export function validateVendorBillPaymentProofPdf(file: File): string | null {
  return validateVendorBillPaymentProof(file);
}

export async function uploadVendorBillPaymentProofPdf(
  firebaseApp: FirebaseApp,
  vendorBillId: string,
  uploaderUid: string,
  file: File,
): Promise<{ downloadUrl: string; fileName: string; storagePath: string }> {
  const err = validateVendorBillPaymentProof(file);
  if (err) throw new Error(err);
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const stem = file.name.replace(/\.[^.]+$/, '');
  const ext =
    proofStorageExtensionFromFilename(file.name) ??
    (resolvedVendorBillProofContentType(file) === 'application/pdf' ? '.pdf' : '.jpg');
  const safeName = safeFileSegment(`${stem}${ext}`);
  const path = `vendor_bill_payment_proofs/${uploaderUid}/${vendorBillId}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;
  const storage = getStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: resolvedVendorBillProofContentType(file) });
  const downloadUrl = await getDownloadURL(r);
  return { downloadUrl, fileName: file.name, storagePath: path };
}

/** หลักฐานหัก ณ ที่จ่าย — แยก path จากสลิปโอนเงิน */
export async function uploadVendorBillWhtProofPdf(
  firebaseApp: FirebaseApp,
  vendorBillId: string,
  uploaderUid: string,
  file: File,
): Promise<{ downloadUrl: string; fileName: string; storagePath: string }> {
  const err = validateVendorBillPaymentProof(file);
  if (err) throw new Error(err);
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const stem = file.name.replace(/\.[^.]+$/, '');
  const ext =
    proofStorageExtensionFromFilename(file.name) ??
    (resolvedVendorBillProofContentType(file) === 'application/pdf' ? '.pdf' : '.jpg');
  const safeName = safeFileSegment(`${stem}${ext}`);
  const path = `vendor_bill_wht_payment_proofs/${uploaderUid}/${vendorBillId}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;
  const storage = getStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: resolvedVendorBillProofContentType(file) });
  const downloadUrl = await getDownloadURL(r);
  return { downloadUrl, fileName: file.name, storagePath: path };
}
