import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { PO_ACTIVE_AUTO_DAILY_FN_ACTOR, runPoActiveAutoDailyScheduledJob } from './poActiveAutoDailyRun';

const REGION = 'asia-southeast1';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

/**
 * เติม PO Active auto daily (work_day) ให้ครบทุก mobilization ที่ ACTIVE — เฉพาะวันที่ปัจจุบันเขต Asia/Bangkok
 *
 * Cloud Scheduler (สร้างอัตโนมัติเมื่อ deploy): cron 00:20 น. ไทยทุกวัน
 */
export const poActiveAutoDailySchedule = onSchedule(
  {
    schedule: '20 0 * * *',
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
