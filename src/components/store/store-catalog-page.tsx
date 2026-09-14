'use client';

import { Fragment, useMemo, useState, useCallback, type ComponentType } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Plus,
  Search,
  Filter,
  ArrowLeft,
  HardHat,
  Package,
  Hammer,
  Trash2,
  Edit2,
  Layers,
  Printer,
  Loader2,
  type LucideProps,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  StoreItem,
  STORE_ITEM_CATEGORIES,
  storeItemIsPpeCatalog,
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, doc, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  STORE_CATALOG_TABLE_CLASS,
  StoreCatalogColGroup,
  StoreCatalogViewVariantsButton,
  STORE_CATALOG_ROW_ACTION_BTN_CLASS,
  storeCatalogCol as sc,
  useStoreCatalogVariantExpansion,
} from '@/components/store/store-catalog-table-layout';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { StoreItemConsumableField } from '@/components/store/store-item-consumable-field';
import {
  buildStoreCatalogListPrintHtml,
  capStoreCatalogListPrintRows,
  describeStoreCatalogPrintFilters,
  flattenStoreCatalogDisplayRows,
  type StoreCatalogPrintVariant,
} from '@/lib/store/store-catalog-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import {
  buildStoreCatalogDisplayRows,
  filterStoreCatalogDisplayRows,
  sumChildStock,
  toolIssueOutstanding,
} from '@/lib/store/store-catalog-rows';

const EQUIPMENT_CATEGORIES = STORE_ITEM_CATEGORIES.filter((c) => c !== 'PPE');

/** หมวด «Tool» = เครื่องมือ — เปิด isTool สำหรับกฎเบิกคืนก่อนลบ */
function equipmentIsToolCategory(category: string | undefined): boolean {
  return (category || '').trim() === 'Tool';
}

function equipmentFlagsFromCategory(category: string | undefined): { isPPE: false; isTool: boolean } {
  return { isPPE: false, isTool: equipmentIsToolCategory(category) };
}

function ppeFlagsFromCategory(category?: string): { isPPE: true; isTool: false } {
  void category;
  return { isPPE: true, isTool: false };
}

type CatalogCreateMode = 'main' | 'variant' | 'standalone';

export type StoreCatalogCategoryUiMode = 'select' | 'freeText';

export type StoreCatalogAccents = {
  titleIconClass?: string;
  primaryButtonClass: string;
  codeCellClass: string;
  groupKeyClass: string;
  menuRowBorderClass: string;
  menuBadgeClass?: string;
  viewVariantsClass?: string;
  childRowBorderClass: string;
  stockOkClass: string;
  printAllButtonClass?: string;
};

export type StoreCatalogPageConfig = {
  variant: 'ppe' | 'equipment';
  title: string;
  icon: ComponentType<LucideProps>;
  itemFilter: (item: StoreItem) => boolean;
  numberingKey: 'store_item_ppe' | 'store_item_equipment';
  categoryUiMode: StoreCatalogCategoryUiMode;
  /** Fixed options for select mode; freeText derives filter options from catalog items. */
  categorySelectOptions?: readonly string[];
  defaultCategory: string;
  flagsFromCategory: (category: string | undefined) => { isPPE: boolean; isTool: boolean };
  printVariant: StoreCatalogPrintVariant;
  accents: StoreCatalogAccents;
  crossLink: { href: string; label: string };
  showToolCategoryHint: boolean;
  showToolHammerInCategoryCell: boolean;
  codePlaceholder: string;
  codeHelpText?: string;
  emptyCatalogMessage: string;
  emptyFilterMessage: string;
  printEmptyAllMessage: string;
  printDialogTitle: string;
  printDialogDescription: string;
  printAllScopeTitle: string;
  printWindowTitle: string;
  printFilePrefix: string;
  printAllTotalLabel: string;
  deleteConfirm: string;
  deleteSuccessToast: string;
  updateSuccessToast: string;
  createTitles: Record<CatalogCreateMode, string>;
  createDescriptions: Record<CatalogCreateMode, string>;
  nameFieldLabel: string;
  namePlaceholder: string;
  variantParentLabel: string;
  variantParentMissingToast: string;
  variantParentInvalidToast: string;
  mainNameRequiredToast: string;
  standaloneNameRequiredToast: string;
  mainQuotaKeyPlaceholder: string;
  validateVariantParent?: (parent: StoreItem) => boolean;
};

