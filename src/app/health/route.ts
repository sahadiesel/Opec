import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * เบราว์เซอร์ใน IDE มักแสดงหน้าขาวกับ JSON ล้วน — ส่ง HTML ให้เห็นชัดเมื่อเปิดจาก Simple Browser
 * ขอ JSON ได้ด้วย: curl -H "Accept: application/json" http://localhost:9003/health
 */
export async function GET(request: NextRequest) {
  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('application/json')) {
    return NextResponse.json({ ok: true, t: Date.now() });
  }

  const t = Date.now();
  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>OPEC OpsFlow — Health</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #0f172a; color: #e2e8f0; }
    .box { padding: 2rem; border-radius: 12px; background: #1e293b; border: 1px solid #334155; max-width: 28rem; }
    h1 { margin: 0 0 0.5rem; font-size: 1.25rem; color: #4ade80; }
    p { margin: 0.5rem 0; color: #94a3b8; font-size: 0.9rem; }
    a { color: #38bdf8; }
    pre { margin-top: 1rem; padding: 0.75rem; background: #0f172a; border-radius: 8px; font-size: 0.75rem; overflow: auto; }
  </style>
</head>
<body>
  <div class="box">
    <h1>เซิร์ฟเวอร์ทำงานปกติ</h1>
    <p>นี่คือหน้า <strong>/health</strong> — ถ้าเห็นข้อความนี้แปลว่า Next dev ตอบสนองแล้ว</p>
    <p><a href="/">ไปหน้าแรก (ล็อกอิน)</a></p>
    <pre>${JSON.stringify({ ok: true, t }, null, 2)}</pre>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
