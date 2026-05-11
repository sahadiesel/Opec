'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { usePortalLocale } from '@/contexts/portal-locale-context';

/**
 * ฉบับ DRAFT ใบกำกับ — ลูกค้า **ไม่** เปิดดูใน portal (ตรวจ/กดออกฉบับจริงฝั่ง OPEC เท่านั้น)
 */
export default function ClientTaxDraftInvoiceUnpublishedPage() {
  const { effectiveUser: currentUser, appUserLoading: userLoading, canAccessPortal } = useClientPortalIdentity();
  const { locale } = usePortalLocale();
  const en = locale === 'en';

  if (userLoading) return <p className="text-sm text-muted-foreground">…</p>;

  if (!currentUser || !canAccessPortal) {
    return <p className="text-sm text-muted-foreground">{en ? 'Portal only.' : 'เฉพาะพอร์ทัล'}</p>;
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 py-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/client-portal/accounting?tab=tax">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {en ? 'Back to tax invoices' : 'กลับ แท็บใบกำกับภาษี'}
        </Link>
      </Button>

      <Alert>
        <AlertTitle>{en ? 'Not available in the client portal' : 'ไม่แสดงใน client portal'}</AlertTitle>
        <AlertDescription className="text-sm space-y-2">
          {en ? (
            <>
              <p>
                Tax invoices in DRAFT are for OPEC to verify only. They do not appear for your company
                here until OPEC has issued the official copy (ISSUED).
              </p>
              <p>After that, the document is listed under Billing &amp; documents — Tax invoice.</p>
            </>
          ) : (
            <>
              <p>
                ฉบับ DRAFT ก่อนออกฉบับจริง ใช้ฝ่าย OPEC ตรวจสอบเท่านั้น ลูกค้าไม่ค้างดูฉบับนี้ใน portal จนกว่าทาง
                บัญชี OPEC จะกด «ยืนยันออกเอกสารจริง (ISSUED)» ก่อน
              </p>
              <p>หลังออกจริง จะปรากฏรายการที่ บัญชีและเอกสาร — แท็บ ใบกำกับภาษี</p>
            </>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}
