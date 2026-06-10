/** ความกว้างคอลัมน์ร่วม — ทะเบียนอุปกรณ์ / PPE (table-fixed, %) */
'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const STORE_CATALOG_TABLE_CLASS = 'table-fixed w-full';

/** รหัส 12% | ชื่อหลัก 20% | ขนาด/รุ่น 18% | หมวด/คงเหลือ/สถานะ/จัดการ 12.5% ต่อคอลัมน์ */
export const STORE_CATALOG_COL_WIDTHS = {
  code: '12%',
  name: '20%',
  variant: '18%',
  category: '12.5%',
  stock: '12.5%',
  status: '12.5%',
  actions: '12.5%',
} as const;

export function StoreCatalogColGroup() {
  const { code, name, variant, category, stock, status, actions } = STORE_CATALOG_COL_WIDTHS;
  return (
    <colgroup>
      <col style={{ width: code }} />
      <col style={{ width: name }} />
      <col style={{ width: variant }} />
      <col style={{ width: category }} />
      <col style={{ width: stock }} />
      <col style={{ width: status }} />
      <col style={{ width: actions }} />
    </colgroup>
  );
}

/** padding แนวตั้ง py-2.5 (~ลดความสูงแถว ~10% จาก py-3) */
const rowPy = 'py-2.5';

export const storeCatalogCol = {
  codeHead: `font-bold h-auto ${rowPy} pl-6`,
  codeCell: `pl-6 ${rowPy} font-mono text-xs font-bold whitespace-nowrap align-top`,
  codeCellChild: `pl-10 ${rowPy} font-mono text-xs text-muted-foreground whitespace-nowrap align-top`,
  nameHead: `font-bold h-auto ${rowPy} min-w-0`,
  nameCell: `${rowPy} font-bold min-w-0 align-top`,
  nameCellChild: `${rowPy} text-muted-foreground text-sm italic pl-6 min-w-0 align-top`,
  variantHead: `font-bold h-auto ${rowPy} align-top`,
  variantCell: `${rowPy} text-sm text-muted-foreground min-w-0 align-top`,
  categoryHead: `font-bold h-auto ${rowPy} align-top`,
  categoryCell: `${rowPy} align-top`,
  stockHead: `font-bold h-auto ${rowPy} text-center align-top`,
  stockCell: `${rowPy} text-center align-top whitespace-nowrap`,
  statusHead: `font-bold h-auto ${rowPy} text-center align-top`,
  statusCell: `${rowPy} text-center align-top`,
  actionsHead: `text-right h-auto pr-4 ${rowPy} align-top`,
  actionsCell: `text-right pr-4 ${rowPy} align-top whitespace-nowrap space-x-1`,
} as const;

/** ปุ่มแก้ไข/ลบในแถวตาราง — ลดขนาด ~10% จาก h-8 */
export const STORE_CATALOG_ROW_ACTION_BTN_CLASS = 'h-7 w-7';

/** เปิด/ปิดแถวรุ่นย่อยตาม header id — ค่าเริ่มต้นซ่อนทั้งหมด */
export function useStoreCatalogVariantExpansion() {
  const [expandedHeaderIds, setExpandedHeaderIds] = useState<Set<string>>(() => new Set());

  const isVariantExpanded = useCallback(
    (headerId: string) => expandedHeaderIds.has(headerId),
    [expandedHeaderIds],
  );

  const toggleVariantExpanded = useCallback((headerId: string) => {
    setExpandedHeaderIds((prev) => {
      const next = new Set(prev);
      if (next.has(headerId)) next.delete(headerId);
      else next.add(headerId);
      return next;
    });
  }, []);

  return { isVariantExpanded, toggleVariantExpanded };
}

type StoreCatalogViewVariantsButtonProps = {
  headerId: string;
  childCount: number;
  expanded: boolean;
  onToggle: (headerId: string) => void;
  className?: string;
};

export function StoreCatalogViewVariantsButton({
  headerId,
  childCount,
  expanded,
  onToggle,
  className,
}: StoreCatalogViewVariantsButtonProps) {
  if (childCount <= 0) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('h-[1.35rem] shrink-0 px-2 text-[10px] font-normal', className)}
      onClick={() => onToggle(headerId)}
    >
      {expanded ? 'ซ่อนรุ่นย่อย' : 'ดูรุ่นย่อย'}
    </Button>
  );
}
