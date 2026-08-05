/**
 * Firestore จะ console.error เมื่อเชื่อมต่อ backend ไม่ได้ (เครือข่าย/VPN/ไฟร์วอลล์)
 * Next.js 15 dev จับ console.error → แสดง overlay บังทั้งหน้า แม้แอปยังทำงานแบบ offline ได้
 * ใน development เท่านั้น: แปลงข้อความ transient นี้เป็น warn แทน
 */
import { getAuth } from 'firebase/auth';
import { isFirestoreLoggingOut } from '@/firebase/firestore/suppress-logout-permission-error';

declare global {
  interface Window {
    __opecFirestoreDevConsoleFilterInstalled?: boolean;
  }
}

const FIRESTORE_UNREACHABLE = /Could not reach Cloud Firestore backend/i;
/** Spark / quota — เขียนถี่เกินไป SDK จะ backoff; ลด overlay บังหน้าใน dev */
const FIRESTORE_RESOURCE_EXHAUSTED =
  /resource-exhausted|maximum bandwidth for writes|Using maximum backoff delay/i;
/** ข้อความจาก Firestore เมื่อ query ต้องการ composite index — URL ในนี้เปิด Console แล้วกดสร้างดัชนีได้ */
const FIRESTORE_INDEX_NEEDED =
  /(?:requires an index|Missing composite index|The query requires an index)/i;
const FIREBASE_CONSOLE_INDEX_URL = /https:\/\/console\.firebase\.google\.com\/[^\s"'<>]+/gi;
/** permission-denied จาก SDK — Next.js dev overlay จับ console.error แล้วบังทั้งหน้า */
const FIRESTORE_PERMISSION_DENIED =
  /Missing or insufficient permissions|FirebaseError.*permission|permission-denied/i;

function shouldSuppressPermissionNoise(): boolean {
  try {
    if (isFirestoreLoggingOut()) return true;
    return getAuth().currentUser === null;
  } catch {
    return false;
  }
}

export function installFirestoreDevConsoleFilter(): void {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV !== 'development') return;
  if (window.__opecFirestoreDevConsoleFilterInstalled) return;
  window.__opecFirestoreDevConsoleFilterInstalled = true;

  const orig = console.error.bind(console);

  console.error = (...args: unknown[]) => {
    try {
      const text = args
        .map((a) => {
          if (typeof a === 'string') return a;
          if (a instanceof Error) return `${a.name} ${a.message}\n${a.stack ?? ''}`;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ');
      /**
       * permission-denied: ระหว่าง logout หรือ query ที่ role ไม่ผ่าน —
       * อย่าปล่อยเป็น console.error (Next.js 15 จะโชว์ Runtime overlay บังทั้งหน้า)
       */
      if (FIRESTORE_PERMISSION_DENIED.test(text)) {
        if (shouldSuppressPermissionNoise()) return;
        console.warn('[Firestore] permission-denied —', text.slice(0, 240));
        return;
      }
      if (FIRESTORE_UNREACHABLE.test(text)) {
        console.warn(
          '[Firestore] เชื่อมต่อ Cloud ชั่วคราวไม่ได้ — ทำงานแบบ offline จนกว่าเครือข่ายจะพร้อม (ตรวจ VPN/ไฟร์วอลล์ แล้วรีเฟรช)',
        );
        return;
      }
      if (FIRESTORE_RESOURCE_EXHAUSTED.test(text)) {
        console.warn(
          '[Firestore] เขียนข้อมูลถี่เกินโควต้า (resource-exhausted) — รอ 1–2 นาทีแล้วลองใหม่ หรืออัปเกรดแผน Firebase / ลดปริมาณเขียนต่อครั้ง',
        );
        return;
      }
      if (FIRESTORE_INDEX_NEEDED.test(text)) {
        const urls = text.match(FIREBASE_CONSOLE_INDEX_URL);
        if (urls?.length) {
          const unique = [...new Set(urls)];
          console.warn(
            '[Firestore Index] ยังไม่มี composite index — เปิดลิงก์ด้านล่างในเบราว์เซอร์ แล้วกดสร้างดัชนี (หรือ deploy firestore.indexes.json):\n\n' +
              unique.join('\n\n'),
          );
        }
      }
    } catch {
      /* fall through */
    }
    orig(...args);
  };
}
