'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RoleType, User } from '@/lib/types';
import { Briefcase, UserSquare2, ShieldCheck, ClipboardList, Info, AlertTriangle, FileWarning, CheckCircle2 } from 'lucide-react';

const MOCK_USERS: User[] = [
  { id: '1', email: 'admin@opec.com', displayName: 'System Admin', role: 'system_admin', createdAt: Date.now() },
  { id: '2', email: 'sales@opec.com', displayName: 'Sales Officer', role: 'sales_officer', createdAt: Date.now() },
  { id: '3', email: 'hrmgr@opec.com', displayName: 'HR Manager', role: 'hr_manager', createdAt: Date.now() },
];

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    setIsLoaded(true);
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const found = MOCK_USERS.find(u => u.email === email);
    if (found) {
      setUser(found);
      localStorage.setItem('opsflow_user', JSON.stringify(found));
    } else {
      alert('Mock Login: Try admin@opec.com, sales@opec.com, or hrmgr@opec.com');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('opsflow_user');
  };

  if (!isLoaded) return null;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="w-full max-w-md shadow-xl border-t-4 border-t-primary">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit mb-4">
              <Briefcase className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">OPEC OpsFlow</CardTitle>
            <CardDescription>
              ระบบจัดการกำลังคน OPEC Manpower Supply
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">อีเมลผู้ใช้งาน</Label>
                <input 
                  id="email" 
                  type="email" 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="name@opec.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">รหัสผ่าน</Label>
                <input 
                  id="password" 
                  type="password" 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  required 
                  defaultValue="password123" 
                />
              </div>
              <div className="bg-accent/50 p-3 rounded-md border border-accent flex gap-2">
                <Info className="h-5 w-5 text-secondary shrink-0" />
                <p className="text-xs text-muted-foreground">
                  สำหรับ Phase 1A กรุณาใช้อีเมลตัวอย่าง: <b>admin@opec.com</b> หรือ <b>hrmgr@opec.com</b>
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full h-11 text-lg">เข้าสู่ระบบ</Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <AppShell user={user} onLogout={handleLogout}>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">แดชบอร์ดภาพรวม (Overall Dashboard)</h1>
          <p className="text-muted-foreground mt-2">ยินดีต้อนรับกลับมา, {user.displayName} ระบบพร้อมสำหรับการจัดการกำลังคนวันนี้</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="hover:shadow-md transition-shadow border-l-4 border-l-green-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">คนงานที่พร้อม (Workers Ready)</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">842</div>
              <p className="text-xs text-muted-foreground">สามารถเข้าปฏิบัติงานได้ทันที</p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-shadow border-l-4 border-l-amber-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ขาดใบรับรอง (Missing Certs)</CardTitle>
              <FileWarning className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">42</div>
              <p className="text-xs text-muted-foreground">คนงานที่ยังมีเอกสารไม่ครบ</p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-shadow border-l-4 border-l-destructive">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">การตรวจร่างกายหมดอายุ</CardTitle>
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">18</div>
              <p className="text-xs text-muted-foreground">ต้องรีบดำเนินการตรวจร่างกาย</p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-shadow border-l-4 border-l-primary">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">งานที่กำลังมอบหมาย</CardTitle>
              <ClipboardList className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">156</div>
              <p className="text-xs text-muted-foreground">จำนวนงานที่มอบหมาย (Active Assignments)</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>ความพร้อมของคนงานรายโครงการ (Readiness Status)</CardTitle>
              <CardDescription>แสดงสัดส่วนคนงานที่พร้อมปฏิบัติงานตามมาตรฐาน OPEC</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px] flex flex-col items-center justify-center border-2 border-dashed rounded-lg bg-muted/20 space-y-4">
              <ShieldCheck className="h-12 w-12 text-primary opacity-20" />
              <p className="text-muted-foreground">กราฟแสดงผลความพร้อมแบบเรียลไทม์ (Chart Visualization in Phase 1B)</p>
            </CardContent>
          </Card>
          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>รายการอัปเดตล่าสุด (Recent Updates)</CardTitle>
              <CardDescription>กิจกรรมที่เกิดขึ้นล่าสุดในระบบ OpsFlow</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {[
                  { user: 'HR Manager', action: 'อัปเดตใบรับรอง', target: 'สมชาย สายชล', time: '10 นาทีที่แล้ว' },
                  { user: 'HR Officer', action: 'เพิ่มคนงานใหม่', target: 'สมนึก รักดี', time: '1 ชั่วโมงที่แล้ว' },
                  { user: 'Admin', action: 'แก้ไขตำแหน่งงาน', target: 'Offshore Welder', time: '2 ชั่วโมงที่แล้ว' },
                  { user: 'System', action: 'ตรวจสอบความพร้อม', target: 'Batch Job #89', time: '3 ชั่วโมงที่แล้ว' }
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <Info className="h-4 w-4 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">{item.action}: {item.target}</p>
                      <p className="text-xs text-muted-foreground">{item.time} โดย {item.user}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
