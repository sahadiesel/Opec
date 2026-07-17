'use client';

import { LeaseContractsClient } from '../lease-contracts-client';

export default function PropertyLeaseContractsPage() {
  return <LeaseContractsClient leaseKind="PROPERTY" />;
}
