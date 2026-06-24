import type { FirebaseApp } from 'firebase/app';
import type { WaveMonthTimesheetPhotoAttachment } from '@/lib/types';
import { uploadWorkerCredentialAttachment } from '@/lib/storage/worker-credential-attachment';

export { validateWorkerCredentialAttachmentFile as validateWorkerDocumentPhotoFile } from '@/lib/storage/worker-credential-attachment';

/** อัปโหลดรูปหรือ PDF เอกสาร — รูปบีบไม่เกิน 500 KB, PDF สูงสุด 10 MB */
export async function uploadWorkerDocumentPhoto(
  firebaseApp: FirebaseApp,
  workerId: string,
  documentType: string,
  file: File,
): Promise<WaveMonthTimesheetPhotoAttachment> {
  return uploadWorkerCredentialAttachment(
    firebaseApp,
    'worker_document_photos',
    workerId,
    documentType,
    file,
  );
}
