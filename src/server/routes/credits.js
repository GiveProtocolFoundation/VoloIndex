/**
 * Volo Index — Credits Routes (GIV-705)
 *
 * GET  /api/credits/me    (requireAuth)     → { balance }
 * POST /api/credits/grant (requireInternal) → { entry }
 */

import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireInternal } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';

const router = Router();

// ── GET /api/credits/me — current balance for authenticated user ────

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT COALESCE(SUM(delta), 0)::int AS balance FROM credits_ledger WHERE user_id = $1',
      [req.user.id],
    );
    res.json({ balance: rows[0].balance });
  } catch (err) { next(err); }
});

// ── POST /api/credits/grant — internal/ops manual grant ─────────────

router.post('/grant', requireInternal, async (req, res, next) => {
  try {
    const { userId, delta, reason } = req.body;

    if (!userId || typeof userId !== 'string') {
      throw new AppError('userId (string) is required', 400, 'MISSING_FIELD');
    }
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta <= 0) {
      throw new AppError('delta must be a positive integer', 400, 'INVALID_FIELD');
    }
    if (reason && reason !== 'grant') {
      throw new AppError('reason must be "grant" for this endpoint', 400, 'INVALID_FIELD');
    }

    const { rows } = await query(
      `INSERT INTO credits_ledger (user_id, delta, reason)
       VALUES ($1, $2, 'grant')
       RETURNING id, user_id, delta, reason, created_at`,
      [userId, delta],
    );

    res.status(201).json({ entry: rows[0] });
  } catch (err) { next(err); }
});

export default router;
