/** Session-only: system admin previewing a customer's portal (cleared when tab closes). */
export const PORTAL_ADMIN_CUSTOMER_ID_KEY = 'opec_portal_admin_customer_id';

export function setPortalAdminCustomerId(customerId: string): void {
  try {
    sessionStorage.setItem(PORTAL_ADMIN_CUSTOMER_ID_KEY, customerId.trim());
  } catch {
    /* ignore */
  }
}

export function clearPortalAdminCustomerId(): void {
  try {
    sessionStorage.removeItem(PORTAL_ADMIN_CUSTOMER_ID_KEY);
  } catch {
    /* ignore */
  }
}

export function getPortalAdminCustomerId(): string | null {
  try {
    return sessionStorage.getItem(PORTAL_ADMIN_CUSTOMER_ID_KEY)?.trim() || null;
  } catch {
    return null;
  }
}
