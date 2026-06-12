import * as React from 'react';

/** Labels that indicate a mutating action (save / edit / delete / approve / pay). */
const MUTATION_TEXT =
  /บันทึก|ยืนยัน|แก้ไข|ลบ|เพิ่ม|สร้าง|อนุมัติ|จ่าย|ตัดจ่าย|ส่ง|ลง\s*cashbook|save|delete|add|create|update|confirm|submit|approve|pay/i;

/** Navigation / read-only actions — never auto-block. */
const ALLOW_TEXT =
  /ยกเลิก|cancel|ปิด|close|รีเฟรช|refresh|พิมพ์|print|ดู|view|กลับ|back|login|logout|เข้าสู่|ออกจาก|preview|ตัวอย่าง|export|ดาวน์โหลด|download|ค้นหา|search|filter|กรอง/i;

export function flattenButtonText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenButtonText).join(' ');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return flattenButtonText(node.props.children);
  }
  return '';
}

/**
 * Heuristic: treat as mutation button when label matches save/edit patterns
 * or when type=submit (forms).
 */
export function looksLikeMutationButton(
  children: React.ReactNode,
  type?: string,
  mutationProp?: boolean,
): boolean {
  if (mutationProp === true) return true;
  if (mutationProp === false) return false;
  if (type === 'submit') return true;
  const text = flattenButtonText(children).trim();
  if (!text) return false;
  if (ALLOW_TEXT.test(text)) return false;
  return MUTATION_TEXT.test(text);
}
