/**
 * Firestore ไม่รองรับค่า undefined — ลบ key ที่เป็น undefined แบบ recursive
 */

export function stripUndefinedForFirestore<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }
  if (typeof input !== 'object') {
    return input;
  }
  if (input instanceof Date) {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => stripUndefinedForFirestore(item)) as T;
  }
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    out[key] = stripUndefinedForFirestore(val);
  }
  return out as T;
}
