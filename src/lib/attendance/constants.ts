/** Firestore collection names — kiosk clock-in/out for office staff & workers */
export const ATTENDANCE_KIOSK_SESSIONS_COLLECTION = 'attendance_kiosk_sessions';
export const ATTENDANCE_PUNCHES_COLLECTION = 'attendance_punches';
/** Payroll officer submits; HR / operations manager approves — applies {@link AttendanceDayOverrideDoc} */
export const ATTENDANCE_CORRECTION_REQUESTS_COLLECTION = 'attendance_correction_requests';
export const ATTENDANCE_OVERTIME_REQUESTS_COLLECTION = 'attendance_overtime_requests';
/** Approved effective IN/OUT per calendar day (Bangkok) — merged into summaries */
export const ATTENDANCE_DAY_OVERRIDES_COLLECTION = 'attendance_day_overrides';
export const HR_CONFIGURATION_COLLECTION = 'hr_configuration';

/** Single-document HR org settings (leave quotas, etc.) */
export const HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID = 'office_leave_entitlements';

/**
 * Kiosk QR session length (ms) — single-use token, refreshed after every successful scan
 * แต่ละโค้ดอายุ 10 วินาที และจะถูกตั้ง `active = false` ทันทีหลังสแกนสำเร็จ (กันสแกนซ้ำใบเดิม)
 */
export const KIOSK_SESSION_TTL_MS = 15 * 1000;
