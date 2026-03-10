'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ShoppingCart, MoreHorizontal, FileText, TrendingUp, DollarSign } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PurchaseOrder, POLine, RoleType, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup } from 'firebase/firestore';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export default function PurchaseOrdersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) {
      try {
        setCurrentUser(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse user session', e);
      }
    }
  }, []);

  const poQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !currentUser || firebaseUser.uid !== currentUser.id) return null;
    return collectionGroup(firestore, 'purchase_orders');
  }, [firestore, isUserLoading, firebaseUser, currentUser]);

  const { data: pos, isLoading: isPOLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const poLinesQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !currentUser || firebaseUser.uid !== currentUser.id) return null;
    return collectionGroup(firestore, 'po_lines');
  }, [firestore, isUserLoading, firebaseUser, currentUser]);

  const { data: allPOLines } = useCollection<POLine>(poLinesQuery as any);

  if (isUserLoading || !currentUser || (firebaseUser && firebaseUser.uid !== currentUser.id)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">กำลังตรวจสอบสิทธิ์การเข้าถึง...</p>
        </div>
      </div>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <ShoppingCart className="h-6 w-6" /> ใบสั่งซื้อ (Purchase Orders)
            </h1>
            <p className="text-muted-foreground">บริหารจัดการใบสั่งซื้อและการจองกำลังคนรายตำแหน่ง</p>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> สร้างใบสั่งซื้อใหม่
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการใบสั่งซื้อและรายละเอียด PO Lines</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาเลขที่ PO..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isPOLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูล...</div>
            ) : (
              <Accordion type="single" collapsible className="w-full">
                {pos?.map((po) => (
                  <AccordionItem key={po.id} value={po.id}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex flex-1 items-center justify-between pr-4">
                        <div className="flex items-center gap-4">
                          <Badge variant="outline" className="font-mono">{po.poNumber}</Badge>
                          <span className="font-semibold">{po.title}</span>
                        </div>
                        <div className="flex items-center gap-6 text-sm text-muted-foreground">
                          <span>{new Date(po.startDate).toLocaleDateString('th-TH')} - {new Date(po.endDate).toLocaleDateString('th-TH')}</span>
                          <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>
                            {po.status.toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="px-4 py-2 space-y-4">
                        <div className="bg-muted/30 p-4 rounded-lg border">
                          <h4 className="text-sm font-bold flex items-center gap-2 mb-3">
                            <FileText className="h-4 w-4" /> รายการตำแหน่งที่สั่งจอง (PO Lines)
                          </h4>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>ตำแหน่ง</TableHead>
                                <TableHead>จำนวน</TableHead>
                                <TableHead>Sell Rate</TableHead>
                                <TableHead>Cost Baseline</TableHead>
                                <TableHead>หน่วย</TableHead>
                                <TableHead>โอที</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {allPOLines?.filter(line => line.poId === po.id).map(line => (
                                <TableRow key={line.id}>
                                  <TableCell className="font-medium">{line.positionId}</TableCell>
                                  <TableCell>{line.quantity} อัตรา</TableCell>
                                  <TableCell className="text-green-600 font-semibold">
                                    ฿{line.sellRateSnapshot.toLocaleString()}
                                  </TableCell>
                                  <TableCell className="text-blue-600">
                                    ฿{line.costBaselineSnapshot.toLocaleString()}
                                  </TableCell>
                                  <TableCell className="capitalize">{line.billingUnitSnapshot}</TableCell>
                                  <TableCell className="text-xs">{line.overtimeRuleSnapshot}</TableCell>
                                </TableRow>
                              ))}
                              {(!allPOLines || allPOLines.filter(l => l.poId === po.id).length === 0) && (
                                <TableRow>
                                  <TableCell colSpan={6} className="text-center py-4 text-muted-foreground italic">ไม่พบรายการ PO Lines</TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm">แก้ไขใบสั่งซื้อ</Button>
                          <Button variant="outline" size="sm">พิมพ์ใบแจ้งงาน</Button>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
                {!isPOLoading && (!pos || pos.length === 0) && (
                  <div className="py-10 text-center text-muted-foreground italic">ไม่พบข้อมูลใบสั่งซื้อในระบบ</div>
                )}
              </Accordion>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}