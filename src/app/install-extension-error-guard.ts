/**
 * กรอง unhandledrejection / error จาก MetaMask ใน Chrome ไม่ให้ Next.js dev overlay บังทั้งแอป
 * รันซิงก์ตอนโหลด client bundle (ก่อน useEffect) — แอปนี้ไม่ใช้ web3
 */
import { isMetaMaskExtensionNoise, isMetaMaskScriptFilename } from '@/lib/extension-error-guard-utils';

if (typeof window !== 'undefined') {
  const onRejection = (e: PromiseRejectionEvent) => {
    if (isMetaMaskExtensionNoise(e.reason)) {
      e.preventDefault();
      if (process.env.NODE_ENV === 'development') {
        console.warn('[OpsFlow] ignored MetaMask extension rejection (dev).');
      }
    }
  };
  const onError = (e: ErrorEvent) => {
    const msg = e.message || (e.error instanceof Error ? e.error.message : '') || '';
    if (isMetaMaskExtensionNoise(e.error) || isMetaMaskScriptFilename(e.filename, msg)) {
      e.preventDefault();
      if (process.env.NODE_ENV === 'development') {
        console.warn('[OpsFlow] ignored MetaMask / extension script error (dev).', e.filename, msg);
      }
    }
  };
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('error', onError, true);
}

export {};
