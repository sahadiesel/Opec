/** Firestore collection names — kiosk clock-in/out for office staff & workers */
export const ATTENDANCE_KIOSK_SESSIONS_COLLECTION = 'attendance_kiosk_sessions';
export const ATTENDANCE_PUNCHES_COLLECTION = 'attendance_punches';
export const HR_CONFIGURATION_COLLECTION = 'hr_configuration';

/** Single-document HR org settings (leave quotas, etc.) */
export const HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID = 'office_leave_entitlements';

/** Kiosk QR session length (ms) — sync with UI countdown */
export const KIOSK_SESSION_TTL_MS = 5 * 60 * 1000;
