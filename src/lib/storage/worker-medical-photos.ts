import type { FirebaseApp } from 'firebase/app';
import type { WaveMonthTimesheetPhotoAttachment } from '@/lib/types';
import { uploadWorkerCredentialAttachment } from '@/lib/storage/worker-credential-attachment';

export { validateWorkerCredentialAttachmentFile as validateWorkerMedicalPhotoFile } from '@/lib/storage/worker-credential-attachment';

/** อัปโหลดรูปหรือ PDF ผลตรวจร่างกาย — รูปบีบไม่เกิน 500 KB, PDF สูงสุด 10 MB */
export async function uploadWorkerMedicalPhoto(
  firebaseApp: FirebaseApp,
  workerId: string,
  medicalType: string,
  file: File,
): Promise<WaveMonthTimesheetPhotoAttachment> {
  return uploadWorkerCredentialAttachment(
    firebaseApp,
    'worker_medical_photos',
    workerId,
    medicalType,
    file,
  );
}
