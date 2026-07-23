import type { Vendor, VendorBankAccount } from '@/lib/types';

export function createEmptyVendorBankAccount(partial?: Partial<VendorBankAccount>): VendorBankAccount {
  return {
    id: partial?.id || `vba-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: partial?.label ?? '',
    bankName: partial?.bankName ?? '',
    bankAccountName: partial?.bankAccountName ?? '',
    bankAccountNumber: partial?.bankAccountNumber ?? '',
    isPrimary: partial?.isPrimary ?? false,
  };
}

/** รวม bankAccounts ใหม่ + ฟิลด์เดิม (bankName/…) ให้เป็นรายการบัญชี */
export function resolveVendorBankAccounts(vendor: Pick<
  Vendor,
  'bankAccounts' | 'bankName' | 'bankAccountName' | 'bankAccountNumber'
> | null | undefined): VendorBankAccount[] {
  if (!vendor) return [];
  const listed = (vendor.bankAccounts ?? []).filter(
    (b) => b && (b.bankName?.trim() || b.bankAccountName?.trim() || b.bankAccountNumber?.trim() || b.id),
  );
  if (listed.length > 0) {
    const hasPrimary = listed.some((b) => b.isPrimary);
    return listed.map((b, i) => ({
      ...b,
      id: b.id || `vba-legacy-${i}`,
      isPrimary: hasPrimary ? !!b.isPrimary : i === 0,
    }));
  }
  const bankName = vendor.bankName?.trim() || '';
  const bankAccountName = vendor.bankAccountName?.trim() || '';
  const bankAccountNumber = vendor.bankAccountNumber?.trim() || '';
  if (!bankName && !bankAccountName && !bankAccountNumber) return [];
  return [
    createEmptyVendorBankAccount({
      id: 'vba-legacy-primary',
      label: 'บัญชีหลัก',
      bankName,
      bankAccountName,
      bankAccountNumber,
      isPrimary: true,
    }),
  ];
}

export function vendorBankAccountLabel(acct: VendorBankAccount, index = 0): string {
  const custom = acct.label?.trim();
  if (custom) return custom;
  const bank = acct.bankName?.trim() || 'ธนาคาร';
  const no = acct.bankAccountNumber?.trim();
  if (no) return `${bank} · ${no}`;
  return custom || `บัญชี ${index + 1}`;
}

/** ตั้งบัญชีหลัก + sync ฟิลด์ flat สำหรับโค้ดเก่า */
export function syncVendorPrimaryBankFields(bankAccounts: VendorBankAccount[]): {
  bankAccounts: VendorBankAccount[];
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
} {
  const cleaned = bankAccounts
    .map((b) => ({
      ...b,
      id: b.id || createEmptyVendorBankAccount().id,
      bankName: (b.bankName || '').trim(),
      bankAccountName: (b.bankAccountName || '').trim(),
      bankAccountNumber: (b.bankAccountNumber || '').trim(),
      label: (b.label || '').trim(),
    }))
    .filter((b) => b.bankName || b.bankAccountName || b.bankAccountNumber);

  if (cleaned.length === 0) {
    return { bankAccounts: [], bankName: '', bankAccountName: '', bankAccountNumber: '' };
  }

  let primaryIdx = cleaned.findIndex((b) => b.isPrimary);
  if (primaryIdx < 0) primaryIdx = 0;
  const withPrimary = cleaned.map((b, i) => ({ ...b, isPrimary: i === primaryIdx }));
  const primary = withPrimary[primaryIdx]!;
  return {
    bankAccounts: withPrimary,
    bankName: primary.bankName,
    bankAccountName: primary.bankAccountName,
    bankAccountNumber: primary.bankAccountNumber,
  };
}
