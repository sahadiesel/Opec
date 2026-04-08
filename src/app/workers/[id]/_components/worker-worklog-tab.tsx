'use client';

import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { History } from 'lucide-react';

interface WorkLogRow {
  assignmentId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  totalHours: number;
}

interface WorkerWorklogTabProps {
  workLogRows: WorkLogRow[];
  totalWorkedHours: number;
}

export function WorkerWorklogTab({ workLogRows, totalWorkedHours }: WorkerWorklogTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2 text-primary">
            <History className="h-5 w-5" /> ประวัติการลงงานและชั่วโมงสะสม
          </CardTitle>
          <CardDescription>คำนวณจาก Timesheet ที่บันทึกไว้ทั้งหมด</CardDescription>
        </div>
        <Badge className="bg-primary text-white">รวม {totalWorkedHours.toLocaleString()} ชั่วโมง</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="pl-6 font-bold">Assignment</TableHead>
              <TableHead className="font-bold">วันที่เริ่ม</TableHead>
              <TableHead className="font-bold">วันที่สิ้นสุด</TableHead>
              <TableHead className="text-right pr-6 font-bold">ชั่วโมงรวม</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workLogRows.map((row) => (
              <TableRow key={`${row.assignmentId}-${row.startDate}-${row.endDate}`}>
                <TableCell className="pl-6 font-mono text-xs">{row.assignmentId || '-'}</TableCell>
                <TableCell className="text-xs">
                  {row.startDate ? formatYmdLocalThaiBE(row.startDate) : '-'}
                </TableCell>
                <TableCell className="text-xs">
                  {row.endDate ? formatYmdLocalThaiBE(row.endDate) : '-'}
                </TableCell>
                <TableCell className="text-right pr-6 font-bold text-primary">{Number(row.totalHours || 0).toLocaleString()} ชม.</TableCell>
              </TableRow>
            ))}
            {workLogRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-20 text-center text-muted-foreground italic">ยังไม่มีประวัติการลงเวลา</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
