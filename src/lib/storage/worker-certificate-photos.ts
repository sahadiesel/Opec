import type { FirebaseApp } from 'firebase/app';
import type { WaveMonthTimesheetPhotoAttachment } from '@/lib/types';
import {
  uploadWorkerCredentialAttachment,
  validateWorkerCredentialAttachmentFile,
} from '@/lib/storage/worker-credential-attachment';

export { validateWorkerCredentialAttachmentFile as validateWorkerCertificatePhotoFile } from '@/lib/storage/worker-credential-attachment';

/** อัปโหลดรูปหรือ PDF ใบเซอร์ — รูปบีบไม่เกิน 500 KB, PDF สูงสุด 10 MB */
export async function uploadWorkerCertificatePhoto(
  firebaseApp: FirebaseApp,
  workerId: string,
  certificateCode: string,
  file: File,
): Promise<WaveMonthTimesheetPhotoAttachment> {
  return uploadWorkerCredentialAttachment(
    firebaseApp,
    'worker_certificate_photos',
    workerId,
    certificateCode,
    file,
  );
}
