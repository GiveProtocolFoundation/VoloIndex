/**
 * Volo Index — Retention Purge Route (GIV-742)
 *
 * POST /api/internal/retention/run  { dryRun?: true }
 * Guarded by x-internal-key middleware (server-only).
 */

import { Router } from 'express';
import { pool } from '../db.js';
import { runRetention } from '../retention.js';

const router = Router();

router.post('/run', async (req, res, next) => {
  try {
    const dryRun = req.body.dryRun === true;
    const results = await runRetention(pool, { dryRun });
    // A step that threw reports -1; surface it as a 500 so the daily
    // cron (which only checks the HTTP status) goes red instead of
    // silently skipping part of the retention schedule.
    const failedSteps = Object.entries(results).filter(([, v]) => v === -1).map(([k]) => k);
    res.status(failedSteps.length ? 500 : 200).json({ dryRun, results, failedSteps });
  } catch (err) { next(err); }
});

export default router;
