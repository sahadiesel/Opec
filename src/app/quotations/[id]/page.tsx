'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  Save, 
  Plus, 
  Trash2, 
  FileText, 
  History,
  Info,
  Loader2,
  CheckCircle2,
  XCircle,
  Briefcase,
  Printer,
  Edit2,
  Calculator,
  ArrowUp,
  ArrowDown,
  Tag,
  Send,
  Lock,
  ExternalLink
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection, useUser } from '@/firebase';
import { doc, collection, updateDoc, addDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { Quotation, QuotationLine, QuotationStatus, User } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageGuidance } from '@/components/layout/page-guidance';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit } from '@/lib/permissions';

import { buildQuotationPrintHtml, openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { QuotationPreviewTab } from './_components/quotation-preview-tab';
import { QuotationHistoryTab } from './_components/quotation-history-tab';
import { QuotationLineDialog } from './_components/quotation-line-dialog';
import { sanitizeFirestorePayload } from '@/lib/utils';

type CompanyDocumentProfile = {
  companyNameTh?: string;
  companyNameEn?: string;
  taxId?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
};

export default function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading, userDocError } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const canViewQuotations = useMemo(() => canView(currentUser, 'quotations'), [currentUser]);
  const canEditQuotations = useMemo(() => canEdit(currentUser, 'quotations'), [currentUser]);

  // --- Data Subscription ---
  const quotationRef = useMemoFirebase(
    () => (firestore && canViewQuotations ? doc(firestore, 'quotations', id) : null),
    [firestore, canViewQuotations, id]
  );
  const { data: quotation, isLoading: isQuoLoading, error: quotationLoadError } = useDoc<Quotation>(quotationRef as any);

  const linesQuery = useMemoFirebase(
    () => (firestore && canViewQuotations ? collection(firestore, 'quotations', id, 'lines') : null),
    [firestore, canViewQuotations, id]
  );
  const { data: lines, isLoading: isLinesLoading } = useCollection<QuotationLine>(linesQuery as any);
  const companyProfileRef = useMemoFirebase(
    () => (firestore && canViewQuotations ? doc(firestore, 'system', 'company_profile') : null),
    [firestore, canViewQuotations]
  );
  const { data: companyProfile } = useDoc<CompanyDocumentProfile>(companyProfileRef as any);

  const { printLocale, setPrintLocale } = useDocumentPrintLocale();

  const [isEditMode, setIsEditMode] = useState(false);
  const [editedHeader, setEditedHeader] = useState<Partial<Quotation>>({});
  const [draftLines, setDraftLines] = useState<QuotationLine[]>([]);
  
  const [isLineDialogOpen, setIsLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<Partial<QuotationLine> | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  useEffect(() => {
    if (quotation) setEditedHeader(quotation);
  }, [quotation]);

  useEffect(() => {
    if (lines && !isEditMode) {
      setDraftLines([...lines].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)));
    }
  }, [lines, isEditMode]);

  /** ใช้เฉพาะ Firebase Auth — อย่า redirect เมื่อแค่โปรไฟล์ Firestore ยังโหลดไม่เสร็จ (มิฉะนั้นจะเด้งไป `/` ทั้งที่ล็อกอินอยู่) */
  useEffect(() => {
    if (!isUserLoading && !firebaseUser) {
      router.replace('/');
    }
  }, [isUserLoading, firebaseUser, router]);

  // --- Workflow Logic ---
  const isDraft = quotation?.status === 'draft';
  const isSent = quotation?.status === 'sent';
  const isFinalized = quotation ? ['accepted', 'rejected', 'cancelled', 'expired'].includes(quotation.status) : false;
  const isRevised = quotation?.status === 'revised';
  const canStartEdit = !isRevised && (isDraft || isSent);
  const isEditable = isEditMode && canStartEdit;
  const statusDisplay = quotation?.status === 'revised' ? 'มีการแก้ไข' : quotation?.status;
  const displayLines = isEditMode ? draftLines : [...(lines || [])].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

  const computeTotals = (currentLines: QuotationLine[], header: Partial<Quotation>) => {
    const subtotal = currentLines.reduce((sum, l) => sum + (Number(l.lineTotal) || 0), 0);
    const taxPercent = Number(header.taxPercent ?? quotation?.taxPercent ?? 7) || 7;
    const discountAmount = Number(header.discountAmount ?? quotation?.discountAmount ?? 0) || 0;
    const taxAmount = (subtotal - discountAmount) * (taxPercent / 100);
    const grandTotal = subtotal - discountAmount + taxAmount;
    return { subtotal, taxAmount, grandTotal, discountAmount, taxPercent };
  };

  const handlePrintQuotation = () => {
    if (!quotation) return;
    const headerSlice = isEditMode ? editedHeader : quotation;
    const t = computeTotals(displayLines, headerSlice);
    const body = buildQuotationPrintHtml({
      company: companyProfile ?? undefined,
      quotation,
      lines: displayLines,
      totalsOverride: {
        subtotal: t.subtotal,
        discountAmount: t.discountAmount,
        taxAmount: t.taxAmount,
        grandTotal: t.grandTotal,
        taxPercent: t.taxPercent,
      },
      printedAtMs: Date.now(),
      locale: printLocale,
    });
    if (
      !openStandardPrintWindow({
        windowTitle: quotation.quotationNo,
        bodyInnerHtml: body,
        htmlLang: printLocale,
      })
    ) {
      toast({
        variant: 'destructive',
        title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  };

  const handleUpdateStatus = (newStatus: QuotationStatus) => {
    if (!canEditQuotations) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขสถานะใบเสนอราคา' });
      return;
    }
    if (!quotationRef) return;
    const patch: Record<string, unknown> = { status: newStatus, updatedAt: Date.now() };
    if (newStatus === 'sent') {
      patch.customerRevisionRequestedAt = deleteField();
      patch.customerRevisionRequestNote = deleteField();
      patch.customerRevisionIssueId = deleteField();
    }
    void updateDoc(quotationRef, sanitizeFirestorePayload(patch) as any);

    let msg = `เปลี่ยนสถานะเป็น ${newStatus.toUpperCase()}`;
    if (newStatus === 'sent') msg = "ทำเครื่องหมายว่าส่งเอกสารแล้ว (Marked as Sent)";
    if (newStatus === 'accepted') msg = "ลูกค้ายืนยันตกลง (Client Accepted)";
    if (newStatus === 'draft') msg = "เปิดสิทธิ์แก้ไขเอกสาร (Revised to Draft)";

    toast({ title: "อัปเดตสถานะสำเร็จ", description: msg });
  };

  /** ลูกค้าขอแก้ไขใน portal — เปิดฉบับร่างเพื่อแก้แล้วส่งใหม่ */
  const handleOpenDraftAfterCustomerNegotiation = async () => {
    if (!canEditQuotations || !quotationRef || !quotation || quotation.status !== 'sent') return;
    if (!quotation.customerRevisionRequestedAt) return;
    try {
      await updateDoc(
        quotationRef,
        sanitizeFirestorePayload({
          status: 'draft',
          updatedAt: Date.now(),
          updatedBy: currentUser?.id,
          customerRevisionRequestedAt: deleteField(),
          customerRevisionRequestNote: deleteField(),
          customerRevisionIssueId: deleteField(),
        }) as any,
      );
      toast({
        title: 'เปิดฉบับร่างแล้ว',
        description: 'แก้ไขรายการและเงื่อนไข แล้วกดส่งให้ลูกค้าอีกครั้ง',
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  /** Persist draft quotation on the same document (no R1 fork). */
  const handleSaveDraftInPlace = async () => {
    if (!canEditQuotations) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขใบเสนอราคา' });
      return;
    }
    if (!firestore || !quotation || !quotationRef || !currentUser) return;
    if (quotation.status !== 'draft') return;

    setIsSavingDraft(true);
    try {
      const totals = computeTotals(draftLines, editedHeader);

      await updateDoc(
        quotationRef,
        sanitizeFirestorePayload({
          projectTitle: editedHeader.projectTitle ?? quotation.projectTitle,
          issueDate: editedHeader.issueDate ?? quotation.issueDate,
          validUntilDate: editedHeader.validUntilDate ?? quotation.validUntilDate,
          currency: editedHeader.currency ?? quotation.currency,
          discountAmount: totals.discountAmount,
          taxPercent: totals.taxPercent,
          notes: editedHeader.notes ?? quotation.notes,
          internalNotes: editedHeader.internalNotes ?? quotation.internalNotes,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          grandTotal: totals.grandTotal,
          updatedAt: Date.now(),
          updatedBy: currentUser.id,
        })
      );

      const previousIds = new Set((lines || []).map((l) => l.id));
      const currentIds = new Set(draftLines.map((l) => l.id));

      for (const prevId of previousIds) {
        if (!currentIds.has(prevId)) {
          await deleteDoc(doc(firestore, 'quotations', id, 'lines', prevId));
        }
      }

      for (const line of draftLines) {
        const linePayload = {
          quotationId: id,
          description: line.description,
          quantity: Number(line.quantity) || 0,
          unit: line.unit || 'EA',
          unitPrice: Number(line.unitPrice) || 0,
          lineTotal: Number(line.lineTotal) || 0,
          remarks: line.remarks || '',
          displayOrder: line.displayOrder ?? 0,
          updatedAt: Date.now(),
        };

        if (line.id.startsWith('draft-')) {
          await addDoc(collection(firestore, 'quotations', id, 'lines'), {
            ...linePayload,
            createdAt: Date.now(),
          });
        } else {
          await updateDoc(doc(firestore, 'quotations', id, 'lines', line.id), linePayload);
        }
      }

      setIsEditMode(false);
      toast({ title: 'บันทึกร่างสำเร็จ', description: 'ข้อมูลใบเสนอราคาถูกบันทึกแล้ว' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'กรุณาลองใหม่อีกครั้ง';
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: message });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleCreateRevision = async () => {
    if (!canEditQuotations) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขใบเสนอราคา' });
      return;
    }
    if (!firestore || !quotation || !quotationRef || !currentUser) return;
    if (quotation.status === 'draft') return;
    if (quotation.status === 'revised') {
      toast({ variant: 'destructive', title: 'เอกสารถูกแก้ไขแล้ว', description: 'ฉบับนี้เปิดแก้ไขต่อไม่ได้ ให้เปิดที่ฉบับล่าสุดแทน' });
      return;
    }

    const baseNo = quotation.baseQuotationNo || quotation.quotationNo;
    const nextRevisionNo = (quotation.revisionNo || 0) + 1;
    const revisedNo = `${baseNo}R${nextRevisionNo}`;

    try {
      const totals = computeTotals(draftLines, editedHeader);
      const { id: revisionId } = await addDoc(collection(firestore, 'quotations'), {
        ...quotation,
        ...editedHeader,
        quotationNo: revisedNo,
        baseQuotationNo: baseNo,
        revisionNo: nextRevisionNo,
        revisedFromQuotationId: quotation.id,
        supersededByQuotationId: null,
        status: 'draft',
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        grandTotal: totals.grandTotal,
        discountAmount: totals.discountAmount,
        taxPercent: totals.taxPercent,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: currentUser.displayName,
        updatedBy: currentUser.id,
      });

      for (const line of draftLines) {
        const { id: _ignore, ...lineData } = line;
        await addDoc(collection(firestore, 'quotations', revisionId, 'lines'), {
          ...lineData,
          quotationId: revisionId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      await updateDoc(quotationRef, {
        status: 'revised',
        supersededByQuotationId: revisionId,
        updatedAt: Date.now(),
      });

      toast({ title: 'สร้างเอกสาร Revision สำเร็จ', description: `เลขที่ใหม่ ${revisedNo}` });
      setIsEditMode(false);
      router.push(`/quotations/${revisionId}`);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'สร้าง Revision ไม่สำเร็จ', description: error?.message || 'กรุณาลองใหม่อีกครั้ง' });
    }
  };

  const handleStartEdit = () => {
    if (!canEditQuotations) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีสิทธิ์แก้ไข',
        description: 'บัญชีของคุณดูใบเสนอราคาได้อย่างเดียว — ติดต่อผู้ดูแลระบบหากต้องการแก้ไข',
      });
      return;
    }
    if (!quotation) return;
    setEditedHeader(quotation);
    setDraftLines([...(lines || [])].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)));
    setIsEditMode(true);
  };

  const handleCancelEdit = () => {
    if (!quotation) return;
    setEditedHeader(quotation);
    setDraftLines([...(lines || [])].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)));
    setIsEditMode(false);
    setIsLineDialogOpen(false);
    setEditingLine(null);
  };

  // --- Handlers: Line Items ---
  const handleOpenAddLine = () => {
    if (!isEditable) return;
    setEditingLine({ 
      description: '', 
      quantity: 1, 
      unit: 'EA', 
      unitPrice: 0, 
      remarks: '', 
      displayOrder: (draftLines.length || 0) + 1
    });
    setIsLineDialogOpen(true);
  };

  const handleOpenEditLine = (line: QuotationLine) => {
    if (!isEditable) return;
    setEditingLine({ ...line });
    setIsLineDialogOpen(true);
  };

  const handleSaveLine = async () => {
    if (!editingLine?.description || !isEditable) return;
    
    const qty = Number(editingLine.quantity) || 0;
    const price = Number(editingLine.unitPrice) || 0;
    const lineTotal = qty * price;
    
    const lineData = {
      ...editingLine,
      quantity: qty,
      unitPrice: price,
      lineTotal,
      updatedAt: Date.now()
    };

    if (editingLine.id) {
      setDraftLines(prev => prev.map(l => l.id === editingLine.id ? { ...l, ...lineData } as QuotationLine : l));
    } else {
      setDraftLines(prev => [
        ...prev,
        {
          ...lineData,
          id: `draft-${Date.now()}`,
          quotationId: id,
          createdAt: Date.now(),
        } as QuotationLine,
      ]);
    }

    setIsLineDialogOpen(false);
    setEditingLine(null);
    toast({ title: "บันทึกในร่างแก้ไขแล้ว", description: "กด 'บันทึก Revision' เพื่อยืนยันการเปลี่ยนแปลงทั้งหมด" });
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!isEditable) return;
    if (!confirm('ยืนยันการลบรายการนี้?')) return;
    setDraftLines(prev => prev.filter(l => l.id !== lineId));
    toast({ title: "ลบรายการสำเร็จ" });
  };

  const handleMoveLine = async (line: QuotationLine, direction: 'up' | 'down') => {
    if (!isEditable) return;
    setDraftLines(prev => {
      const sorted = [...prev].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
      const currentIndex = sorted.findIndex(l => l.id === line.id);
      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (newIndex < 0 || newIndex >= sorted.length) return prev;
      const other = sorted[newIndex];
      const curOrder = sorted[currentIndex].displayOrder || 0;
      sorted[currentIndex] = { ...sorted[currentIndex], displayOrder: other.displayOrder || 0 };
      sorted[newIndex] = { ...sorted[newIndex], displayOrder: curOrder };
      return [...sorted];
    });
  };

  if (isUserLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }
  if (!firebaseUser) {
    return null;
  }
  if (userDocError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <p className="max-w-md text-center text-muted-foreground">
          โหลดข้อมูลผู้ใช้จากระบบไม่สำเร็จ — ลองรีเฟรชหรือล็อกอินใหม่
        </p>
        <Button type="button" variant="outline" onClick={() => router.push('/')}>
          กลับหน้าหลัก
        </Button>
      </div>
    );
  }
  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!canViewQuotations) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  if (isQuoLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  if (quotationLoadError || !quotation) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-lg mx-auto py-16 px-4 text-center space-y-4">
          <p className="text-muted-foreground">
            {quotationLoadError
              ? 'โหลดข้อมูลไม่สำเร็จ (สิทธิ์การเข้าถึงหรือเครือข่าย) — ลองรีเฟรชหรือตรวจสอบการล็อกอิน'
              : 'ไม่พบใบเสนอราคานี้ หรืออาจถูกลบแล้ว'}
          </p>
          <Button type="button" variant="outline" onClick={() => router.push('/quotations')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> กลับไปรายการใบเสนอราคา
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between print:hidden">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/quotations')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex flex-col">
              <h1 className="text-2xl font-bold tracking-tight text-primary">Quotation Workspace</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-mono font-bold text-primary">{quotation.quotationNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <div className="flex items-center gap-1">
                  <span>ลูกค้า: {quotation.customerNameSnapshot || '...'}</span>
                  {quotation.customerId && (
                    <Button variant="link" className="h-auto p-0 text-xs text-blue-600 font-bold" asChild>
                      <Link href={`/customers/${quotation.customerId}`}>
                        (View Profile <ExternalLink className="h-3 w-3 inline" />)
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <DocumentPrintLocaleToggle printLocale={printLocale} setPrintLocale={setPrintLocale} showLabel />
            <Button
              variant="outline"
              type="button"
              className="gap-2 border-primary text-primary hover:bg-primary/5 h-11 px-6 shadow-sm"
              onClick={() => handlePrintQuotation()}
            >
              <Printer className="h-4 w-4" /> พิมพ์เอกสาร (Print)
            </Button>
            <Badge variant={(isFinalized || isRevised) ? "default" : "outline"} className={`py-1.5 px-4 font-bold uppercase ${(isFinalized || isRevised) ? "bg-slate-900 text-white" : "border-primary/20 bg-primary/5 text-primary"}`}>
              {(isFinalized || isRevised) && <Lock className="h-3 w-3 mr-2" />}
              STATUS: {statusDisplay}
            </Badge>
          </div>
        </div>

        <Tabs defaultValue="edit" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-fit h-auto p-1 bg-muted/50 print:hidden">
            <TabsTrigger value="edit" className="gap-2 py-2 px-8"><Edit2 className="h-4 w-4" /> {isEditMode ? 'กำลังแก้ไข (Editing)' : 'ดูรายละเอียด (View)'}</TabsTrigger>
            <TabsTrigger value="preview" className="gap-2 py-2 px-8"><FileText className="h-4 w-4" /> พรีวิวเอกสาร (Preview)</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 px-8"><History className="h-4 w-4" /> ประวัติ (History)</TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="mt-6 space-y-6 print:hidden">
            <PageGuidance 
              title="สถานะปัจจุบัน (Document Stage)"
              tips={[
                isDraft ? "ฉบับร่าง (Draft): สามารถกด 'แก้ไขเอกสาร' แล้วค่อยปรับข้อมูลได้" :
                isSent ? "ส่งแล้ว (Sent): หากลูกค้าต่อรองราคา ให้กด 'แก้ไขเอกสาร' และบันทึกเป็น Revision ใหม่" :
                "สิ้นสุด (Finalized): เอกสารนี้ถูกปิดสถานะแล้ว ไม่สามารถแก้ไขข้อมูลได้อีก"
              ]}
            />

            {isSent && quotation.customerRevisionRequestedAt && (
              <Card className="border-amber-400 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-amber-950 dark:text-amber-100">
                    ลูกค้าแจ้งขอแก้ไข / ต่อรอง (Client negotiation request)
                  </CardTitle>
                  <CardDescription className="text-amber-900/90 dark:text-amber-200/90">
                    แจ้งเมื่อ {new Date(quotation.customerRevisionRequestedAt).toLocaleString('th-TH')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="whitespace-pre-wrap rounded-md border border-amber-200/80 bg-white/80 p-3 text-amber-950 dark:border-amber-800 dark:bg-zinc-900/50 dark:text-amber-50">
                    {quotation.customerRevisionRequestNote?.trim() || '—'}
                  </p>
                  <Button
                    type="button"
                    className="bg-amber-700 hover:bg-amber-800"
                    onClick={() => void handleOpenDraftAfterCustomerNegotiation()}
                  >
                    เปิดฉบับร่างเพื่อแก้ไขตามที่ลูกค้าขอ แล้วส่งใหม่
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Header Information Card */}
                <Card className="shadow-sm border-none bg-white">
                  <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Tag className="h-5 w-5 text-primary" /> ข้อมูลหัวเอกสาร (Header Info)
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2 col-span-2">
                        <Label className="font-bold">หัวข้อโครงการ (Project Title)</Label>
                        <Input disabled={!isEditMode} value={editedHeader.projectTitle || ''} onChange={e => setEditedHeader({...editedHeader, projectTitle: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">วันที่ออกเอกสาร (Issue Date)</Label>
                        <DatePickerThaiBE
                          disabled={!isEditMode}
                          value={htmlDateValueToTimestampMs(editedHeader.issueDate)}
                          onChange={(ms) =>
                            setEditedHeader({ ...editedHeader, issueDate: timestampToHtmlDateValue(ms) })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">วันหมดอายุข้อเสนอ (Valid Until)</Label>
                        <DatePickerThaiBE
                          disabled={!isEditMode}
                          value={htmlDateValueToTimestampMs(editedHeader.validUntilDate)}
                          onChange={(ms) =>
                            setEditedHeader({ ...editedHeader, validUntilDate: timestampToHtmlDateValue(ms) })
                          }
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Line Item Editor Table */}
                <Card className="shadow-sm border-none bg-white overflow-hidden">
                  <CardHeader className="flex flex-row items-center justify-between border-b pb-4 bg-muted/5">
                    <div>
                      <CardTitle className="text-lg">รายการบริการ (Quotation Lines)</CardTitle>
                      <CardDescription>ระบุรายละเอียดสินค้าหรือบริการและราคาเสนอขาย</CardDescription>
                    </div>
                    {isEditMode && (
                      <Button className="bg-primary font-bold shadow-md h-10" onClick={handleOpenAddLine}>
                        <Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ (Add Item)
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="pl-6 w-[60px] text-center">#</TableHead>
                          <TableHead>รายละเอียด (Description)</TableHead>
                          <TableHead className="text-center w-[100px]">จำนวน/หน่วย</TableHead>
                          <TableHead className="text-right w-[140px]">ราคา/หน่วย</TableHead>
                          <TableHead className="text-right w-[140px] font-bold">ยอดรวม</TableHead>
                          <TableHead className="text-right pr-6 w-[140px]">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayLines.map((line, index) => (
                          <TableRow key={line.id} className="group hover:bg-muted/10 transition-colors">
                            <TableCell className="pl-6 text-xs text-muted-foreground text-center font-mono">
                              {index + 1}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-bold text-sm text-primary">{line.description}</span>
                                {line.remarks && <span className="text-[10px] text-muted-foreground italic truncate max-w-[200px]">{line.remarks}</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="text-sm font-bold">{line.quantity}</span> <span className="text-[10px] text-muted-foreground uppercase font-medium">{line.unit}</span>
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">
                              ฿{(line.unitPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right font-black text-primary">
                              ฿{(line.lineTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              {isEditMode && (
                                <div className="flex justify-end items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => handleMoveLine(line, 'up')} disabled={index === 0}>
                                    <ArrowUp className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => handleMoveLine(line, 'down')} disabled={index === displayLines.length - 1}>
                                    <ArrowDown className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => handleOpenEditLine(line)}>
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteLine(line.id)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {displayLines.length === 0 && !isLinesLoading && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">
                              <div className="flex flex-col items-center gap-2">
                                <Briefcase className="h-10 w-10 opacity-10" />
                                <p>ยังไม่มีรายการสินค้า/บริการในใบเสนอราคานี้</p>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                {/* Workflow Actions */}
                <Card className="bg-primary text-primary-foreground shadow-lg overflow-hidden border-none">
                  <CardHeader className="pb-4 border-b border-white/10">
                    <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ (Workflow)</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-3">
                    {canStartEdit && !isEditMode && (
                      <Button className="w-full bg-white text-primary hover:bg-slate-100 font-bold h-12" onClick={handleStartEdit}>
                        <Edit2 className="h-4 w-4 mr-2" /> แก้ไขเอกสาร (Edit Document)
                      </Button>
                    )}

                    {isEditMode && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          {isDraft ? (
                            <Button
                              className="bg-green-600 hover:bg-green-700 font-bold text-xs h-11"
                              disabled={isSavingDraft}
                              onClick={() => void handleSaveDraftInPlace()}
                            >
                              {isSavingDraft ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <Save className="h-3 w-3 mr-1" />
                              )}
                              บันทึกร่าง
                            </Button>
                          ) : (
                            <Button className="bg-green-600 hover:bg-green-700 font-bold text-xs h-11" onClick={() => void handleCreateRevision()}>
                              <Save className="h-3 w-3 mr-1" /> บันทึก Revision
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            className="bg-transparent border-white/20 text-white hover:bg-white/10 text-xs h-11"
                            disabled={isSavingDraft}
                            onClick={handleCancelEdit}
                          >
                            <XCircle className="h-3 w-3 mr-1" /> ยกเลิกแก้ไข
                          </Button>
                        </div>
                        <p className="text-[11px] text-white/80">
                          {isDraft
                            ? 'บันทึกลงฉบับร่างเดิม — เลขที่เอกสารไม่เปลี่ยน'
                            : 'เมื่อบันทึก ระบบจะสร้างฉบับใหม่ (R) และเปลี่ยนฉบับเดิมเป็นสถานะ "มีการแก้ไข"'}
                        </p>
                        <Separator className="bg-white/10" />
                      </>
                    )}

                    {!isEditMode && isDraft && (
                      <Button className="w-full bg-white text-primary hover:bg-slate-100 font-bold h-12" onClick={() => handleUpdateStatus('sent')}>
                        <Send className="h-4 w-4 mr-2" /> ส่งให้ลูกค้า (Mark as Sent)
                      </Button>
                    )}

                    {!isEditMode && isSent && !quotation.customerRevisionRequestedAt && (
                      <div className="grid grid-cols-2 gap-2">
                        <Button className="bg-green-600 hover:bg-green-700 font-bold text-xs h-11" onClick={() => handleUpdateStatus('accepted')}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Accepted
                        </Button>
                        <Button variant="outline" className="bg-transparent border-white/20 text-white hover:bg-white/10 text-xs h-11" onClick={() => handleUpdateStatus('rejected')}>
                          <XCircle className="h-3 w-3 mr-1" /> Rejected
                        </Button>
                      </div>
                    )}

                    {!isEditMode && !isFinalized && !isRevised && (
                      <Button variant="ghost" className="w-full text-white/60 hover:text-white hover:bg-white/10 text-xs h-11" onClick={() => handleUpdateStatus('cancelled')}>
                        <Trash2 className="h-3 w-3 mr-2" /> ยกเลิกใบเสนอราคา
                      </Button>
                    )}

                    {(isFinalized || isRevised) && (
                      <div className="text-center py-4 bg-white/5 rounded-lg border border-dashed border-white/10">
                        <Lock className="h-5 w-5 mx-auto mb-2 opacity-40 text-white" />
                        <p className="text-[10px] uppercase font-black tracking-widest opacity-60">Locked: {statusDisplay}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Financial Summary Card */}
                <Card className="border-none shadow-md bg-white overflow-hidden">
                  <CardHeader className="bg-muted/30 border-b">
                    <CardTitle className="text-base flex items-center gap-2 font-bold text-primary">
                      <Calculator className="h-5 w-5" /> สรุปมูลค่า (Summary)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-3 text-sm">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">ยอดรวมสินค้า (Subtotal):</span>
                      <span className="font-bold">฿{computeTotals(displayLines, editedHeader).subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between items-center group">
                      <span className="text-muted-foreground">ส่วนลด (Discount):</span>
                      <div className="flex items-center gap-2">
                        {isEditable && <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity italic">แก้ไข {'>'}</span>}
                        <Input 
                          disabled={!isEditable}
                          type="number" 
                          className={`h-8 w-28 text-right text-xs font-bold text-red-600 ${isEditable ? 'border-dashed' : 'border-none bg-transparent'}`}
                          value={editedHeader.discountAmount || 0}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            setEditedHeader({...editedHeader, discountAmount: val});
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม ({computeTotals(displayLines, editedHeader).taxPercent}%):</span>
                      <span className="font-bold">฿{computeTotals(displayLines, editedHeader).taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between items-end">
                      <span className="font-black text-primary uppercase text-[10px] tracking-widest">ยอดสุทธิ (Grand Total)</span>
                      <span className="font-black text-2xl text-primary underline decoration-double">฿{computeTotals(displayLines, editedHeader).grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Technical/Commercial Notes */}
                <Card className="border-none shadow-sm bg-white">
                  <CardHeader className="pb-2 bg-muted/5 border-b">
                    <CardTitle className="text-xs font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                      <Info className="h-3 w-3" /> เงื่อนไขและหมายเหตุ (Notes)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-4">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-muted-foreground">เงื่อนไขในเอกสาร (Client Terms)</Label>
                      <Textarea 
                        disabled={!isEditable}
                        placeholder="ระบุเงื่อนไขการเสนอราคาที่ต้องการให้ลูกค้าเห็น..." 
                        className="text-xs min-h-[80px]"
                        value={editedHeader.notes || ''}
                        onChange={e => setEditedHeader({...editedHeader, notes: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-muted-foreground">บันทึกภายใน (Internal Log)</Label>
                      <Textarea 
                        disabled={!isEditable}
                        placeholder="สำหรับบันทึกเฉพาะเจ้าหน้าที่ขาย..." 
                        className="text-xs min-h-[80px] bg-muted/20"
                        value={editedHeader.internalNotes || ''}
                        onChange={e => setEditedHeader({...editedHeader, internalNotes: e.target.value})}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-6">
            <QuotationPreviewTab
              quotation={quotation}
              companyProfile={companyProfile ?? null}
              displayLines={displayLines}
              editedHeader={editedHeader}
              totals={computeTotals(displayLines, editedHeader)}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-6 print:hidden">
            <QuotationHistoryTab quotation={quotation} />
          </TabsContent>
        </Tabs>

        <QuotationLineDialog
          open={isLineDialogOpen}
          onOpenChange={setIsLineDialogOpen}
          editingLine={editingLine}
          setEditingLine={setEditingLine}
          onSave={handleSaveLine}
        />
      </div>

      <style jsx global>{`
        @media print {
          /* Hide everything except the print container */
          body * {
            visibility: hidden;
          }
          .print-container, .print-container * {
            visibility: visible;
          }
          .print-container {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 1cm !important;
            box-shadow: none !important;
            border: none !important;
          }
          /* Remove layout elements during print */
          header, nav, [data-sidebar="sidebar"], .print\\:hidden, [role="tablist"], button {
            display: none !important;
          }
          /* Reset backgrounds for clarity */
          .bg-slate-50 {
            background-color: #f8fafc !important;
            -webkit-print-color-adjust: exact;
          }
          .bg-slate-100 {
            background-color: #f1f5f9 !important;
            -webkit-print-color-adjust: exact;
          }
        }
      `}</style>
    </AppShell>
  );
}
