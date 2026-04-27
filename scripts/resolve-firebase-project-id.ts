import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Project ID จาก env หรือ `.firebaserc` (default) — ให้ firebase-admin ทำงานนอก gcloud ที่ล็อกอินแล้ว */
export function resolveFirebaseProjectId(): string | undefined {
  const e = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (e) return e;
  const p = join(process.cwd(), '.firebaserc');
  if (!existsSync(p)) return undefined;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as { projects?: { default?: string } };
    return j?.projects?.default;
  } catch {
    return undefined;
  }
}
