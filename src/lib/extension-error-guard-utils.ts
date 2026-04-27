/**
 * แยก logic ออกเพื่อใช้ซ้ำกับ `install-extension-error-guard` และ (ถ้าต้อง) component
 */
export function isMetaMaskExtensionNoise(reason: unknown): boolean {
  if (reason == null) return false;
  const s =
    reason instanceof Error
      ? `${reason.name} ${reason.message}\n${reason.stack ?? ''}`
      : String(reason);
  if (/failed to connect to metamask/i.test(s)) return true;
  if (/nkbihfbeogaeaoehlefnkodbefgpgknn/i.test(s)) return true;
  if (/\bmetamask\b.*inpage|inpage.*\bmetamask/i.test(s)) return true;
  return false;
}

export function isMetaMaskScriptFilename(filename: string | undefined, message: string): boolean {
  if (filename && filename.startsWith('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/')) {
    return true;
  }
  if (filename?.startsWith('moz-extension://') && /metamask/i.test(message)) return true;
  return false;
}
