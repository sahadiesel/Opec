import type { AccountsReceivable, CommercialInvoice, TaxInvoice } from '@/lib/types';

/** ใบเรียกเก็บที่มีใบกำกับ ISSUED แล้ว — AR-COM เก่าถือว่าซ้ำและไม่แสดง */
export function buildSupersededCommercialInvoiceIds(params: {
  taxInvoices?: readonly Pick<TaxInvoice, 'id' | 'status' | 'sourceCommercialInvoiceId'>[];
  commercialInvoices?: readonly Pick<CommercialInvoice, 'id' | 'linkedTaxInvoiceId'>[];
}): Set<string> {
  const taxList = Array.isArray(params.taxInvoices) ? params.taxInvoices : [];
  const commercialList = Array.isArray(params.commercialInvoices) ? params.commercialInvoices : [];
  const issuedTaxIds = new Set<string>();
  const ids = new Set<string>();

  for (const tax of taxList) {
    if (tax.status !== 'ISSUED') continue;
    issuedTaxIds.add(tax.id);
    const cid = tax.sourceCommercialInvoiceId?.trim();
    if (cid) ids.add(cid);
  }

  for (const com of commercialList) {
    const linked = com.linkedTaxInvoiceId?.trim();
    if (linked && issuedTaxIds.has(linked)) {
      ids.add(com.id);
    }
  }

  return ids;
}

export function filterSupersededCommercialArEntries<
  T extends Pick<AccountsReceivable, 'referenceType' | 'referenceId'>,
>(items: readonly T[] | null | undefined, supersededCommercialIds: ReadonlySet<string>): T[] {
  const list = Array.isArray(items) ? items : [];
  if (supersededCommercialIds.size === 0) return [...list];
  return list.filter((item) => {
    if (item.referenceType !== 'COMMERCIAL_INVOICE') return true;
    const refId = item.referenceId?.trim();
    if (!refId) return true;
    return !supersededCommercialIds.has(refId);
  });
}