export const PPE_STORE_CATALOG_CONFIG: StoreCatalogPageConfig = {
  variant: 'ppe',
  title: 'ทะเบียน PPE (จากคลัง Store)',
  icon: HardHat,
  itemFilter: (i) => storeItemIsPpeCatalog(i),
  numberingKey: 'store_item_ppe',
  categoryUiMode: 'freeText',
  defaultCategory: 'PPE',
  flagsFromCategory: ppeFlagsFromCategory,
  printVariant: 'ppe',
  accents: {
    titleIconClass: 'text-orange-500',
    primaryButtonClass: 'bg-orange-600 hover:bg-orange-700',
    codeCellClass: 'text-orange-700',
    groupKeyClass: 'text-orange-700',
    menuRowBorderClass: 'border-t-orange-500/30',
    menuBadgeClass: 'border-orange-300 text-orange-800',
    viewVariantsClass: 'border-orange-300 text-orange-800 hover:bg-orange-50',
    childRowBorderClass: 'border-l-orange-400/40',
    stockOkClass: 'text-orange-700',
    printAllButtonClass: 'bg-orange-600 hover:bg-orange-700',
  },
  crossLink: { href: '/store/items', label: 'ทะเบียนอุปกรณ์' },
  showToolCategoryHint: false,
  showToolHammerInCategoryCell: false,
  codePlaceholder: 'ออกอัตโนมัติเมื่อบันทึก เช่น PPE-0001',
  codeHelpText: 'ระบบออกรหัสลำดับอัตโนมัติ prefix PPE- (แยกจากอุปกรณ์ทั่วไป EQM-)',
  emptyCatalogMessage: 'ยังไม่มีรายการ PPE — เพิ่มจากปุ่มด้านบน',
  emptyFilterMessage: 'ไม่พบรายการตามตัวกรอง',
  printEmptyAllMessage: 'ยังไม่มีรายการ PPE ในระบบ',
  printDialogTitle: 'พิมพ์รายการทะเบียน PPE',
  printDialogDescription: 'พิมพ์ตามตัวกรองปัจจุบัน หรือทั้งทะเบียน PPE — รวมรุ่นย่อยทุกเมน',
  printAllScopeTitle: 'พิมพ์ทั้งหมด (PPE)',
  printWindowTitle: 'Store-PPE-Registry',
  printFilePrefix: 'Store-PPE',
  printAllTotalLabel: 'ทั้งทะเบียน PPE',
  deleteConfirm: 'ยืนยันการลบรายการ PPE?',
  deleteSuccessToast: 'ลบรายการแล้ว',
  updateSuccessToast: 'แก้ไข PPE สำเร็จ',
  createTitles: {
    main: 'ลงทะเบียน — รายการหลัก PPE (เมน)',
    variant: 'ลงทะเบียน — รุ่นย่อย / ไซส์',
    standalone: 'ลงทะเบียน — รายการเดี่ยว',
  },
  createDescriptions: {
    main: 'เมนไม่ถือสต็อก — ใช้เพื่อชื่อหลักและรหัสกลุ่มโควต้า · จากนั้นเพิ่มรุ่นย่อยแต่ละไซส์ (รหัส PPE-####)',
    variant: 'เลือกเมน PPE ที่มีอยู่แล้ว แล้วระบุขนาด/รุ่นและสต็อก',
    standalone: 'หนึ่งแถวครบทุกฟิลด์ (ข้อมูลเก่าในระบบ) — ไม่ผูกเมนหลัก',
  },
  nameFieldLabel: 'ชื่อหลัก (ไม่รวมไซส์) *',
  namePlaceholder: 'เช่น ชุดหมี, รองเท้าเซฟตี้',
  variantParentLabel: 'รายการหลัก (เมน) *',
  variantParentMissingToast: 'ระบุเมน PPE ที่จะเพิ่มรุ่นย่อย',
  variantParentInvalidToast: 'ไม่พบรายการหลัก PPE',
  mainNameRequiredToast: 'ชื่อเมน PPE จำเป็นต้องมี',
  standaloneNameRequiredToast: 'ชื่อหลัก (ไม่รวมไซส์) จำเป็นต้องมี',
  mainQuotaKeyPlaceholder: 'ว่าง = ใช้รหัส PPE ของเมนเป็นกลุ่มโควต้า',
  validateVariantParent: (parent) => storeItemIsPpeCatalog(parent),
};

export const EQUIPMENT_STORE_CATALOG_CONFIG: StoreCatalogPageConfig = {
  variant: 'equipment',
  title: 'ทะเบียนอุปกรณ์ (ไม่รวม PPE)',
  icon: Package,
  itemFilter: (i) => !storeItemIsPpeCatalog(i),
  numberingKey: 'store_item_equipment',
  categoryUiMode: 'select',
  categorySelectOptions: EQUIPMENT_CATEGORIES,
  defaultCategory: 'General',
  flagsFromCategory: equipmentFlagsFromCategory,
  printVariant: 'equipment',
  accents: {
    primaryButtonClass: 'bg-primary',
    codeCellClass: 'text-primary',
    groupKeyClass: 'text-primary/80',
    menuRowBorderClass: 'border-t-primary/20',
    childRowBorderClass: 'border-l-primary/25',
    stockOkClass: 'text-primary',
  },
  crossLink: { href: '/store/ppe', label: 'PPE' },
  showToolCategoryHint: true,
  showToolHammerInCategoryCell: true,
  codePlaceholder: 'ออกอัตโนมัติเมื่อบันทึก เช่น EQM-0001',
  emptyCatalogMessage: 'ไม่มีรายการอุปกรณ์ (ไม่รวม PPE) ในระบบ',
  emptyFilterMessage: 'ไม่พบรายการตามตัวกรอง — ลองเปลี่ยนหมวดหรือคำค้น',
  printEmptyAllMessage: 'ยังไม่มีรายการอุปกรณ์ (ไม่รวม PPE) ในระบบ',
  printDialogTitle: 'พิมพ์รายการทะเบียนอุปกรณ์',
  printDialogDescription: 'พิมพ์ตามตัวกรองปัจจุบัน หรือทั้งทะเบียนอุปกรณ์ (ไม่รวม PPE) — รวมรุ่นย่อยทุกเมน',
  printAllScopeTitle: 'พิมพ์ทั้งหมด (ไม่รวม PPE)',
  printWindowTitle: 'Store-Equipment-Registry',
  printFilePrefix: 'Store-Equipment',
  printAllTotalLabel: 'ทั้งทะเบียน',
  deleteConfirm: 'ยืนยันการลบรายการอุปกรณ์?',
  deleteSuccessToast: 'ลบรายการอุปกรณ์แล้ว',
  updateSuccessToast: 'แก้ไขอุปกรณ์สำเร็จ',
  createTitles: {
    main: 'ลงทะเบียน — รายการหลัก (เมน)',
    variant: 'ลงทะเบียน — รุ่นย่อย / ไซส์',
    standalone: 'ลงทะเบียน — รายการเดี่ยว',
  },
  createDescriptions: {
    main: 'เมนไม่ถือสต็อก — ใช้เพื่อชื่อหลักและรหัสกลุ่มโควต้า · จากนั้นเพิ่มรุ่นย่อยแต่ละไซส์',
    variant: 'เลือกเมนที่มีอยู่แล้ว แล้วระบุขนาด/รุ่นและสต็อก',
    standalone: 'หนึ่งแถวครบทุกฟิลด์ (ข้อมูลเก่าในระบบ) — ไม่ผูกเมนหลัก',
  },
  nameFieldLabel: 'ชื่อรายการ (ไม่รวมขนาด/รุ่น) *',
  namePlaceholder: 'เช่น ชุดหมี, เสื้อช้อป',
  variantParentLabel: 'รายการหลัก (เมน) *',
  variantParentMissingToast: 'ระบุเมนที่จะเพิ่มรุ่นย่อย',
  variantParentInvalidToast: 'ไม่พบรายการหลัก',
  mainNameRequiredToast: 'ชื่อหลัก (เมน) จำเป็นต้องมี',
  standaloneNameRequiredToast: 'ชื่อหลัก (ไม่รวมไซส์) จำเป็นต้องมี',
  mainQuotaKeyPlaceholder: 'ว่าง = ใช้รหัส EQM ของเมนเป็นกลุ่มโควต้า',
};

