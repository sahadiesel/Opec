/**
 * Firebase Web SDK — ค่า default ตรง `.firebaserc` / โปรเจกต์ dev
 * โปรดักชัน / โปรเจกต์อื่น: ตั้ง `NEXT_PUBLIC_FIREBASE_*` ใน `.env.local` หรือ App Hosting env
 * (apiKey ฝั่ง client เป็น public key ตามแบบ Firebase — จำกัดสิทธิ์ที่ Console)
 */
function envPublic(name: string): string | undefined {
  const v = process.env[name];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

const DEFAULT_PROJECT_ID = 'studio-9554558161-dc547';

const resolvedProjectId = envPublic('NEXT_PUBLIC_FIREBASE_PROJECT_ID') ?? DEFAULT_PROJECT_ID;

export const firebaseConfig = {
  projectId: resolvedProjectId,
  appId:
    envPublic('NEXT_PUBLIC_FIREBASE_APP_ID') ??
    '1:260259212048:web:1766524f6a15f4087e1395',
  apiKey:
    envPublic('NEXT_PUBLIC_FIREBASE_API_KEY') ??
    'AIzaSyBz7AUVlUS2VMjGyJKO2hPbAQPumj7AuRc',
  authDomain:
    envPublic('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN') ??
    `${resolvedProjectId}.firebaseapp.com`,
  measurementId: envPublic('NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID') ?? '',
  messagingSenderId:
    envPublic('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID') ?? '260259212048',
  storageBucket:
    envPublic('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET') ??
    `${resolvedProjectId}.firebasestorage.app`,
};
