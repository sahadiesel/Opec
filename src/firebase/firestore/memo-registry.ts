/**
 * Firestore Query / DocumentReference / CollectionReference จาก SDK บางเวอร์ชัน / โหมด production
 * เป็นอ็อบเจ็กต์ที่ขยาย property ไม่ได้ — ใส่ __memo บนตัวอ้างอิงจะพังตอน render
 * ใช้ WeakSet แทนการ mutate
 */
const firebaseMemoTargets = new WeakSet<object>();

export function registerFirebaseMemoTarget(target: object): void {
  firebaseMemoTargets.add(target);
}

export function isFirebaseMemoRegistered(target: object): boolean {
  return firebaseMemoTargets.has(target);
}
