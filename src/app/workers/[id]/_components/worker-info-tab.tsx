'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CreditCard, User, Phone, History, AlertTriangle } from 'lucide-react';
import type { Worker, Position } from '@/lib/types';

interface WorkerInfoTabProps {
  worker: Worker;
  isEditing: boolean;
  editedWorker: Partial<Worker>;
  setEditedWorker: (v: Partial<Worker>) => void;
  allPositions: Position[] | null;
}

export function WorkerInfoTab({ worker, isEditing, editedWorker, setEditedWorker, allPositions }: WorkerInfoTabProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card className="shadow-sm">
          <CardHeader className="bg-primary/5 border-b">
            <CardTitle className="text-lg flex items-center gap-2 text-primary">
              <User className="h-5 w-5" /> ข้อมูลส่วนตัว (Personal Details)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="font-bold">รหัสคนงาน (Worker Code)</Label>
                <Input disabled value={worker.workerCode || '(Auto-generated)'} className="bg-muted font-mono font-bold" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">ชื่อจริง (First Name) *</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.firstName : worker.firstName) ?? ''} onChange={e => setEditedWorker({...editedWorker, firstName: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">นามสกุล (Last Name) *</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.lastName : worker.lastName) ?? ''} onChange={e => setEditedWorker({...editedWorker, lastName: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">ชื่อเล่น (Nickname)</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.nickname : worker.nickname) ?? ''} onChange={e => setEditedWorker({...editedWorker, nickname: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">เลขบัตรประชาชน (ID Card No.) *</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.thaiNationalId : worker.thaiNationalId) ?? ''} onChange={e => setEditedWorker({...editedWorker, thaiNationalId: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">เลขพาสปอร์ต (Passport No.)</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.passportNo : worker.passportNo) ?? ''} onChange={e => setEditedWorker({...editedWorker, passportNo: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">สัญชาติ (Nationality)</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.nationality : worker.nationality) ?? ''} onChange={e => setEditedWorker({...editedWorker, nationality: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">เบอร์โทรศัพท์ (Contact Phone) *</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.contactPhone : worker.contactPhone) ?? ''} onChange={e => setEditedWorker({...editedWorker, contactPhone: e.target.value})} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="font-bold">ตำแหน่งงานหลัก (Primary Position) *</Label>
                <Select
                  disabled={!isEditing}
                  onValueChange={(v) =>
                    setEditedWorker({
                      ...editedWorker,
                      currentPositionId: v === '__none__' ? '' : v,
                    })
                  }
                  value={
                    (isEditing ? editedWorker.currentPositionId : worker.currentPositionId) || '__none__'
                  }
                >
                  <SelectTrigger className="h-10"><SelectValue placeholder="เลือกตำแหน่ง" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— เลือกตำแหน่ง —</SelectItem>
                    {allPositions?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.positionName || p.positionNameTh}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-bold">ทักษะ / ความสามารถ (Skills / Trade)</Label>
              <Input
                disabled={!isEditing}
                placeholder="เช่น Welder 6G, Rigger, Scaffolder..."
                value={(isEditing ? (editedWorker.skills ?? []) : (worker.skills ?? [])).join(', ')}
                onChange={e => setEditedWorker({...editedWorker, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
              />
            </div>

            <div className="space-y-2">
              <Label className="font-bold">ที่อยู่ (Residential Address)</Label>
              <Textarea disabled={!isEditing} value={(isEditing ? editedWorker.address : worker.address) ?? ''} onChange={e => setEditedWorker({...editedWorker, address: e.target.value})} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="bg-primary/5 border-b">
            <CardTitle className="text-lg flex items-center gap-2 text-primary">
              <Phone className="h-5 w-5" /> ผู้ติดต่อฉุกเฉิน (Emergency Contact)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="font-bold">ชื่อผู้ติดต่อ (Contact Name)</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.emergencyContactName : worker.emergencyContactName) ?? ''} onChange={e => setEditedWorker({...editedWorker, emergencyContactName: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">เบอร์โทรฉุกเฉิน (Emergency Phone)</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.emergencyContactPhone : worker.emergencyContactPhone) ?? ''} onChange={e => setEditedWorker({...editedWorker, emergencyContactPhone: e.target.value})} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="shadow-sm border-blue-100 bg-blue-50/20">
          <CardHeader className="bg-blue-100/50 border-b border-blue-100">
            <CardTitle className="text-lg flex items-center gap-2 text-blue-800">
              <CreditCard className="h-5 w-5" /> ข้อมูลการเงิน (Financial Profile)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label className="font-bold">ชื่อธนาคาร (Bank Name)</Label>
              <Input disabled={!isEditing} value={(isEditing ? editedWorker.bankName : worker.bankName) ?? ''} onChange={e => setEditedWorker({...editedWorker, bankName: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label className="font-bold">ชื่อบัญชี (Account Holder Name)</Label>
              <Input disabled={!isEditing} value={(isEditing ? editedWorker.bankAccountName : worker.bankAccountName) ?? ''} onChange={e => setEditedWorker({...editedWorker, bankAccountName: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label className="font-bold">เลขที่บัญชี (Bank Account No.)</Label>
              <Input disabled={!isEditing} value={(isEditing ? editedWorker.bankAccountNumber : worker.bankAccountNumber) ?? ''} onChange={e => setEditedWorker({...editedWorker, bankAccountNumber: e.target.value})} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="bg-destructive/5 border-b border-destructive/10">
            <CardTitle className="text-lg flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> บันทึกทางวินัย (Disciplinary Notes)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <Textarea
              disabled={!isEditing}
              className="min-h-[120px] text-destructive border-destructive/20 focus:border-destructive"
              placeholder="ระบุความผิดปกติ หรือเหตุการณ์สำคัญ..."
              value={(isEditing ? editedWorker.disciplinaryNotes : worker.disciplinaryNotes) ?? ''}
              onChange={e => setEditedWorker({...editedWorker, disciplinaryNotes: e.target.value})}
            />
          </CardContent>
        </Card>

        <Card className="shadow-sm bg-muted/20">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <History className="h-4 w-4" /> ข้อมูลระบบ (System Meta)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ลงทะเบียนเมื่อ:</span>
              <span className="font-medium">{new Date(worker.createdAt).toLocaleDateString('th-TH')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">อัปเดตล่าสุด:</span>
              <span className="font-medium">{new Date(worker.updatedAt).toLocaleString('th-TH')}</span>
            </div>
            <div className="flex justify-between border-t pt-2 mt-2">
              <span className="text-muted-foreground">สถานะงาน (Job Status):</span>
              <Badge variant="outline" className="text-[9px] uppercase font-bold">{worker.workerStatus}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
