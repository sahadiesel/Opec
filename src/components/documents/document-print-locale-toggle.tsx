'use client';

import { Button } from '@/components/ui/button';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';

type Props = {
  printLocale: PrintDocumentLocale;
  setPrintLocale: (l: PrintDocumentLocale) => void;
  /** e.g. portal `t('docPrintLocaleHint')` — bilingual label for print language */
  hint?: string;
  /** @deprecated use `hint` */
  showLabel?: boolean;
  className?: string;
};

/** ปุ่มสลับภาษาเอกสารพิมพ์: ไทย ↔ ENG + คำอธิบาย (ถ้ามี) */
export function DocumentPrintLocaleToggle({
  printLocale,
  setPrintLocale,
  hint,
  showLabel,
  className,
}: Props) {
  const label = hint ?? (showLabel ? 'ภาษาเอกสาร' : undefined);
  return (
    <div className={`flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 shrink-0 ${className ?? ''}`}>
      {label ? <span className="text-xs text-muted-foreground leading-snug max-w-[18rem]">{label}</span> : null}
      <Button
        type="button"
        variant={printLocale === 'en' ? 'secondary' : 'outline'}
        size="sm"
        className="h-8 min-w-[3.25rem] px-2.5"
        onClick={() => setPrintLocale(printLocale === 'th' ? 'en' : 'th')}
        title={printLocale === 'th' ? 'เปลี่ยนเป็นภาษาอังกฤษ' : 'Switch to Thai'}
        aria-pressed={printLocale === 'en'}
        aria-label={
          printLocale === 'th'
            ? 'ภาษาเอกสาร: ไทย — กดเพื่อเปลี่ยนเป็นอังกฤษ'
            : 'Document language: ENG — click for Thai'
        }
      >
        {printLocale === 'th' ? 'ไทย' : 'ENG'}
      </Button>
    </div>
  );
}
