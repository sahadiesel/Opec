'use client';

import {
  StoreCatalogPage,
  EQUIPMENT_STORE_CATALOG_CONFIG,
} from '@/components/store/store-catalog-page';

export default function StoreItemsPage() {
  return <StoreCatalogPage config={EQUIPMENT_STORE_CATALOG_CONFIG} />;
}
