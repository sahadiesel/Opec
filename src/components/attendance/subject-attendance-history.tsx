'use client';

import { useMemo } from 'react';
import {
  collection,
  Firestore,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { ATTENDANCE_PUNCHES_COLLECTION } from '@/lib/attendance/constants';
import type { AttendancePunchDoc, AttendanceSubjectType } from '@/lib/attendance/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { formatDateTimeThaiBE } from '@/lib/date-thai';

const HISTORY_LIMIT = 400;

export function SubjectAttendanceHistory(props: {
  firestore: Firestore;
  subjectType: AttendanceSubjectType;
  subjectId: string;
  title?: string;
  description?: string;
}) {
  const { firestore, subjectType, subjectId, title, description } = props;

  const punchesQuery = useMemoFirebase(() => {
    if (!subjectId) return null;
    return query(
      collection(firestore, ATTENDANCE_PUNCHES_COLLECTION),
      where('subjectType', '==', subjectType),
      where('subjectId', '==', subjectId),
      orderBy('punchedAt', 'desc'),
      limit(HISTORY_LIMIT),
    );
  }, [firestore, subjectType, subjectId]);

  const { data: punches, isLoading, error } = useCollection<AttendancePunchDoc>(punchesQuery as any);

  const rows = useMemo(() => punches ?? [], [punches]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="bg-muted/30 border-b py-4">
        <CardTitle className="text-lg">{title ?? 'ประวัติการลงเวลา (Kiosk)'}</CardTitle>
        <CardDescription>
          {description ??
            'บันทึกเข้า/ออกจากหน้าลงเวลาบนมือถือหลังสแกน QR — แสดงล่าสุดในชุดนี้'}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดประวัติ…
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive py-2">
            โหลดไม่สำเร็จ — {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">ยังไม่มีบันทึกการลงเวลาผ่าน Kiosk</p>
        )}
        {!isLoading && !error && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วันเวลา</TableHead>
                <TableHead>การกระทำ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm whitespace-nowrap">
                    {formatDateTimeThaiBE(r.punchedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.direction === 'IN' ? 'default' : 'secondary'} className="font-normal">
                      {r.direction === 'IN' ? 'เข้างาน (IN)' : 'ออกงาน (OUT)'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
