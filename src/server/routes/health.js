/**
 * Volo Index — Health Check Routes (T2-A)
 */

import { Router } from 'express';
import { pool } from '../db.js';
import { RUBRIC_VERSION, ASSESSMENT_ENGINE_ENABLED } from '../../scoring/config.js';

const router = Router();

router.get('/health', async (_req, res) => {
  let dbOk = false;
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch { /* db unavailable */ }

  const status = dbOk ? 'healthy' : 'degraded';
  const code = dbOk ? 200 : 503;

  res.status(code).json({
    status,
    rubricVersion: RUBRIC_VERSION,
    assessmentEngineEnabled: ASSESSMENT_ENGINE_ENABLED,
    db: dbOk ? 'connected' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
});

export default router;