type StoreCatalogPageProps = {
  config: StoreCatalogPageConfig;
};

export function StoreCatalogPage({ config }: StoreCatalogPageProps) {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const accents = config.accents;
  const TitleIcon = config.icon;

  const canAccess = canAccessDomain(currentUser, 'store');

  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || userLoading || isUserLoading || !firebaseUser || !canAccess) return null;
    return collection(firestore, 'store_items');
  }, [firestore, userLoading, isUserLoading, firebaseUser, canAccess]);
  const { data: items, isLoading } = useCollection<StoreItem>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- useCollection query typing
    itemsQuery as any,
  );

  const catalogItems = useMemo(
    () => (items || []).filter(config.itemFilter),
    [items, config.itemFilter],
  );

  const catalogHeaders = useMemo(
    () => catalogItems.filter((i) => i.catalogGroupRole === 'header'),
    [catalogItems],
  );

  const displayRows = useMemo(() => buildStoreCatalogDisplayRows(catalogItems), [catalogItems]);

  const categoryFilterOptions = useMemo(() => {
    if (config.categoryUiMode === 'select' && config.categorySelectOptions) {
      return [...config.categorySelectOptions];
    }
    const s = new Set<string>();
    catalogItems.forEach((i) => {
      if ((i.category || '').trim()) s.add(i.category);
    });
    return Array.from(s).sort();
  }, [catalogItems, config.categoryUiMode, config.categorySelectOptions]);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredDisplayRows = useMemo(
    () => filterStoreCatalogDisplayRows(displayRows, searchQuery, categoryFilter),
    [displayRows, searchQuery, categoryFilter],
  );

  const filteredPrintRowCount = useMemo(
    () => flattenStoreCatalogDisplayRows(filteredDisplayRows).length,
    [filteredDisplayRows],
  );
  const allPrintRowCount = useMemo(
    () => flattenStoreCatalogDisplayRows(displayRows).length,
    [displayRows],
  );
  const printFilterLines = useMemo(
    () => describeStoreCatalogPrintFilters(searchQuery, categoryFilter),
    [searchQuery, categoryFilter],
  );
  const hasActiveFilters = useMemo(
    () => searchQuery.trim() !== '' || categoryFilter !== 'all',
    [searchQuery, categoryFilter],
  );

  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  const runCatalogPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const sourceRows = scope === 'filtered' ? filteredDisplayRows : displayRows;
      const flat = flattenStoreCatalogDisplayRows(sourceRows);
      if (flat.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามตัวกรอง — ปรับตัวกรองหรือเลือกพิมพ์ทั้งหมด'
              : config.printEmptyAllMessage,
        });
        return;
      }

      setPrintBusy(true);
      try {
        const { rows, truncated } = capStoreCatalogListPrintRows(flat);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines = scope === 'filtered' ? printFilterLines : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : config.printAllScopeTitle;

        const body = buildStoreCatalogListPrintHtml({
          variant: config.printVariant,
          rows,
          scopeTitle,
          filterLines,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: config.printWindowTitle,
          suggestedFileName: `${config.printFilePrefix}-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!ok) {
          toast({
            variant: 'destructive',
            title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
            description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
          });
          return;
        }
        setPrintDialogOpen(false);
      } finally {
        setPrintBusy(false);
      }
    },
    [filteredDisplayRows, displayRows, printFilterLines, currentUser, toast, config],
  );

  const { isVariantExpanded, toggleVariantExpanded } = useStoreCatalogVariantExpansion();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CatalogCreateMode>('main');
  const [variantParentId, setVariantParentId] = useState('');

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingCatalogRole, setEditingCatalogRole] = useState<'header' | 'line' | 'standalone' | null>(
    null,
  );
  const [editingParentId, setEditingParentId] = useState<string | undefined>(undefined);

  const blankNewItem = (): Partial<StoreItem> => ({
    itemCode: '',
    itemName: '',
    variantSpecification: '',
    variantGroupKey: '',
    category: config.defaultCategory,
    unit: 'Unit',
    minimumStock: 5,
    currentStock: 0,
    ...config.flagsFromCategory(config.defaultCategory),
    isConsumable: false,
    active: true,
  });

  const [newItem, setNewItem] = useState<Partial<StoreItem>>(() => blankNewItem());

  const editingParent = useMemo(
    () => (editingParentId ? catalogItems.find((x) => x.id === editingParentId) : undefined),
    [catalogItems, editingParentId],
  );

  const resetNewItemForm = () => {
    setNewItem(blankNewItem());
    setVariantParentId('');
  };

  const openCreate = (mode: CatalogCreateMode) => {
    setCreateMode(mode);
    resetNewItemForm();
    setIsCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    const colRef = collection(firestore, 'store_items');
    const actorName = currentUser.displayName?.trim() || currentUser.email || currentUser.id;
    const flags = config.flagsFromCategory;

    try {
      if (createMode === 'variant') {
        if (!variantParentId) {
          toast({
            variant: 'destructive',
            title: 'เลือกรายการหลัก',
            description: config.variantParentMissingToast,
          });
          return;
        }
        const parent = catalogItems.find((i) => i.id === variantParentId);
        const parentOk =
          parent &&
          parent.catalogGroupRole === 'header' &&
          (!config.validateVariantParent || config.validateVariantParent(parent));
        if (!parentOk || !parent) {
          toast({
            variant: 'destructive',
            title: 'ข้อมูลไม่ถูกต้อง',
            description: config.variantParentInvalidToast,
          });
          return;
        }
        const spec = (newItem.variantSpecification || '').trim();
        if (!spec) {
          toast({ variant: 'destructive', title: 'ระบุขนาด/รุ่น', description: 'รุ่นย่อยต้องมีขนาดหรือรุ่น' });
          return;
        }
        const { code: itemCode } = await generateNextDocumentCode(firestore, config.numberingKey, {
          actor: actorName,
          userId: currentUser.id,
        });
        const gk = ((parent.variantGroupKey || parent.itemCode || '') as string).trim();
        const parentFlags = flags(parent.category);
        await addDocumentNonBlocking(
          colRef,
          sanitizeFirestorePayload({
            itemCode,
            itemName: parent.itemName,
            variantSpecification: spec,
            variantGroupKey: gk || itemCode,
            catalogGroupRole: 'line',
            parentStoreItemId: parent.id,
            category: parent.category || config.defaultCategory,
            unit: parent.unit,
            minimumStock: Number(newItem.minimumStock) || 0,
            currentStock: Number(newItem.currentStock) || 0,
            isPPE: parentFlags.isPPE,
            isTool: parentFlags.isTool,
            isConsumable: newItem.isConsumable === true,
            active: newItem.active !== false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );
        toast({ title: 'เพิ่มรุ่นย่อยแล้ว', description: itemCode });
      } else if (createMode === 'main') {
        if (!(newItem.itemName || '').trim()) {
          toast({
            variant: 'destructive',
            title: 'กรอกชื่อรายการ',
            description: config.mainNameRequiredToast,
          });
          return;
        }
        const { code: itemCode } = await generateNextDocumentCode(firestore, config.numberingKey, {
          actor: actorName,
          userId: currentUser.id,
        });
        const gk = ((newItem.variantGroupKey || '').trim() || itemCode) as string;
        await addDocumentNonBlocking(
          colRef,
          sanitizeFirestorePayload({
            itemCode,
            itemName: (newItem.itemName ?? '').trim(),
            variantSpecification: '',
            variantGroupKey: gk,
            catalogGroupRole: 'header',
            category: newItem.category || config.defaultCategory,
            unit: newItem.unit || 'Unit',
            minimumStock: 0,
            currentStock: 0,
            ...flags(newItem.category),
            active: newItem.active !== false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );
        toast({ title: 'เพิ่มรายการหลักแล้ว', description: 'ใช้ «เพิ่มรุ่นย่อย» เพื่อลงไซส์และสต็อก' });
      } else {
        if (!(newItem.itemName || '').trim()) {
          toast({
            variant: 'destructive',
            title: 'กรอกชื่อรายการ',
            description: config.standaloneNameRequiredToast,
          });
          return;
        }
        const { code: itemCode } = await generateNextDocumentCode(firestore, config.numberingKey, {
          actor: actorName,
          userId: currentUser.id,
        });
        await addDocumentNonBlocking(
          colRef,
          sanitizeFirestorePayload({
            ...newItem,
            itemCode,
            ...flags(newItem.category),
            category: newItem.category || config.defaultCategory,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );
        toast({ title: 'เพิ่มรายการเดี่ยวสำเร็จ' });
      }

      setIsCreateOpen(false);
      resetNewItemForm();
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'ไม่สามารถบันทึกข้อมูลได้' });
    }
  };

  const handleUpdate = async () => {
    if (!firestore || !editingItemId || !editingCatalogRole) return;
    let syncChildrenCount = 0;
    const flags = config.flagsFromCategory;
    try {
      if (editingCatalogRole === 'header') {
        const headerRef = doc(firestore, 'store_items', editingItemId);
        const categoryNext = newItem.category || config.defaultCategory;
        const headerPatch = sanitizeFirestorePayload({
          itemName: (newItem.itemName || '').trim(),
          variantGroupKey: ((newItem.variantGroupKey || '').trim() || newItem.itemCode || '').trim(),
          category: categoryNext,
          unit: newItem.unit,
          active: newItem.active !== false,
          ...flags(categoryNext),
          updatedAt: Date.now(),
        });
        const childrenSnap = await getDocs(
          query(collection(firestore, 'store_items'), where('parentStoreItemId', '==', editingItemId)),
        );
        syncChildrenCount = childrenSnap.size;
        const batch = writeBatch(firestore);
        batch.update(headerRef, headerPatch);
        const childSyncPatch = sanitizeFirestorePayload({
          category: categoryNext,
          unit: newItem.unit,
          ...flags(categoryNext),
          updatedAt: Date.now(),
        });
        childrenSnap.forEach((d) => {
          batch.update(d.ref, childSyncPatch);
        });
        await batch.commit();
      } else if (editingCatalogRole === 'line') {
        updateDocumentNonBlocking(
          doc(firestore, 'store_items', editingItemId),
          sanitizeFirestorePayload({
            variantSpecification: (newItem.variantSpecification || '').trim(),
            minimumStock: Number(newItem.minimumStock) || 0,
            currentStock: Number(newItem.currentStock) || 0,
            isConsumable: newItem.isConsumable === true,
            active: newItem.active !== false,
            updatedAt: Date.now(),
          }),
        );
      } else {
        updateDocumentNonBlocking(
          doc(firestore, 'store_items', editingItemId),
          sanitizeFirestorePayload({
            ...newItem,
            ...flags(newItem.category),
            isConsumable: newItem.isConsumable === true,
            category: newItem.category || config.defaultCategory,
            updatedAt: Date.now(),
          }),
        );
      }
      setIsEditOpen(false);
      setEditingItemId(null);
      setEditingCatalogRole(null);
      setEditingParentId(undefined);
      toast({
        title: config.updateSuccessToast,
        ...(syncChildrenCount > 0
          ? {
              description: `ปรับหมวดหมู่และหน่วยของรุ่นย่อย ${syncChildrenCount} แถวให้ตรงเมน`,
            }
          : {}),
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'ไม่สามารถแก้ไขข้อมูลได้' });
    }
  };

  const openEditDialog = (item: StoreItem) => {
    setEditingItemId(item.id);
    if (item.catalogGroupRole === 'header') {
      setEditingCatalogRole('header');
      setEditingParentId(undefined);
    } else if (item.catalogGroupRole === 'line') {
      setEditingCatalogRole('line');
      setEditingParentId(item.parentStoreItemId);
    } else {
      setEditingCatalogRole('standalone');
      setEditingParentId(undefined);
    }
    const baseFlags = config.flagsFromCategory(item.category);
    setNewItem({
      itemCode: item.itemCode,
      itemName: item.itemName,
      variantSpecification: item.variantSpecification ?? '',
      variantGroupKey: item.variantGroupKey ?? '',
      category: item.category || config.defaultCategory,
      unit: item.unit,
      minimumStock: item.minimumStock,
      currentStock: item.currentStock,
      isPPE: baseFlags.isPPE,
      // Equipment preserves stored isTool on edit form; PPE always false via flags.
      isTool: config.variant === 'equipment' ? item.isTool : baseFlags.isTool,
      isConsumable: item.isConsumable === true,
      active: item.active,
    });
    setIsEditOpen(true);
  };

  const handleDelete = async (item: StoreItem) => {
    if (!firestore) return;
    if (!confirm(config.deleteConfirm)) return;

    if (item.catalogGroupRole === 'header') {
      const childrenSnap = await getDocs(
        query(collection(firestore, 'store_items'), where('parentStoreItemId', '==', item.id)),
      );
      if (!childrenSnap.empty) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่ได้',
          description: 'มีรุ่นย่อยอยู่ภายใต้เมนนี้ — ลบรุ่นย่อยก่อน',
        });
        return;
      }
    }

    if (item.isTool) {
      try {
        const netOut = await toolIssueOutstanding(firestore, item.id);
        if (netOut > 0) {
          toast({
            variant: 'destructive',
            title: 'ลบไม่ได้: ยังมีเครื่องมือเบิกออกไปคืนไม่ครบ',
            description: `คงเหลือนอกคลังประมาณ ${netOut} ${item.unit} กรุณาติดตามรับคืนให้ครบก่อนลบรายการ`,
          });
          return;
        }
      } catch (e) {
        console.error(e);
        toast({
          variant: 'destructive',
          title: 'ตรวจสอบไม่สำเร็จ',
          description: 'ไม่สามารถตรวจสอบประวัติการเบิกคืนได้',
        });
        return;
      }
    }

    deleteDocumentNonBlocking(doc(firestore, 'store_items', item.id));
    toast({ title: config.deleteSuccessToast });
  };

  const stockTone = (stock: number, min: number) =>
    stock <= min ? 'text-red-600' : accents.stockOkClass;

  const renderCategoryCell = (item: StoreItem, childStyle = false) => {
    const label = (item.category || '').trim() || '—';
    if (!config.showToolHammerInCategoryCell) {
      return (
        <Badge variant={childStyle ? 'secondary' : 'outline'} className={childStyle ? 'text-xs' : undefined}>
          {label}
        </Badge>
      );
    }
    const toolish = item.isTool === true || equipmentIsToolCategory(item.category);
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline">{label}</Badge>
        {toolish ? <Hammer className="h-4 w-4 shrink-0 text-blue-500" aria-label="Tool" /> : null}
      </div>
    );
  };

  const renderCategoryField = (mode: 'create' | 'edit') => {
    if (config.categoryUiMode === 'select') {
      const options = config.categorySelectOptions || [];
      return (
        <Select onValueChange={(v) => setNewItem({ ...newItem, category: v })} value={newItem.category || ''}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        value={newItem.category || (mode === 'create' ? config.defaultCategory : '')}
        onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
      />
    );
  };

  if (userLoading || isUserLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังตรวจสอบสิทธิ์…
      </div>
    );
  }
  if (!currentUser || !canAccess) return null;

  const editTitle =
    editingCatalogRole === 'header'
      ? config.variant === 'ppe'
        ? 'แก้ไข — รายการหลัก PPE'
        : 'แก้ไข — รายการหลัก'
      : editingCatalogRole === 'line'
        ? 'แก้ไข — รุ่นย่อย'
        : config.variant === 'ppe'
          ? 'แก้ไข PPE'
          : 'แก้ไขอุปกรณ์';

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/store">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
                <TitleIcon className={`h-8 w-8 ${accents.titleIconClass || ''}`.trim()} /> {config.title}
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                สร้าง<strong>รายการหลัก</strong>ก่อน แล้วใช้<strong>รุ่นย่อย</strong>แยกไซส์และสต็อก — แสดงเป็นหัวข้อเดียวในรายการ · รายการเดี่ยวใช้เมื่อไม่ต้องแยกเมน ·{' '}
                <Link href={config.crossLink.href} className="text-primary underline font-medium">
                  {config.crossLink.label}
                </Link>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              className={`gap-2 h-11 px-4 shadow-md font-bold ${accents.primaryButtonClass}`}
              onClick={() => openCreate('main')}
            >
              <Layers className="h-4 w-4" /> เพิ่มรายการหลัก
            </Button>
            <Button variant="secondary" className="gap-2 h-11 px-4 font-bold" onClick={() => openCreate('variant')}>
              <Plus className="h-4 w-4" /> เพิ่มรุ่นย่อย
            </Button>
            <Button variant="outline" className="gap-2 h-11 px-4" onClick={() => openCreate('standalone')}>
              <Plus className="h-4 w-4" /> รายการเดี่ยว
            </Button>
          </div>
        </div>

        <Dialog
          open={isCreateOpen}
          onOpenChange={(o) => {
            setIsCreateOpen(o);
            if (!o) resetNewItemForm();
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{config.createTitles[createMode]}</DialogTitle>
              <DialogDescription>{config.createDescriptions[createMode]}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="grid gap-2 col-span-2">
                <Label>รหัส (Item Code)</Label>
                <Input
                  readOnly
                  className="bg-muted/60 font-mono text-sm"
                  placeholder={config.codePlaceholder}
                  value=""
                />
                {config.codeHelpText ? (
                  <p className="text-[11px] text-muted-foreground">{config.codeHelpText}</p>
                ) : null}
              </div>

              {createMode === 'variant' && (
                <div className="grid gap-2 col-span-2">
                  <Label>{config.variantParentLabel}</Label>
                  <Select value={variantParentId || undefined} onValueChange={setVariantParentId}>
                    <SelectTrigger>
                      <SelectValue placeholder={catalogHeaders.length ? 'เลือกเมน…' : 'ยังไม่มีเมน — สร้างรายการหลักก่อน'} />
                    </SelectTrigger>
                    <SelectContent>
                      {catalogHeaders.map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.itemCode} · {h.itemName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(createMode === 'main' || createMode === 'standalone') && (
                <div className="grid gap-2 col-span-2">
                  <Label>{config.nameFieldLabel}</Label>
                  <Input
                    placeholder={config.namePlaceholder}
                    value={newItem.itemName}
                    onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })}
                  />
                </div>
              )}

              {createMode === 'variant' && (
                <div className="grid gap-2 col-span-2">
                  <Label>ขนาด / รุ่น *</Label>
                  <Input
                    placeholder={config.variant === 'ppe' ? 'เช่น Size M, เบอร์ 8' : 'เช่น Size M, Size XXL'}
                    value={newItem.variantSpecification || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantSpecification: e.target.value })}
                  />
                </div>
              )}

              {createMode === 'standalone' && (
                <>
                  <div className="grid gap-2 col-span-2">
                    <Label>ขนาด / รุ่น (ถ้ามี)</Label>
                    <Input
                      placeholder="เช่น Size M"
                      value={newItem.variantSpecification || ''}
                      onChange={(e) => setNewItem({ ...newItem, variantSpecification: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2 col-span-2">
                    <Label>รหัสกลุ่มโควต้า (ไม่บังคับ)</Label>
                    <Input
                      placeholder={
                        config.variant === 'ppe'
                          ? 'เช่น SHIRT-SHOP — หลายไซส์ใช้รหัสเดียวกันเพื่อนับโควต้ารวม'
                          : 'เช่น SHIRT-WORK'
                      }
                      value={newItem.variantGroupKey || ''}
                      onChange={(e) => setNewItem({ ...newItem, variantGroupKey: e.target.value })}
                    />
                    {config.variant === 'ppe' ? (
                      <p className="text-[11px] text-muted-foreground">
                        ชื่อหลักเหมือนกัน + รหัสกลุ่มเดียวกันทุกไซส์ — สต็อกแยกตามแถว SKU · ตำแหน่งงานกำหนดจำนวนรวม · หน้าเบิกเลือกตัดจากไซส์ไหนก็ได้ให้ครบยอด
                      </p>
                    ) : null}
                  </div>
                </>
              )}

              {createMode === 'main' && (
                <div className="grid gap-2 col-span-2">
                  <Label>รหัสกลุ่มโควต้า (ไม่บังคับ)</Label>
                  <Input
                    placeholder={config.mainQuotaKeyPlaceholder}
                    value={newItem.variantGroupKey || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantGroupKey: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    รุ่นย่อยใต้เมนนี้จะใช้รหัสกลุ่มเดียวกันอัตโนมัติ — ใช้ผูกโควต้าตำแหน่งงาน / เบิกรวมหลายไซส์
                  </p>
                </div>
              )}

              {(createMode === 'main' || createMode === 'standalone') && (
                <>
                  <div className="grid gap-2">
                    <Label>หมวดหมู่</Label>
                    {renderCategoryField('create')}
                  </div>
                  <div className="grid gap-2">
                    <Label>หน่วยนับ</Label>
                    <Input
                      placeholder={config.variant === 'ppe' ? 'ตัว, ชุด, คู่' : 'ชุด, ตัว, EA'}
                      value={newItem.unit}
                      onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                    />
                  </div>
                  {config.showToolCategoryHint ? (
                    <p className="text-[11px] text-muted-foreground col-span-2">
                      หมวดหมู่ครอบคลุมทั้งรายการ — เลือก <strong>Tool</strong> เมื่อเป็นเครื่องมือ (ใช้กฎเบิกคืนก่อนลบ)
                    </p>
                  ) : null}
                </>
              )}

              {(createMode === 'variant' || createMode === 'standalone') && (
                <>
                  <div className="grid gap-2">
                    <Label>สต็อกขั้นต่ำ</Label>
                    <Input
                      type="number"
                      value={newItem.minimumStock ?? 0}
                      onChange={(e) =>
                        setNewItem({ ...newItem, minimumStock: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>สต็อกเริ่มต้น</Label>
                    <Input
                      type="number"
                      value={newItem.currentStock ?? 0}
                      onChange={(e) =>
                        setNewItem({ ...newItem, currentStock: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </div>
                </>
              )}

              {(createMode === 'variant' || createMode === 'standalone') && (
                <StoreItemConsumableField
                  id={`consumable-create-${config.variant}`}
                  checked={newItem.isConsumable === true}
                  onCheckedChange={(v) => setNewItem({ ...newItem, isConsumable: v })}
                />
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                onClick={() => void handleCreate()}
                className={`font-bold ${accents.primaryButtonClass}`}
              >
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isEditOpen}
          onOpenChange={(o) => {
            setIsEditOpen(o);
            if (!o) {
              setEditingCatalogRole(null);
              setEditingParentId(undefined);
              setEditingItemId(null);
            }
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{editTitle}</DialogTitle>
              <DialogDescription>
                {editingCatalogRole === 'line' && editingParent && (
                  <span>
                    ภายใต้เมน: <strong>{editingParent.itemName}</strong> ({editingParent.itemCode})
                  </span>
                )}
                {editingCatalogRole === 'header' && 'ไม่แก้สต็อกที่เมน — สต็อกอยู่ที่แต่ละรุ่นย่อย'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="grid gap-2">
                <Label>รหัส</Label>
                <Input value={newItem.itemCode || ''} disabled className="bg-muted/50 font-mono text-sm" />
              </div>

              {editingCatalogRole !== 'line' && (
                <div className="grid gap-2">
                  <Label>{config.variant === 'ppe' ? 'ชื่อหลัก' : 'ชื่อรายการ (ไม่รวมไซส์)'}</Label>
                  <Input
                    value={newItem.itemName || ''}
                    onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })}
                  />
                </div>
              )}

              {editingCatalogRole === 'line' && (
                <div className="grid gap-2">
                  <Label>ชื่อหลัก</Label>
                  <Input value={editingParent?.itemName || newItem.itemName || ''} disabled className="bg-muted/50" />
                </div>
              )}

              {(editingCatalogRole === 'standalone' || editingCatalogRole === 'line') && (
                <div className="grid gap-2 col-span-2">
                  <Label>ขนาด / รุ่น</Label>
                  <Input
                    value={newItem.variantSpecification || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantSpecification: e.target.value })}
                  />
                </div>
              )}

              {editingCatalogRole === 'header' && (
                <div className="grid gap-2 col-span-2">
                  <Label>รหัสกลุ่มโควต้า</Label>
                  <Input
                    value={newItem.variantGroupKey || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantGroupKey: e.target.value })}
                  />
                </div>
              )}

              {editingCatalogRole === 'standalone' && (
                <div className="grid gap-2 col-span-2">
                  <Label>รหัสกลุ่มโควต้า</Label>
                  <Input
                    value={newItem.variantGroupKey || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantGroupKey: e.target.value })}
                  />
                  {config.variant === 'ppe' ? (
                    <p className="text-[11px] text-muted-foreground">
                      หลาย SKU ไซส์ต่างกันใช้รหัสเดียวกัน → เบิกรวมเป็นชื่อหลักได้
                    </p>
                  ) : null}
                </div>
              )}

              {editingCatalogRole !== 'line' && (
                <>
                  <div className="grid gap-2">
                    <Label>หมวดหมู่</Label>
                    {renderCategoryField('edit')}
                  </div>
                  <div className="grid gap-2">
                    <Label>หน่วยนับ</Label>
                    <Input value={newItem.unit || ''} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} />
                  </div>
                </>
              )}

              {(editingCatalogRole === 'standalone' || editingCatalogRole === 'line') && (
                <>
                  <div className="grid gap-2">
                    <Label>สต็อกขั้นต่ำ</Label>
                    <Input
                      type="number"
                      value={newItem.minimumStock ?? 0}
                      onChange={(e) =>
                        setNewItem({ ...newItem, minimumStock: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>สต็อกปัจจุบัน</Label>
                    <Input
                      type="number"
                      value={newItem.currentStock ?? 0}
                      onChange={(e) =>
                        setNewItem({ ...newItem, currentStock: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </div>
                </>
              )}

              {editingCatalogRole === 'header' && (
                <div className="grid gap-2 col-span-2 text-sm text-muted-foreground border rounded-md p-3 bg-muted/30">
                  สต็อกรวมของรุ่นย่อยจะแสดงในตารางที่หัวข้อเมน — แก้จำนวนที่แถวรุ่นย่อยแต่ละแถว
                </div>
              )}

              <div className="flex flex-row items-center gap-2 col-span-2">
                <Checkbox
                  id={`active-edit-${config.variant}`}
                  checked={newItem.active !== false}
                  onCheckedChange={(v) => setNewItem({ ...newItem, active: !!v })}
                />
                <Label htmlFor={`active-edit-${config.variant}`} className="font-normal cursor-pointer">
                  Active
                </Label>
              </div>

              {(editingCatalogRole === 'line' || editingCatalogRole === 'standalone') && (
                <StoreItemConsumableField
                  id={`consumable-edit-${config.variant}`}
                  checked={newItem.isConsumable === true}
                  onCheckedChange={(v) => setNewItem({ ...newItem, isConsumable: v })}
                />
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                onClick={() => void handleUpdate()}
                className={`font-bold ${accents.primaryButtonClass}`}
              >
                บันทึกการแก้ไข
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{config.printDialogTitle}</DialogTitle>
              <DialogDescription>{config.printDialogDescription}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {hasActiveFilters ? (
                <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                  <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                  <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                    {printFilterLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredPrintRowCount} แถว</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  ยังไม่ได้ตั้งตัวกรอง — 「พิมพ์ตามตัวกรอง」จะพิมพ์ทุกแถวที่แสดง (เท่ากับพิมพ์ทั้งหมด)
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {config.printAllTotalLabel}: {allPrintRowCount} แถว (รวมรุ่นย่อย)
              </p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filteredPrintRowCount === 0}
                onClick={() => void runCatalogPrint('filtered')}
              >
                {printBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
                พิมพ์ตามตัวกรอง ({filteredPrintRowCount})
              </Button>
              <Button
                type="button"
                className={`w-full sm:w-auto ${accents.printAllButtonClass || ''}`.trim()}
                disabled={printBusy || allPrintRowCount === 0}
                onClick={() => void runCatalogPrint('all')}
              >
                {printBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
                พิมพ์ทั้งหมด ({allPrintRowCount})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader className="bg-muted/30">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="ค้นหาชื่อ, รหัส, ขนาด/รุ่น, รหัสกลุ่ม…"
                  className="pl-9 h-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 gap-2 shrink-0"
                  onClick={() => setPrintDialogOpen(true)}
                >
                  <Printer className="h-4 w-4" />
                  พิมพ์รายการ
                </Button>
                <Filter className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-10 w-[200px]">
                    <SelectValue placeholder="หมวดหมู่" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {config.variant === 'ppe' ? 'ทุกหมวดในรายการ PPE' : 'ทุกหมวด'}
                    </SelectItem>
                    {categoryFilterOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground animate-pulse">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table className={STORE_CATALOG_TABLE_CLASS}>
                <StoreCatalogColGroup />
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className={sc.codeHead}>รหัส</TableHead>
                    <TableHead className={sc.nameHead}>ชื่อหลัก</TableHead>
                    <TableHead className={sc.variantHead}>ขนาด/รุ่น</TableHead>
                    <TableHead className={sc.categoryHead}>หมวดหมู่</TableHead>
                    <TableHead className={sc.stockHead}>คงเหลือ</TableHead>
                    <TableHead className={sc.statusHead}>สถานะ</TableHead>
                    <TableHead className={sc.actionsHead}>จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDisplayRows.map((row) =>
                    row.kind === 'standalone' ? (
                      <TableRow key={row.item.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className={`${sc.codeCell} ${accents.codeCellClass}`}>{row.item.itemCode}</TableCell>
                        <TableCell className={`${sc.nameCell} text-primary`}>
                          <span className="line-clamp-2" title={row.item.itemName}>
                            {row.item.itemName}
                          </span>
                        </TableCell>
                        <TableCell className={sc.variantCell}>
                          {(row.item.variantSpecification || '').trim() || '—'}
                          {(row.item.variantGroupKey || '').trim() ? (
                            <span className={`block text-[10px] font-mono mt-0.5 ${accents.groupKeyClass}`}>
                              กลุ่ม: {row.item.variantGroupKey}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className={sc.categoryCell}>{renderCategoryCell(row.item)}</TableCell>
                        <TableCell className={sc.stockCell}>
                          <span
                            className={`font-black text-lg ${stockTone(row.item.currentStock, row.item.minimumStock)}`}
                          >
                            {row.item.currentStock}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-1">{row.item.unit}</span>
                        </TableCell>
                        <TableCell className={sc.statusCell}>
                          <Badge className={row.item.active ? 'bg-green-600' : 'bg-slate-200'}>
                            {row.item.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className={sc.actionsCell}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`${STORE_CATALOG_ROW_ACTION_BTN_CLASS} text-primary`}
                            onClick={() => openEditDialog(row.item)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`${STORE_CATALOG_ROW_ACTION_BTN_CLASS} text-destructive`}
                            onClick={() => void handleDelete(row.item)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <Fragment key={row.header.id}>
                        <TableRow
                          className={`bg-muted/50 hover:bg-muted/60 border-t-2 ${accents.menuRowBorderClass}`}
                        >
                          <TableCell className={`${sc.codeCell} ${accents.codeCellClass}`}>
                            {row.header.itemCode}
                          </TableCell>
                          <TableCell className={`${sc.nameCell} text-primary`}>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="line-clamp-2 min-w-0" title={row.header.itemName}>
                                {row.header.itemName}
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] shrink-0 ${accents.menuBadgeClass || ''}`.trim()}
                              >
                                เมน
                              </Badge>
                              <StoreCatalogViewVariantsButton
                                headerId={row.header.id}
                                childCount={row.children.length}
                                expanded={isVariantExpanded(row.header.id)}
                                onToggle={toggleVariantExpanded}
                                className={accents.viewVariantsClass}
                              />
                            </div>
                          </TableCell>
                          <TableCell className={sc.variantCell}>—</TableCell>
                          <TableCell className={sc.categoryCell}>{renderCategoryCell(row.header)}</TableCell>
                          <TableCell className={sc.stockCell}>
                            <span className={`font-black text-lg ${accents.stockOkClass}`}>
                              {sumChildStock(row.children)}
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-1">{row.header.unit}</span>
                            <div className="text-[10px] text-muted-foreground">รวมรุ่นย่อย</div>
                          </TableCell>
                          <TableCell className={sc.statusCell}>
                            <Badge className={row.header.active !== false ? 'bg-green-600' : 'bg-slate-200'}>
                              {row.header.active !== false ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className={sc.actionsCell}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`${STORE_CATALOG_ROW_ACTION_BTN_CLASS} text-primary`}
                              onClick={() => openEditDialog(row.header)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`${STORE_CATALOG_ROW_ACTION_BTN_CLASS} text-destructive`}
                              onClick={() => void handleDelete(row.header)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isVariantExpanded(row.header.id)
                          ? row.children.map((child) => (
                              <TableRow
                                key={child.id}
                                className={`hover:bg-muted/20 border-l-4 ${accents.childRowBorderClass}`}
                              >
                                <TableCell className={sc.codeCellChild}>{child.itemCode}</TableCell>
                                <TableCell className={sc.nameCellChild}>↳ รุ่นย่อย</TableCell>
                                <TableCell className={sc.variantCell}>
                                  {(child.variantSpecification || '').trim() || '—'}
                                  {(child.variantGroupKey || '').trim() ? (
                                    <span className="block text-[10px] font-mono text-muted-foreground mt-0.5">
                                      กลุ่ม: {child.variantGroupKey}
                                    </span>
                                  ) : null}
                                </TableCell>
                                <TableCell className={sc.categoryCell}>
                                  {renderCategoryCell(child, config.variant === 'ppe')}
                                </TableCell>
                                <TableCell className={sc.stockCell}>
                                  <span className={`font-bold ${stockTone(child.currentStock, child.minimumStock)}`}>
                                    {child.currentStock}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground ml-1">{child.unit}</span>
                                </TableCell>
                                <TableCell className={sc.statusCell}>
                                  <Badge className={child.active !== false ? 'bg-green-600/90' : 'bg-slate-200'}>
                                    {child.active !== false ? 'Active' : 'Inactive'}
                                  </Badge>
                                </TableCell>
                                <TableCell className={sc.actionsCell}>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={`${STORE_CATALOG_ROW_ACTION_BTN_CLASS} text-primary`}
                                    onClick={() => openEditDialog(child)}
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={`${STORE_CATALOG_ROW_ACTION_BTN_CLASS} text-destructive`}
                                    onClick={() => void handleDelete(child)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          : null}
                      </Fragment>
                    ),
                  )}
                  {filteredDisplayRows.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">
                        {catalogItems.length === 0 ? config.emptyCatalogMessage : config.emptyFilterMessage}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

export default StoreCatalogPage;
