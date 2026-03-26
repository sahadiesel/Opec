'use client';

import { useState, useMemo } from 'react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from '@/components/ui/card';
import { 
  TrendingUp, 
  TrendingDown, 
  Coins, 
  Calculator, 
  Info, 
  AlertTriangle,
  Loader2,
  RefreshCcw,
  BarChart,
  Target,
  CheckCircle2
} from 'lucide-react';
import Link from 'next/link';
import { 
  PurchaseOrder, 
  POLine, 
  SalesContractTerm, 
  LaborCostContractTerm, 
  RateCondition,
  User,
  PurchaseOrderProfitSnapshot
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ProfitCalculatorService } from '@/lib/services/profit-calculator';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

interface ProfitAnalysisTabProps {
  po: PurchaseOrder;
  poLines: POLine[];
  salesTerms: SalesContractTerm[];
  costTerms: LaborCostContractTerm[];
  allConditions: RateCondition[];
  user: User;
}

export function ProfitAnalysisTab({ po, poLines, salesTerms, costTerms, allConditions, user }: ProfitAnalysisTabProps) {
  const [isCalculating, setIsCalculating] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  const handleRunAnalysis = async () => {
    const salesTerm = salesTerms.find(t => t.status === 'ACTIVE');
    const costTerm = costTerms.find(t => t.status === 'ACTIVE');

    if (!salesTerm || !costTerm) return;

    setIsCalculating(true);
    try {
      const calculator = new ProfitCalculatorService();
      const result = await calculator.computeEstimatedProfitForPO(
        po,
        poLines,
        salesTerm,
        costTerm,
        allConditions,
        user
      );
      setAnalysisResult(result);
    } catch (e) {
      console.error(e);
    } finally {
      setIsCalculating(false);
    }
  };

  const snapshot = analysisResult?.snapshot;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-primary flex items-center gap-2">
            <Calculator className="h-6 w-6" /> ประมาณการกำไรและต้นทุน (Profit Estimation)
          </h3>
          <p className="text-sm text-muted-foreground italic">
            {po.poType === 'quotation'
              ? 'คำนวณจากโควต้าใน PO Lines และเงื่อนไขการขายที่ผูก PO (สายใบเสนอราคา) ณ ปัจจุบัน'
              : 'คำนวณจากโควต้าใน PO Lines และเงื่อนไขสัญญาเชิงพาณิชย์ ณ ปัจจุบัน'}
          </p>
        </div>
        <Button onClick={handleRunAnalysis} disabled={isCalculating} className="gap-2 bg-primary font-bold shadow-md h-11 px-6">
          {isCalculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          รันการวิเคราะห์ใหม่ (Run Analysis)
        </Button>
      </div>

      {!snapshot ? (
        <Card className="border-dashed border-2 py-20 text-center">
          <CardContent className="space-y-4">
            <BarChart className="h-12 w-12 mx-auto text-muted-foreground/20" />
            <p className="text-muted-foreground">กดปุ่ม "รันการวิเคราะห์ใหม่" เพื่อเริ่มคำนวณกำไรเบื้องต้นของโครงการนี้</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main KPIs */}
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatDisplay 
                label="รายรับรวม (Revenue)" 
                value={`฿${snapshot.estimatedRevenue.toLocaleString()}`} 
                icon={TrendingUp} 
                color="text-blue-600"
                bg="bg-blue-50"
              />
              <StatDisplay 
                label="ต้นทุนแรงงาน (Cost)" 
                value={`฿${snapshot.estimatedLaborCost.toLocaleString()}`} 
                icon={TrendingDown} 
                color="text-orange-600"
                bg="bg-orange-50"
              />
              <StatDisplay 
                label="กำไรเบื้องต้น (GP)" 
                value={`฿${snapshot.estimatedGrossProfit.toLocaleString()}`} 
                icon={Coins} 
                color="text-green-700"
                bg="bg-green-50"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Target className="h-5 w-5 text-primary" /> สรุปอัตรากำไร (Margin Analysis)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-8">
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <span className="text-sm font-bold text-muted-foreground">Gross Profit Margin (%)</span>
                    <span className="text-4xl font-black text-primary">{snapshot.estimatedGrossMarginPercent.toFixed(2)}%</span>
                  </div>
                  <Progress value={snapshot.estimatedGrossMarginPercent} className="h-3" />
                  <div className="flex justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    <span>Low Margin (0%)</span>
                    <span>Target (25-35%)</span>
                    <span>High Margin (50%+)</span>
                  </div>
                </div>

                <Separator />

                <div className="bg-muted/30 p-4 rounded-lg space-y-3">
                  <p className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-2">
                    <Info className="h-3 w-3" /> Basis of Calculation
                  </p>
                  <p className="text-xs italic leading-relaxed text-slate-600">
                    {snapshot.calculationBasisSummary}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Warnings & Integrity */}
          <div className="space-y-6">
            <Card className="bg-amber-50 border-amber-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-black uppercase text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Integrity Checks
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                {analysisResult.warnings.length > 0 ? (
                  analysisResult.warnings.map((w: string, i: number) => (
                    <div key={i} className="flex gap-2 text-[10px] text-amber-700 leading-tight">
                      <span className="font-bold">•</span>
                      <span>{w}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center gap-2 text-xs text-green-700 font-bold">
                    <CheckCircle2 className="h-4 w-4" /> Rules are fully covered.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase text-muted-foreground">Action Items</CardTitle></CardHeader>
              <CardContent className="space-y-2 pt-2">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  หากอัตรากำไร (Margin) ต่ำกว่าเกณฑ์มาตรฐานบริษัท (Target 30%) กรุณาตรวจสอบ Sell Rates ในสัญญาหลักหรือเงื่อนไขต้นทุน (Labor Cost Terms) เพื่อปรับปรุงโครงสร้างกำไร
                </p>
                <Button variant="link" className="p-0 h-auto text-[10px] font-bold" asChild>
                  <Link href="/sales-terms">แก้ไขเงื่อนไขการขาย (Revenue Rules)</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function StatDisplay({ label, value, icon: Icon, color, bg }: any) {
  return (
    <Card className="border-none shadow-sm overflow-hidden">
      <div className={`p-4 ${bg} flex items-center gap-4`}>
        <div className={`p-2 rounded-lg bg-white ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">{label}</span>
          <span className={`text-xl font-black ${color}`}>{value}</span>
        </div>
      </div>
    </Card>
  );
}
