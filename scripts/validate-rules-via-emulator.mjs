#!/usr/bin/env node
/**
 * ยิง rules → emulator's REST endpoint → ได้ error message ชัด ๆ ถ้า syntax/semantic error
 *
 * ใช้: เปิด `firebase emulators:start --only firestore` ค้างไว้ใน terminal อื่น
 *      หรือใช้ผ่าน `firebase emulators:exec` แบบ inline
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const RULES_PATH = resolve(process.cwd(), process.argv[2] || 'firestore.rules');
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-validate';

const url = `http://${HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`;
const rulesText = readFileSync(RULES_PATH, 'utf8');
const body = JSON.stringify({
  rules: {
    files: [{ name: 'firestore.rules', content: rulesText }],
  },
});

console.log(`PUT ${url}`);
console.log(`Rules file: ${RULES_PATH} (${(rulesText.length / 1024).toFixed(1)} KB)`);

try {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  console.log(`Status: ${res.status} ${res.statusText}`);
  if (res.ok) {
    console.log('✅ RULES VALID — emulator accepted them');
    process.exit(0);
  } else {
    console.log('❌ RULES REJECTED:');
    try {
      const parsed = JSON.parse(text);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(text);
    }
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Cannot reach emulator:', e.message);
  console.error('   ตรวจว่า emulator รันอยู่ที่', HOST);
  process.exit(2);
}
