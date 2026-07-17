'use client';

import { LeaseContractsClient } from '../lease-contracts-client';

export default function VehicleLeaseContractsPage() {
  return <LeaseContractsClient leaseKind="VEHICLE" />;
}
