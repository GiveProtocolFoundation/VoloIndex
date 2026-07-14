/**
 * Volo Index — Results Routes (T2-A + T2-C auth)
 *
 * Score storage and retrieval endpoints.
 * All routes require authentication (applied at router mount level).
 * Session ownership is enforced.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { AppError } from '../middleware/error-handler.js';
import { RUBRIC_VERSION } from '../../scoring/config.js';

const router = Router();

/**
 * Verify authenticated user owns the session.
 */
async function verifySessionOwnership(sessionId, userId) {
  const { rows } = await query('SELECT user_id, status FROM sessions WHERE id = $1', [sessionId]);
  if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
  if (rows[0].user_id !== userId) throw new AppError('You do not own this session', 403, 'FORBIDDEN');
  return rows[0];
}

// ── POST /api/results — store a score result for a session ─────────

router.post('/', async (req, res, next) => {
  try {
    const { sessionId, signals, dimensionScores, overallScore, overallTier, details } = req.body;

    if (!sessionId) throw new AppError('sessionId is required', 400, 'MISSING_FIELD');
    if (!signals || !Array.isArray(signals)) throw new AppError('signals array is required', 400, 'MISSING_FIELD');
    if (!dimensionScores) throw new AppError('dimensionScores is required', 400, 'MISSING_FIELD');
    if (typeof overallScore !== 'number') throw new AppError('overallScore (number) is required', 400, 'MISSING_FIELD');
    if (!overallTier) throw new AppError('overallTier is required', 400, 'MISSING_FIELD');

    // Verify session ownership and state
    const session = await verifySessionOwnership(sessionId, req.user.id);
    if (session.status !== 'completed') {
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
// T2-D: includes cert and publication data when available.

router.get('/:sessionId', async (req, res, next) => {
  try {
    await verifySessionOwnership(req.params.sessionId, req.user.id);

    const { rows } = await query(
      `SELECT sr.*,
              c.id          AS cert_id,
              c.overall_tier AS cert_tier,
              c.issued_at   AS cert_issued_at,
              pq.status     AS publication_status
       FROM score_results sr
       LEFT JOIN certificates c     ON c.session_id = sr.session_id
       LEFT JOIN publication_queue pq ON pq.session_id = sr.session_id
       WHERE sr.session_id = $1`,
      [req.params.sessionId],
    );
    if (rows.length === 0) throw new AppError('Score result not found', 404, 'RESULT_NOT_FOUND');

    res.json({ result: formatResult(rows[0]) });
  } catch (err) { next(err); }
});

function formatResult(row) {
  const baseUrl = process.env.AUTH_BASE_URL || 'https://voloindex.org';
  const certId  = row.cert_id ?? null;
  return {
    id:                row.id,
    sessionId:         row.session_id,
    signals:           row.signals,
    dimensionScores:   row.dimension_scores,
    overallScore:      parseFloat(row.overall_score),
    overallTier:       row.overall_tier,
    details:           row.details,
    rubricVersion:     row.rubric_version,
    createdAt:         row.created_at?.toISOString?.() ?? row.created_at,
    // T2-D: certification fields (null until cert is issued)
    certId,
    certUrl:           certId ? `${baseUrl}/credential/${certId}` : null,
    certTier:          row.cert_tier ?? null,
    certIssuedAt:      row.cert_issued_at?.toISOString?.() ?? row.cert_issued_at ?? null,
    publicationStatus: row.publication_status ?? null,
  };
}

export default router;
