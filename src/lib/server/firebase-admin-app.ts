import { existsSync, readFileSync } from 'fs';
import {
  initializeApp,
  getApps,
  cert,
  applicationDefault,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { firebaseConfig } from '@/firebase/config';

function loadServiceAccountFromPath(path: string): ServiceAccount {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as ServiceAccount;
}

function projectIdFromServiceAccount(parsed: ServiceAccount): string {
  const snake = (parsed as unknown as { project_id?: string }).project_id;
  if (typeof snake === 'string' && snake.length > 0) return snake;
  if (typeof parsed.projectId === 'string' && parsed.projectId.length > 0) return parsed.projectId;
  return firebaseConfig.projectId;
}

/**
 * Firebase Admin for API routes.
 *
 * Local dev (Windows): ตั้งอย่างใดอย่างหนึ่ง
 * - `FIREBASE_SERVICE_ACCOUNT_JSON` = เนื้อไฟล์ JSON ทั้งก้อน (string)
 * - `GOOGLE_APPLICATION_CREDENTIALS` หรือ `FIREBASE_SERVICE_ACCOUNT_PATH` = path ไปที่ไฟล์ Service Account
 *
 * Production (App Hosting / GCP): มักใช้ ADC ได้โดยไม่ต้องตั้งค่าเพิ่ม
 */
export function getFirebaseAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inlineJson != null && String(inlineJson).trim().length > 0) {
    const parsed = JSON.parse(String(inlineJson)) as ServiceAccount;
    return initializeApp({
      credential: cert(parsed),
      projectId: projectIdFromServiceAccount(parsed),
    });
  }

  const credPathRaw =
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (credPathRaw && existsSync(credPathRaw)) {
    const parsed = loadServiceAccountFromPath(credPathRaw);
    return initializeApp({
      credential: cert(parsed),
      projectId: projectIdFromServiceAccount(parsed),
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: firebaseConfig.projectId,
  });
}
