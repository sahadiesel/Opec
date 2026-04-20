'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { readStoredPrintLocale, writeStoredPrintLocale } from '@/lib/documents/document-print-i18n';

/** ภาษาของเอกสารตอนพิมพ์ (เก็บใน localStorage — ใช้ร่วมทุกหน้าที่มีปุ่มพิมพ์) */
export function useDocumentPrintLocale(): {
  printLocale: PrintDocumentLocale;
  setPrintLocale: (l: PrintDocumentLocale) => void;
} {
  const [printLocale, setState] = useState<PrintDocumentLocale>('th');
  useEffect(() => {
    setState(readStoredPrintLocale());
  }, []);
  const setPrintLocale = useCallback((l: PrintDocumentLocale) => {
    setState(l);
    writeStoredPrintLocale(l);
  }, []);
  return { printLocale, setPrintLocale };
}
