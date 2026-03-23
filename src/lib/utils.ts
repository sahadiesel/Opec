import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Removes keys with undefined values from an object before sending to Firestore.
 * Firestore does not support undefined values in documents.
 */
export function sanitizeFirestorePayload<T extends Record<string, any>>(data: T): T {
  const sanitized = { ...data };
  Object.keys(sanitized).forEach((key) => {
    if (sanitized[key] === undefined) {
      delete sanitized[key];
    }
  });
  return sanitized;
}
