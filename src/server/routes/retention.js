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
    res.json({ dryRun, results });
  } catch (err) { next(err); }
});

export default router;
