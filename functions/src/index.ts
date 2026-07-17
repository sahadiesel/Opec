import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { PO_ACTIVE_AUTO_DAILY_FN_ACTOR, runPoActiveAutoDailyScheduledJob } from './poActiveAutoDailyRun';
import { runRentalContractDailyJob } from './rentalContractSchedule';

const REGION = 'asia-southeast1';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

/**
 * เติม PO Active auto daily (work_day / ช่วง SB หลังหยุดแบบ standby) — เฉพาะวันที่ปัจจุบันเขต Asia/Bangkok
 *
 * Cloud Scheduler (สร้างเมื่อ deploy — หรือผูก job HTTP/cron ใน GCP Console): cron 00:10 น. ไทยทุกวัน
 * ไม่ต้องมีผู้เปิดเว็บ — คู่กับ client-side sync ~45 วินาทีเมื่อมีผู้ใช้เปิดกระดาน
 */
export const poActiveAutoDailySchedule = onSchedule(
  {
    schedule: '10 0 * * *',
    timeZone: 'Asia/Bangkok',
    region: REGION,
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const started = Date.now();
    logger.info('[poActiveAutoDailySchedule] start', { actor: PO_ACTIVE_AUTO_DAILY_FN_ACTOR });
    const totals = await runPoActiveAutoDailyScheduledJob(db);
    logger.info('[poActiveAutoDailySchedule] done', {
      ...totals,
      durationMs: Date.now() - started,
    });
  },
);

/** สร้างเจ้าหนี้ค่าเช่ารายเดือนเมื่อถึงวันครบกำหนด — id deterministic ป้องกันสร้างซ้ำ */
export const rentalContractDailySchedule = onSchedule(
  {
    schedule: '20 0 * * *',
    timeZone: 'Asia/Bangkok',
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const started = Date.now();
    logger.info('[rentalContractDailySchedule] start');
    const totals = await runRentalContractDailyJob(db);
    logger.info('[rentalContractDailySchedule] done', {
      ...totals,
      durationMs: Date.now() - started,
    });
  },
);
