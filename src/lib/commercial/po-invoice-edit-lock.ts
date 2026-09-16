import { isCommercialInvoiceSuperseded } from '@/lib/commercial/commercial-invoice-revision';
import type { CommercialInvoice } from '@/lib/types';

/** ใบแจ้งหนี้ที่ยังมีผล — ล็อกแก้หัว PO จนกว่าจะยกเลิก (VOID) หรือถูกแทนที่ */
export function isBlockingCommercialInvoiceForPoEdit(
  inv: Pick<CommercialInvoice, 'status' | 'supersededByInvoiceId'>,
): boolean {
  if ((inv.status || '') === 'VOID' || (inv.status || '') === 'REVISED') return false;
  if (isCommercialInvoiceSuperseded(inv)) return false;
  return true;
}

export function listBlockingCommercialInvoicesForPo(
  invoices: readonly CommercialInvoice[] | null | undefined,
): CommercialInvoice[] {
  return (invoices ?? []).filter((inv) => isBlockingCommercialInvoiceForPoEdit(inv));
}
