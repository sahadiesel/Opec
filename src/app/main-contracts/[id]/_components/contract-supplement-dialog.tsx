'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Loader2 } from 'lucide-react';
import type { MainContract } from '@/lib/types';

interface ContractSupplementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplementTitle: string;
  setSupplementTitle: (title: string) => void;
  contractTitle: string;
  isCreating: boolean;
  onCreate: () => void;
}

export function ContractSupplementDialog({
  open,
  onOpenChange,
  supplementTitle,
  setSupplementTitle,
  contractTitle,
  isCreating,
  onCreate,
}: ContractSupplementDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Plus className="h-4 w-4" /> เอกสารสัญญาเพิ่มเติม
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>สร้างสัญญาเพิ่มเติมตำแหน่ง</DialogTitle>
          <DialogDescription>
            จะสร้างเป็นเอกสารสัญญาอีกฉบับ (แสดงแยกในรายการสัญญาลูกค้า) และ inherit เงื่อนไขวันหยุด/OT เดิม
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-2">
            <Label>ชื่อสัญญาเพิ่มเติม</Label>
            <Input
              value={supplementTitle}
              onChange={(e) => setSupplementTitle(e.target.value)}
              placeholder={`เช่น เพิ่มตำแหน่งงาน - ${contractTitle}`}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            สถานะเริ่มต้นเป็น Pending และต้องเปลี่ยนเป็น Active ก่อนใช้งาน downstream
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button onClick={onCreate} disabled={isCreating || !supplementTitle.trim()}>
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            สร้างเอกสารเพิ่มเติม
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
