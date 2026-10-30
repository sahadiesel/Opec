import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Removes keys with undefined values from an object before sending to Firestore.
 * Firestore does not support undefined values in documents (including nested maps/arrays).
 */
export function sanitizeFirestorePayload<T extends Record<string, any>>(data: T): T {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      sanitized[key] = value
        .filter((item) => item !== undefined)
        .map((item) => (isPlainObject(item) ? sanitizeFirestorePayload(item) : item));
    } else if (isPlainObject(value)) {
      sanitized[key] = sanitizeFirestorePayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized as T;
}
