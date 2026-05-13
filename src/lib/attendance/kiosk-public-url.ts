'use client';

/**
 * Base URL embedded in Kiosk QR codes — phones must be able to open this host on their network.
 *
 * If the kiosk PC opens the app as `http://localhost:3000` or `http://127.0.0.1:3000`, the QR will
 * point at the phone’s own loopback, so scanning “does nothing” or fails. Set
 * `NEXT_PUBLIC_APP_ORIGIN` to a reachable URL (e.g. `https://your-domain.com` or
 * `http://192.168.1.10:3000` on the LAN) and rebuild.
 */
export function getAttendanceMobileQrBaseUrl(): string {
  const fromEnv =
    (typeof process !== 'undefined' && typeof process.env.NEXT_PUBLIC_APP_ORIGIN === 'string'
      ? process.env.NEXT_PUBLIC_APP_ORIGIN.trim()
      : '') || '';
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

export function hasConfiguredPublicAppOrigin(): boolean {
  const v =
    (typeof process !== 'undefined' && typeof process.env.NEXT_PUBLIC_APP_ORIGIN === 'string'
      ? process.env.NEXT_PUBLIC_APP_ORIGIN.trim()
      : '') || '';
  return v.length > 0;
}

/** True when the current browser hostname is almost never reachable from another physical device. */
export function kioskHostnameUnlikelyReachableFromOtherDevices(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}
