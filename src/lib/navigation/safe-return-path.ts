/** ใช้กับ query `returnTo` — อนุญาตเฉพาะ path ภายในแอป */
export function resolveSafeInternalReturnPath(
  raw: string | null | undefined,
  fallback = '/ops',
): string {
  const t = (raw || '').trim();
  if (!t.startsWith('/') || t.startsWith('//')) return fallback;
  return t;
}
