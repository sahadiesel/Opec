'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Save, Plus, Edit2 } from 'lucide-react';
import type { QuotationLine } from '@/lib/types';

interface QuotationLineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingLine: Partial<QuotationLine> | null;
  setEditingLine: (line: Partial<QuotationLine> | null) => void;
  onSave: () => void;
}

export function QuotationLineDialog({ open, onOpenChange, editingLine, setEditingLine, onSave }: QuotationLineDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-t-8 border-t-primary">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-black text-primary">
            {editingLine?.id ? <Edit2 className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            {editingLine?.id ? 'แก้ไขรายการบริการ' : 'เพิ่มรายการใหม่'}
          </DialogTitle>
          <DialogDescription>
            ระบุรายละเอียดสินค้าหรือบริการและราคาเสนอขาย — กด Enter เพื่อขึ้นบรรทัดใหม่ในรายละเอียด
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase text-muted-foreground">
              รายละเอียดรายการ (Description) *
            </Label>
            <Textarea
              value={editingLine?.description || ''}
              onChange={(e) => setEditingLine({ ...editingLine, description: e.target.value })}
              placeholder={'เช่น ค่าแรงช่างเชื่อม (Welder)\nเงื่อนไขเพิ่มเติม...\nกด Enter เพื่อขึ้นบรรทัดใหม่'}
              rows={5}
              className="min-h-[7.5rem] resize-y font-medium leading-relaxed whitespace-pre-wrap"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase text-muted-foreground">จำนวน (Qty)</Label>
              <Input
                type="number"
                value={editingLine?.quantity || 0}
                onChange={(e) =>
                  setEditingLine({ ...editingLine, quantity: parseFloat(e.target.value) || 0 })
                }
                className="h-11 text-center font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase text-muted-foreground">หน่วย (Unit)</Label>
              <Input
                value={editingLine?.unit || ''}
                onChange={(e) => setEditingLine({ ...editingLine, unit: e.target.value })}
                placeholder="EA, Days, Hrs"
                className="h-11 text-center uppercase font-bold"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label className="font-bold text-xs uppercase text-blue-700 tracking-wider">
                ราคาต่อหน่วย (Unit Price)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                  ฿
                </span>
                <Input
                  type="number"
                  className="h-12 pl-8 font-black text-xl text-primary border-2 border-blue-100 focus:border-blue-500"
                  value={editingLine?.unitPrice || 0}
                  onChange={(e) =>
                    setEditingLine({ ...editingLine, unitPrice: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase text-muted-foreground">
              หมายเหตุรายการ (Item Remarks)
            </Label>
            <Textarea
              value={editingLine?.remarks || ''}
              onChange={(e) => setEditingLine({ ...editingLine, remarks: e.target.value })}
              placeholder="ระบุข้อมูลเพิ่มเติมเฉพาะรายการนี้... (Enter = ขึ้นบรรทัดใหม่)"
              rows={3}
              className="min-h-[4.5rem] resize-y text-xs leading-relaxed whitespace-pre-wrap"
            />
          </div>
        </div>
        <DialogFooter className="bg-muted/30 p-4 -mx-6 -mb-6 border-t mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">
            ยกเลิก
          </Button>
          <Button
            onClick={onSave}
            disabled={!editingLine?.description}
            className="bg-primary font-black h-11 px-8 shadow-lg"
          >
            <Save className="h-4 w-4 mr-2" /> บันทึกรายการ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
