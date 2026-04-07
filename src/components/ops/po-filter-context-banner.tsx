'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ShoppingCart } from 'lucide-react';
import type { PurchaseOrder } from '@/lib/types';

type Props = {
  poId: string | null;
  po: PurchaseOrder | undefined | null;
  /** Path without query to clear filter, e.g. "/waves" */
  listBasePath: string;
  /** Short label for screen context */
  moduleLabel: string;
};

/**
 * แสดงเมื่อ URL มี ?poId= — ขั้นที่ 2 (deep link / breadcrumb บนหน้ารายการ)
 */
export function PoFilterContextBanner({ poId, po, listBasePath, moduleLabel }: Props) {
  if (!poId?.trim()) return null;
  const title = po ? `${po.poCode} — ${po.title}` : `รหัส PO: ${poId}`;

  return (
    <Alert className="border-primary/30 bg-primary/5 shadow-sm">
      <ShoppingCart className="h-4 w-4 text-primary" />
      <AlertTitle className="text-sm font-bold flex flex-wrap items-center justify-between gap-2">
        <span>
          กรองตาม Customer PO <span className="text-muted-foreground font-normal">({moduleLabel})</span>
        </span>
        <Button variant="outline" size="sm" className="h-8 shrink-0" asChild>
          <Link href={listBasePath}>ล้างการกรอง</Link>
        </Button>
      </AlertTitle>
      <AlertDescription className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium text-foreground">{title}</span>
        {po ? (
          <Button variant="link" className="h-auto p-0 text-primary font-semibold" asChild>
            <Link href={`/purchase-orders/${poId}`}>← กลับหน้า PO</Link>
          </Button>
        ) : (
          <span className="text-amber-800 text-xs">ไม่พบ PO นี้ในระบบ — ตรวจสอบลิงก์หรือสิทธิ์อ่าน</span>
        )}
      </AlertDescription>
    </Alert>
  );
}
