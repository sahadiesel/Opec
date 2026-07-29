import type { RentalContract, Vendor } from '@/lib/types';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value: number): string {
  return Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatContractDate(ymd?: string, fallbackMs?: number): string {
  if (ymd?.trim()) {
    const d = new Date(`${ymd.trim()}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('th-TH');
  }
  if (fallbackMs) return new Date(fallbackMs).toLocaleDateString('th-TH');
  return '........................';
}

const PRINT_CSS = `
  .rc { font-family: "Sarabun", Tahoma, sans-serif; color:#111; font-size:14px; line-height:1.75; }
  .rc h1 { text-align:center; font-size:22px; margin:0 0 22px; }
  .rc .meta { text-align:right; margin-bottom:18px; }
  .rc .party { margin:10px 0; text-indent:2em; }
  .rc .term { margin:10px 0; text-align:justify; text-indent:2em; }
  .rc .sign { display:grid; grid-template-columns:1fr 1fr; gap:48px; margin-top:55px; text-align:center; }
  .rc .line { margin-top:55px; border-top:1px dotted #333; padding-top:6px; }
  .rc .page-break { break-before:page; page-break-before:always; }
  @media print { .rc { font-size:14px; } }
`;

function buildPropertyPrintHtml(contract: RentalContract, vendor: Vendor): string {
  const lessorAddress = vendor.address?.trim() || '........................................................................';
  const madeAt = contract.madeAtLocation?.trim() || 'บริษัท OPEC';
  const item = contract.propertyAddress?.trim() || contract.rentedItemDescription;
  const terms = [
    `ผู้ให้เช่าตกลงให้เช่าและผู้เช่าตกลงเช่า “${item}”`,
    `กำหนดระยะเวลาเช่าตั้งแต่วันที่ ${contract.startDate} ถึงวันที่ ${contract.endDate}`,
    `ค่าเช่าเดือนละ ${money(contract.monthlyRentAmount)} บาท (${amountToThaiBahtText(contract.monthlyRentAmount)}) โดยครบกำหนดชำระวันที่ ${contract.paymentDayOfMonth} ของทุกเดือน${
      Number(contract.vatRatePercent) > 0
        ? ` พร้อมภาษีมูลค่าเพิ่มในอัตรา ${money(Number(contract.vatRatePercent))}% ของค่าเช่า`
        : ''
    }`,
    `ผู้เช่าจะหักภาษี ณ ที่จ่ายในอัตรา ${money(contract.withholdingTaxRatePercent)}% ของค่าเช่าก่อนภาษีมูลค่าเพิ่ม ตามกฎหมาย และออกหนังสือรับรองให้ผู้ให้เช่า`,
    'ผู้ให้เช่ารับรองว่าทรัพย์สินที่ให้เช่าอยู่ในสภาพพร้อมใช้งาน และมีสิทธิให้เช่าโดยชอบด้วยกฎหมาย',
    'ผู้เช่าจะใช้ทรัพย์สินตามวัตถุประสงค์ ดูแลรักษาตามสมควร และไม่ดัดแปลงโดยไม่ได้รับความยินยอมเป็นหนังสือ',
    'ค่าใช้จ่ายในการซ่อมแซมจากการใช้งานตามปกติเป็นหน้าที่ของผู้ให้เช่า ส่วนความเสียหายจากความผิดของผู้เช่าเป็นหน้าที่ของผู้เช่า',
    'เมื่อสัญญาสิ้นสุด ผู้เช่าจะส่งคืนทรัพย์สินในสภาพตามการใช้งานปกติ เว้นแต่คู่สัญญาตกลงต่ออายุเป็นหนังสือ',
    'หากฝ่ายใดผิดสัญญา อีกฝ่ายมีสิทธิบอกกล่าวให้แก้ไขภายในระยะเวลาสมควร และบอกเลิกสัญญาได้หากไม่แก้ไข',
    'การแก้ไขเพิ่มเติมสัญญาต้องทำเป็นหนังสือและลงนามโดยคู่สัญญาทั้งสองฝ่าย',
    'คู่สัญญาตกลงให้ที่อยู่ตามสัญญาเป็นที่อยู่สำหรับส่งคำบอกกล่าว จนกว่าจะมีหนังสือแจ้งเปลี่ยนแปลง',
    'สัญญานี้อยู่ภายใต้กฎหมายไทย และข้อพิพาทให้อยู่ในเขตอำนาจศาลไทย',
  ];
  return `
    <style>${PRINT_CSS}</style>
    <main class="rc">
      <h1>สัญญาเช่าบ้าน / อาคาร / โรงงาน</h1>
      <div class="meta">เลขที่สัญญา ${esc(contract.contractNo)}<br/>ทำที่ ${esc(madeAt)}<br/>วันที่ ${esc(
        formatContractDate(contract.contractDate, contract.approvedAt),
      )}</div>
      <p class="party">สัญญาฉบับนี้ทำขึ้นระหว่าง <strong>${esc(vendor.vendorName)}</strong>
      เลขประจำตัวผู้เสียภาษี ${esc(vendor.taxId || '........................')} ที่อยู่ ${esc(lessorAddress)}
      ซึ่งต่อไปในสัญญานี้เรียกว่า “ผู้ให้เช่า” ฝ่ายหนึ่ง</p>
      <p class="party">กับ <strong>${esc(contract.tenantName)}</strong> ซึ่งต่อไปในสัญญานี้เรียกว่า “ผู้เช่า” อีกฝ่ายหนึ่ง</p>
      <p>คู่สัญญาตกลงกันดังต่อไปนี้</p>
      ${terms
        .slice(0, 6)
        .map((t, i) => `<p class="term"><strong>ข้อ ${i + 1}.</strong> ${esc(t)}</p>`)
        .join('')}
      <div class="page-break"></div>
      ${terms
        .slice(6)
        .map((t, i) => `<p class="term"><strong>ข้อ ${i + 7}.</strong> ${esc(t)}</p>`)
        .join('')}
      ${contract.notes?.trim() ? `<p class="term"><strong>หมายเหตุ:</strong> ${esc(contract.notes)}</p>` : ''}
      <p class="term">สัญญานี้ทำขึ้นสองฉบับ มีข้อความถูกต้องตรงกัน คู่สัญญาได้อ่านและเข้าใจโดยตลอดแล้ว จึงลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน</p>
      <div class="sign">
        <div><div class="line">ผู้ให้เช่า (${esc(vendor.vendorName)})</div></div>
        <div><div class="line">ผู้เช่า (${esc(contract.tenantName)})</div></div>
        <div><div class="line">พยาน</div></div>
        <div><div class="line">พยาน</div></div>
      </div>
    </main>
  `;
}

function buildVehiclePrintHtml(contract: RentalContract, vendor: Vendor): string {
  const lessorAddress = vendor.address?.trim() || '........................................................................';
  const madeAt = contract.madeAtLocation?.trim() || '................................';
  const brand = contract.vehicleBrand?.trim() || '........................';
  const plate = contract.vehiclePlateNo?.trim() || '........................';
  const months =
    contract.leaseDurationMonths != null && contract.leaseDurationMonths > 0
      ? String(contract.leaseDurationMonths)
      : '......';
  const advance =
    contract.advanceRentMonths != null && contract.advanceRentMonths >= 0
      ? String(contract.advanceRentMonths)
      : '......';
  const deposit = Number(contract.securityDepositAmount || 0);
  const depositWords = deposit > 0 ? amountToThaiBahtText(deposit) : '................................';
  const rentWords = amountToThaiBahtText(contract.monthlyRentAmount);

  return `
    <style>${PRINT_CSS}</style>
    <main class="rc">
      <h1>สัญญาเช่ารถยนต์</h1>
      <div class="meta">เลขที่สัญญา ${esc(contract.contractNo)}</div>
      <p class="party">สัญญาฉบับนี้ ทำที่ ${esc(madeAt)} เมื่อวันที่ ${esc(
        formatContractDate(contract.contractDate, contract.approvedAt),
      )}</p>
      <p class="party">ระหว่าง <strong>${esc(vendor.vendorName)}</strong>
      เลขประจำตัวผู้เสียภาษี ${esc(vendor.taxId || '........................')} ที่อยู่ ${esc(lessorAddress)}
      ซึ่งต่อไปในสัญญานี้เรียกว่า “ผู้ให้เช่า” ฝ่ายหนึ่ง</p>
      <p class="party">กับ <strong>${esc(contract.tenantName)}</strong> ซึ่งต่อไปในสัญญานี้เรียกว่า “ผู้เช่า” อีกฝ่ายหนึ่ง</p>
      <p>ทั้งสองฝ่ายตกลงทำสัญญาเช่ารถยนต์ โดยมีข้อความดังต่อไปนี้</p>
      <p class="term"><strong>ข้อ 1.</strong> ผู้ให้เช่าตกลงให้เช่าและผู้เช่าตกลงเช่ารถยนต์ยี่ห้อ
        ${esc(brand)} เลขทะเบียน ${esc(plate)} เป็นระยะเวลา ${esc(months)} เดือน
        นับตั้งแต่วันที่ ${esc(contract.startDate)} ถึงวันที่ ${esc(contract.endDate)}</p>
      <p class="term"><strong>ข้อ 2.</strong> ผู้เช่าตกลงชำระค่าเช่าให้แก่ผู้ให้เช่าในอัตราเดือนละ
        ${esc(money(contract.monthlyRentAmount))} บาท (${esc(rentWords)})
        ${
          Number(contract.vatRatePercent) > 0
            ? ` พร้อมภาษีมูลค่าเพิ่มในอัตรา ${esc(money(Number(contract.vatRatePercent)))}% ของค่าเช่า`
            : ''
        }
        โดยชำระค่าเช่าล่วงหน้า ${esc(advance)} เดือน ในวันที่ทำสัญญานี้ และชำระค่าเช่ารายเดือนถัดไปภายในวันที่
        ${esc(contract.paymentDayOfMonth)} ของทุกเดือน พร้อมวางเงินประกันการเช่าจำนวน
        ${esc(money(deposit))} บาท (${esc(depositWords)})
        ซึ่งผู้ให้เช่าจะคืนให้เมื่อสิ้นสุดสัญญาและไม่มีค่าเสียหายค้างชำระ
        ${
          contract.withholdingTaxRatePercent > 0
            ? ` ผู้เช่าจะหักภาษี ณ ที่จ่ายในอัตรา ${esc(money(contract.withholdingTaxRatePercent))}% ของค่าเช่าก่อนภาษีมูลค่าเพิ่ม ตามกฎหมาย`
            : ''
        }</p>
      <p class="term"><strong>ข้อ 3.</strong> การชำระค่าเช่าตามสัญญานี้ ให้ชำระ ณ ภูมิลำเนาของผู้ให้เช่า หรือตามที่ผู้ให้เช่ากำหนด</p>
      <p class="term"><strong>ข้อ 4.</strong> ผู้เช่ารับรองว่าได้ตรวจสภาพรถยนต์ที่เช่าแล้ว และยอมรับสภาพตามที่เป็นอยู่ในวันที่รับมอบ</p>
      <p class="term"><strong>ข้อ 5.</strong> หากเกิดอุบัติเหตุ ผู้เช่าต้องรับผิดชอบความเสียหายต่อรถยนต์ที่เช่า และ/หรือต่อบุคคลภายนอก ตามที่เกิดขึ้นจริง</p>
      <p class="term"><strong>ข้อ 6.</strong> หากเกิดการบาดเจ็บหรือสูญเสียชีวิตแก่บุคคลภายนอกหรือผู้เช่า อันเนื่องจากการใช้รถยนต์ที่เช่า ผู้เช่าต้องรับผิดชอบเองทั้งสิ้น</p>
      <p class="term"><strong>ข้อ 7.</strong> หากรถยนต์ที่เช่า เครื่องมือ หรืออุปกรณ์ประกอบสูญหายหรือถูกโจรกรรม ผู้เช่าต้องรับผิดชอบชดใช้ตามมูลค่าที่เสียหาย</p>
      <p class="term"><strong>ข้อ 8.</strong> เมื่อสิ้นสุดสัญญา ผู้เช่าต้องส่งคืนรถยนต์และอุปกรณ์ประกอบให้อยู่ในสภาพใช้งานได้ดี ณ สถานที่ที่ผู้ให้เช่ากำหนด</p>
      ${contract.notes?.trim() ? `<p class="term"><strong>หมายเหตุ:</strong> ${esc(contract.notes)}</p>` : ''}
      <p class="term">สัญญานี้ทำขึ้นสองฉบับ มีข้อความถูกต้องตรงกัน คู่สัญญาได้อ่านและเข้าใจโดยตลอดแล้ว จึงลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน</p>
      <div class="sign">
        <div><div class="line">ผู้ให้เช่า (${esc(vendor.vendorName)})</div></div>
        <div><div class="line">ผู้เช่า (${esc(contract.tenantName)})</div></div>
        <div><div class="line">พยาน</div></div>
        <div><div class="line">พยาน</div></div>
      </div>
    </main>
  `;
}

/** แบบพิมพ์สัญญาเช่า — แยก PROPERTY / VEHICLE */
export function buildRentalContractPrintHtml(contract: RentalContract, vendor: Vendor): string {
  if (contract.leaseKind === 'VEHICLE') {
    return buildVehiclePrintHtml(contract, vendor);
  }
  return buildPropertyPrintHtml(contract, vendor);
}
