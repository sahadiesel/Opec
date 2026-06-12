/**
 * Legacy misspellings of "Executive" in role keys and user-facing labels.
 * Role keys: normalize via role-key-normalizer; display text: fixExecutiveSpelling().
 */

const DISPLAY_TYPO_FIXES: ReadonlyArray<[RegExp, string]> = [
  [/\bExcutive\b/g, 'Executive'],
  [/\bexcutive\b/g, 'executive'],
  [/\bExecusive\b/g, 'Executive'],
  [/\bexecusive\b/g, 'executive'],
];

/** Fix common Executive typos in names, toasts, headers (not for Firestore keys — use normalizeBusinessRoleKey). */
export function fixExecutiveSpelling(text: string | null | undefined): string {
  if (text == null || text === '') return text ?? '';
  let out = text;
  for (const [pattern, replacement] of DISPLAY_TYPO_FIXES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
