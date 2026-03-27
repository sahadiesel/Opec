'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { PurchaseOrder, MainContract } from '@/lib/types';
import { formatDateRangeThaiBE } from '@/lib/date-thai';

interface ContractPoTabProps {
  contract: MainContract;
  contractId: string;
  customerPOs: PurchaseOrder[] | null;
  canModify: boolean;
  onNavigatePO: (poId: string) => void;
}

export function ContractPoTab({ contract, contractId, customerPOs, canModify, onNavigatePO }: ContractPoTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Customer POs ที่อ้างอิงสัญญานี้</CardTitle>
          <CardDescription>รายการใบสั่งซื้อบริการกำลังคนภายใต้สัญญาฉบับนี้</CardDescription>
        </div>
        {canModify && (
          <Button
            variant="outline"
            className="gap-2"
            asChild={contract.status === 'active'}
            disabled={contract.status !== 'active'}
          >
            {contract.status === 'active' ? (
              <Link href={`/purchase-orders?contractId=${contractId}&customerId=${contract.customerId}`}>
                <Plus className="h-4 w-4" /> สร้าง Customer PO ใหม่
              </Link>
            ) : (
              <span><Plus className="h-4 w-4 inline mr-1" /> สร้าง Customer PO ใหม่ (ต้อง Active ก่อน)</span>
            )}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เลขที่ Customer PO</TableHead>
              <TableHead>หัวข้อ / โครงการ</TableHead>
              <TableHead>ระยะเวลา</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead className="text-right">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customerPOs?.map(po => (
              <TableRow key={po.id}>
                <TableCell className="font-mono font-bold">{po.poCode}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{po.title}</span>
                    <span className="text-xs text-muted-foreground">{po.projectName || 'No Project Name'}</span>
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {formatDateRangeThaiBE(po.startDate, po.endDate)}
                </TableCell>
                <TableCell>
                  <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>{po.status.toUpperCase()}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" className="gap-2" onClick={() => onNavigatePO(po.id)}>
                    <ExternalLink className="h-4 w-4" /> ดูรายละเอียด
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!customerPOs?.length && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบ Customer PO ที่อ้างอิงสัญญานี้</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
