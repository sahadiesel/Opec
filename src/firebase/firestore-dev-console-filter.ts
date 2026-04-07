/**
 * Firestore จะ console.error เมื่อเชื่อมต่อ backend ไม่ได้ (เครือข่าย/VPN/ไฟร์วอลล์)
 * Next.js 15 dev จับ console.error → แสดง overlay บังทั้งหน้า แม้แอปยังทำงานแบบ offline ได้
 * ใน development เท่านั้น: แปลงข้อความ transient นี้เป็น warn แทน
 */
declare global {
  interface Window {
    __opecFirestoreDevConsoleFilterInstalled?: boolean;
  }
}

const FIRESTORE_UNREACHABLE = /Could not reach Cloud Firestore backend/i;

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
          if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ');
      if (FIRESTORE_UNREACHABLE.test(text)) {
        console.warn(
          '[Firestore] เชื่อมต่อ Cloud ชั่วคราวไม่ได้ — ทำงานแบบ offline จนกว่าเครือข่ายจะพร้อม (ตรวจ VPN/ไฟร์วอลล์ แล้วรีเฟรช)',
        );
        return;
      }
    } catch {
      /* fall through */
    }
    orig(...args);
  };
}
