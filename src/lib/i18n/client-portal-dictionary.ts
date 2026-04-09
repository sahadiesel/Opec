export type PortalLocale = 'en' | 'th';

export const PORTAL_STORAGE_KEY = 'opec_portal_locale';

/** คีย์เมนูหลัก + ข้อความ UI ทั่วไป — ใช้กับ usePortalLocale().t(...) */
export const portalNav = {
  en: {
    home: 'Home',
    contracts: 'Contracts',
    pos: 'Purchase orders',
    workers: 'Your team',
    timesheets: 'Timesheets',
    draftInvoices: 'Draft invoices',
    documents: 'Invoices & receipts',
    billing: 'Billing summary',
    waves: 'Roster / waves',
    signOut: 'Sign out',
    language: 'Language',
    thai: 'ไทย',
    english: 'English',
    portalTitle: 'Client portal',
    viewer: 'Viewer',
    approver: 'Approver',
    dashboardTitle: 'Your workspace',
    dashboardLead: 'Review contracts, POs, personnel, timesheets, and billing — in one simple place.',
    dashboardMoreBilling: 'More: billing overview',
    rosterFromTeam: 'Open wave roster',
    accessRestricted: 'Access restricted',
    portalOnly: 'This area is for customer portal accounts.',
    open: 'Open',
    printHint: 'Open the document, then use your browser print (e.g. Ctrl+P).',
    viewerNoApprove: 'View-only account — you can still request corrections. Ask your OPEC contact for Approver access to approve billing.',
  },
  th: {
    home: 'หน้าหลัก',
    contracts: 'สัญญา',
    pos: 'ใบสั่งซื้อ (PO)',
    workers: 'กำลังพลของท่าน',
    timesheets: 'บันทึกเวลา',
    draftInvoices: 'ใบแจ้งหนี้ร่าง',
    documents: 'ใบกำกับ / ใบเสร็จ',
    billing: 'สรุปการเงิน',
    waves: 'รอบงาน / รายชื่อ',
    signOut: 'ออกจากระบบ',
    language: 'ภาษา',
    thai: 'ไทย',
    english: 'English',
    portalTitle: 'พอร์ทัลลูกค้า',
    viewer: 'ผู้ดู',
    approver: 'ผู้อนุมัติ',
    dashboardTitle: 'พื้นที่ทำงานของท่าน',
    dashboardLead: 'ดูสัญญา PO กำลังพล timesheet และเอกสารการเงิน — ครบในที่เดียว เรียบง่าย',
    dashboardMoreBilling: 'เพิ่มเติม: ภาพรวมการเงิน',
    rosterFromTeam: 'ดูรอบงาน (เวฟ)',
    accessRestricted: 'ไม่มีสิทธิ์เข้าใช้',
    portalOnly: 'ส่วนนี้สำหรับบัญชีพอร์ทัลลูกค้าเท่านั้น',
    open: 'เปิด',
    printHint: 'เปิดเอกสารแล้วใช้พิมพ์จากเบราว์เซอร์ (เช่น Ctrl+P)',
    viewerNoApprove: 'บัญชีดูอย่างเดียว — ยังแจ้งขอแก้ไขได้ ติดต่อ OPEC เพื่อขอสิทธิ์ Approver หากต้องอนุมัติ billing',
  },
} as const;

export type PortalDictKey = keyof typeof portalNav.en;

export function portalNavLabel(locale: PortalLocale, key: PortalDictKey): string {
  return portalNav[locale][key];
}
