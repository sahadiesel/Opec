'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Layers, ShoppingCart } from 'lucide-react';
import type { PurchaseOrder } from '@/lib/types';

type Props = {
  poId: string | null;
  po: PurchaseOrder | undefined | null;
  /** `po_active_bundles` id — กรองหลาย PO ในลูกค้าเดียว + Onshore/Offshore */
  poActiveBundleId?: string | null;
  /** รหัส PO ในชุด (แสดงในแบนเนอร์) */
  bundlePoCodes?: string[];
  /** Path without query to clear filter, e.g. "/waves" */
  listBasePath: string;
  /** Short label for screen context */
  moduleLabel: string;
};

function parsePoActiveBundleDocId(id: string): { customerId: string; workMode: string } | null {
  const sep = '__';
  const i = id.lastIndexOf(sep);
  if (i <= 0 || i + sep.length >= id.length) return null;
  return { customerId: id.slice(0, i), workMode: id.slice(i + sep.length) };
}

function workModeShortLabel(mode: string): string {
  const u = mode.toUpperCase();
  if (u === 'ONSHORE') return 'Onshore';
  if (u === 'OFFSHORE') return 'Offshore';
  return mode;
}

/**
 * แสดงเมื่อ URL มี ?poActiveBundleId= หรือ ?poId= — deep link / breadcrumb บนหน้ารายการ
 */
export function PoFilterContextBanner({
  poId,
  po,
  poActiveBundleId,
  bundlePoCodes,
  listBasePath,
  moduleLabel,
}: Props) {
  const bundleId = (poActiveBundleId || '').trim();
  if (bundleId) {
    const parsed = parsePoActiveBundleDocId(bundleId);
    const codes = (bundlePoCodes || []).filter(Boolean);
    const codesLine = codes.length ? codes.join(', ') : '—';

    return (
      <Alert className="border-primary/30 bg-primary/5 shadow-sm">
        <Layers className="h-4 w-4 text-primary" />
        <AlertTitle className="text-sm font-bold flex flex-wrap items-center justify-between gap-2">
          <span>
            กรองตาม PO Active ชุด <span className="text-muted-foreground font-normal">({moduleLabel})</span>
          </span>
          <Button variant="outline" size="sm" className="h-8 shrink-0" asChild>
            <Link href={listBasePath}>ล้างการกรอง</Link>
          </Button>
        </AlertTitle>
        <AlertDescription className="mt-2 flex flex-wrap flex-col gap-2 text-sm">
          <span className="font-medium text-foreground">
            {parsed ? (
              <>
                ลูกค้า <span className="font-mono text-xs">{parsed.customerId}</span>
                <span className="text-muted-foreground"> · </span>
                {workModeShortLabel(parsed.workMode)}
              </>
            ) : (
              <span className="font-mono text-xs">{bundleId}</span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            PO ในชุด: <span className="font-mono font-medium text-foreground">{codesLine}</span>
          </span>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Button variant="link" className="h-auto p-0 text-primary font-semibold" asChild>
              <Link href={`/po-active/${encodeURIComponent(bundleId)}`}>← เปิด PO Active</Link>
            </Button>
            <Button variant="link" className="h-auto p-0 text-primary font-semibold" asChild>
              <Link href="/po-active-quota-queue">← คิวเติมโควต้า</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

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
