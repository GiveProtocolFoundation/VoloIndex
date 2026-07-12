/**
 * Volo Index — Results Routes (T2-A)
 *
 * Score storage and retrieval endpoints.
 * Wraps the scoring engine (src/scoring/) with Postgres persistence.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { AppError } from '../middleware/error-handler.js';
import { RUBRIC_VERSION } from '../../scoring/config.js';

const router = Router();

// ── POST /api/results — store a score result for a session ─────────

router.post('/', async (req, res, next) => {
  try {
    const { sessionId, signals, dimensionScores, overallScore, overallTier, details } = req.body;

    if (!sessionId) throw new AppError('sessionId is required', 400, 'MISSING_FIELD');
    if (!signals || !Array.isArray(signals)) throw new AppError('signals array is required', 400, 'MISSING_FIELD');
    if (!dimensionScores) throw new AppError('dimensionScores is required', 400, 'MISSING_FIELD');
    if (typeof overallScore !== 'number') throw new AppError('overallScore (number) is required', 400, 'MISSING_FIELD');
    if (!overallTier) throw new AppError('overallTier is required', 400, 'MISSING_FIELD');

    // Verify session exists and is completed
    const { rows: sessRows } = await query('SELECT status FROM sessions WHERE id = $1', [sessionId]);
    if (sessRows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
    if (sessRows[0].status !== 'completed') {
      throw new AppError('Score results can only be stored for completed sessions', 409, 'INVALID_STATE');
    }

    const id = randomUUID();
    const { rows } = await query(
      `INSERT INTO score_results (id, session_id, signals, dimension_scores, overall_score, overall_tier, details, rubric_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (session_id) DO UPDATE SET
         signals = EXCLUDED.signals,
         dimension_scores = EXCLUDED.dimension_scores,
         overall_score = EXCLUDED.overall_score,
         overall_tier = EXCLUDED.overall_tier,
         details = EXCLUDED.details,
         rubric_version = EXCLUDED.rubric_version
       RETURNING *`,
      [
        id,
        sessionId,
        JSON.stringify(signals),
        JSON.stringify(dimensionScores),
        overallScore,
        overallTier,
        details ? JSON.stringify(details) : null,
        RUBRIC_VERSION,
      ],
    );

    res.status(201).json({ result: formatResult(rows[0]) });
  } catch (err) { next(err); }
});

// ── GET /api/results/:sessionId — fetch score result ───────────────

router.get('/:sessionId', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM score_results WHERE session_id = $1',
      [req.params.sessionId],
    );
    if (rows.length === 0) throw new AppError('Score result not found', 404, 'RESULT_NOT_FOUND');

    res.json({ result: formatResult(rows[0]) });
  } catch (err) { next(err); }
});

function formatResult(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    signals: row.signals,
    dimensionScores: row.dimension_scores,
    overallScore: parseFloat(row.overall_score),
    overallTier: row.overall_tier,
    details: row.details,
    rubricVersion: row.rubric_version,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

export default router;
