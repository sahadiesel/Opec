'use client';

import { Button } from '@/components/ui/button';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';

type Props = {
  printLocale: PrintDocumentLocale;
  setPrintLocale: (l: PrintDocumentLocale) => void;
  /** When the document’s print language is fixed (e.g. after ISSUED), the button is non-interactive */
  readOnly?: boolean;
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
  readOnly,
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
        disabled={readOnly}
        onClick={() => {
          if (readOnly) return;
          setPrintLocale(printLocale === 'th' ? 'en' : 'th');
        }}
        title={
          readOnly
            ? printLocale === 'th'
              ? 'บันทึกภาษาเอกสารแล้ว: ไทย'
              : 'Print language is fixed: English'
            : printLocale === 'th'
              ? 'เปลี่ยนเป็นภาษาอังกฤษ'
              : 'Switch to Thai'
        }
        aria-pressed={printLocale === 'en'}
        aria-label={
          readOnly
            ? printLocale === 'th'
              ? 'ภาษาเอกสารที่บันทึก: ไทย'
              : 'Document print language (locked): English'
            : printLocale === 'th'
              ? 'ภาษาเอกสาร: ไทย — กดเพื่อเปลี่ยนเป็นอังกฤษ'
              : 'Document language: ENG — click for Thai'
        }
      >
        {printLocale === 'th' ? 'ไทย' : 'ENG'}
      </Button>
    </div>
  );
}
