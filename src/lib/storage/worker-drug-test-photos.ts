import type { FirebaseApp } from 'firebase/app';
import type { WaveMonthTimesheetPhotoAttachment } from '@/lib/types';
import { uploadWorkerCredentialAttachment } from '@/lib/storage/worker-credential-attachment';

export { validateWorkerCredentialAttachmentFile as validateWorkerDrugTestPhotoFile } from '@/lib/storage/worker-credential-attachment';

export const MAX_WORKER_DRUG_TEST_ATTACHMENTS = 5;

/** อัปโหลดรูปหรือ PDF ผลตรวจสารเสพติด — รูปบีบไม่เกิน 500 KB, PDF สูงสุด 10 MB */
export async function uploadWorkerDrugTestPhoto(
  firebaseApp: FirebaseApp,
  workerId: string,
  substanceKey: string,
  file: File,
): Promise<WaveMonthTimesheetPhotoAttachment> {
  return uploadWorkerCredentialAttachment(
    firebaseApp,
    'worker_drug_test_photos',
    workerId,
    substanceKey,
    file,
  );
}
