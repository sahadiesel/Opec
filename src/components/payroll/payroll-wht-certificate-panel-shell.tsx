'use client';

import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { WithholdingCertificateCopyVariant } from '@/lib/types';

const ALL_VARIANTS: WithholdingCertificateCopyVariant[] = [
  'COPY_PAYEE_TAX_RETURN',
  'COPY_PAYEE_RECORD',
  'COPY_PAYER_RECORD',
];

export type PayrollWhtValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Shared presentational shell for Worker / Office / Executive ภงด. certificate panels.
 * Domain panels own data loading + VM build; this shell only renders status + print UI.
 */
export function PayrollWhtCertificatePanelShell({
  loading,
  loadingLabel,
  loadErr,
  validation,
  previewHtml,
  iframeTitle,
  canPrint,
  canXml,
  onPrint,
  onXml,
  toolbarHost = null,
}: {
  loading: boolean;
  loadingLabel: string;
  loadErr: string | null;
  validation: PayrollWhtValidationResult;
  previewHtml: string;
  iframeTitle: string;
  canPrint: boolean;
  canXml: boolean;
  onPrint: (variants: WithholdingCertificateCopyVariant[]) => void;
  onXml: () => void;
  toolbarHost?: HTMLElement | null;
}) {
  const toolbar: ReactNode = (
    <div className="flex flex-wrap gap-2 justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" disabled={!canPrint} className="gap-1.5">
            <Printer className="h-4 w-4" />
            พิมพ์…
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onPrint(['COPY_PAYEE_TAX_RETURN'])}>พิมพ์ฉบับที่ 1</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onPrint(['COPY_PAYEE_RECORD'])}>พิมพ์ฉบับที่ 2</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onPrint(['COPY_PAYER_RECORD'])}>พิมพ์สำเนาผู้หักภาษี</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onPrint([...ALL_VARIANTS])}>พิมพ์ครบชุด (3 ฉบับ)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {canXml ? (
        <Button type="button" variant="secondary" size="sm" disabled={!canPrint} onClick={onXml}>
          Generate Internal XML (JSON)
        </Button>
      ) : null}
    </div>
  );

  return (
    <>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-5 w-5 animate-spin" /> {loadingLabel}
        </div>
      ) : null}

      {loadErr ? (
        <Alert variant="destructive">
          <AlertTitle>โหลดข้อมูลไม่สำเร็จ</AlertTitle>
          <AlertDescription>{loadErr}</AlertDescription>
        </Alert>
      ) : null}

      {!loading && !loadErr && !validation.ok ? (
        <Alert variant="destructive">
          <AlertTitle>ตรวจสอบข้อมูลก่อนพิมพ์</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 space-y-1">
              {validation.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {!loading && !loadErr && validation.warnings.length > 0 ? (
        <Alert>
          <AlertTitle>หมายเหตุ</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 space-y-1">
              {validation.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}

      {previewHtml ? (
        <iframe title={iframeTitle} className="w-full min-h-[560px] border rounded-md bg-white" srcDoc={previewHtml} />
      ) : (
        <p className="text-sm text-muted-foreground py-6">ยังไม่มีตัวอย่าง — โหลดข้อมูลหรือแก้ validation ก่อน</p>
      )}
    </>
  );
}
