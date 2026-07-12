/**
 * Volo Index — Publication Queue Routes (T2-A)
 *
 * D5 publication pipeline: first-50 QA hold, auto-publish latch.
 * Persistence layer around the PublicationQueue model.
 */

import { Router } from 'express';
import { query } from '../db.js';
import { AppError } from '../middleware/error-handler.js';

const router = Router();

// ── POST /api/publication/enqueue — add a scored session to the queue ─

router.post('/enqueue', async (req, res, next) => {
  try {
    const { sessionId, candidateId, scoreResultId } = req.body;
    if (!sessionId) throw new AppError('sessionId is required', 400, 'MISSING_FIELD');
    if (!candidateId) throw new AppError('candidateId is required', 400, 'MISSING_FIELD');

    const { rows } = await query(
      `INSERT INTO publication_queue (session_id, candidate_id, score_result_id, status, enqueued_at)
       VALUES ($1, $2, $3, 'pending_review', NOW())
       ON CONFLICT (session_id) DO NOTHING
       RETURNING *`,
      [sessionId, candidateId, scoreResultId || null],
    );

    if (rows.length === 0) {
      // Already enqueued
      const { rows: existing } = await query(
        'SELECT * FROM publication_queue WHERE session_id = $1', [sessionId],
      );
      return res.json({ entry: formatEntry(existing[0]), alreadyEnqueued: true });
    }

    res.status(201).json({ entry: formatEntry(rows[0]) });
  } catch (err) { next(err); }
});

// ── POST /api/publication/:sessionId/release — QA releases an entry ──

router.post('/:sessionId/release', async (req, res, next) => {
  try {
    const { agreedWithExtractor } = req.body;
    if (typeof agreedWithExtractor !== 'boolean') {
      throw new AppError('agreedWithExtractor (boolean) is required', 400, 'MISSING_FIELD');
    }

    const { rows } = await query(
      `UPDATE publication_queue
       SET status = 'published', released_at = NOW(), agreed_with_extractor = $2
       WHERE session_id = $1 AND status = 'pending_review'
       RETURNING *`,
      [req.params.sessionId, agreedWithExtractor],
    );

    if (rows.length === 0) {
      throw new AppError('Entry not found or already published', 404, 'ENTRY_NOT_FOUND');
    }

    res.json({ entry: formatEntry(rows[0]) });
  } catch (err) { next(err); }
});

// ── GET /api/publication/pending — list pending entries for QA review ─

router.get('/pending', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        pq.session_id,
        pq.candidate_id,
        pq.status,
        pq.score_result_id,
        pq.enqueued_at,
        sr.signals,
        sr.dimension_scores,
        sr.overall_score,
        sr.overall_tier,
        sr.rubric_version,
        t.transcript
      FROM publication_queue pq
      LEFT JOIN score_results sr ON sr.session_id = pq.session_id
      LEFT JOIN transcripts t ON t.session_id = pq.session_id
      WHERE pq.status = 'pending_review'
      ORDER BY pq.enqueued_at ASC
    `);

    res.json({
      entries: rows.map(row => ({
        sessionId: row.session_id,
        candidateId: row.candidate_id,
        status: row.status,
        scoreResultId: row.score_result_id,
        enqueuedAt: row.enqueued_at?.toISOString?.() ?? row.enqueued_at,
        signals: row.signals,
        dimensionScores: row.dimension_scores,
        overallScore: row.overall_score != null ? parseFloat(row.overall_score) : null,
        overallTier: row.overall_tier,
        rubricVersion: row.rubric_version,
        transcript: row.transcript,
      })),
      count: rows.length,
    });
  } catch (err) { next(err); }
});

// ── GET /api/publication/:sessionId — check publication status ────────

router.get('/:sessionId', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM publication_queue WHERE session_id = $1',
      [req.params.sessionId],
    );
    if (rows.length === 0) throw new AppError('Entry not found', 404, 'ENTRY_NOT_FOUND');

    res.json({ entry: formatEntry(rows[0]) });
  } catch (err) { next(err); }
});

// ── GET /api/publication/stats — queue stats (for QA dashboard) ──────

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending_review') AS pending_count,
        COUNT(*) FILTER (WHERE status = 'published') AS published_count,
        COUNT(*) FILTER (WHERE agreed_with_extractor = TRUE) AS agreed_count,
        COUNT(*) FILTER (WHERE agreed_with_extractor IS NOT NULL) AS reviewed_count
      FROM publication_queue
    `);

    const stats = rows[0];
    const reviewedCount = parseInt(stats.reviewed_count);
    const agreedCount = parseInt(stats.agreed_count);

    res.json({
      pendingCount: parseInt(stats.pending_count),
      publishedCount: parseInt(stats.published_count),
      reviewedCount,
      agreedCount,
      agreementRate: reviewedCount > 0 ? agreedCount / reviewedCount : 0,
      autoPublishEnabled: reviewedCount >= 50 && (agreedCount / reviewedCount) >= 0.95,
    });
  } catch (err) { next(err); }
});

function formatEntry(row) {
  return {
    sessionId: row.session_id,
    candidateId: row.candidate_id,
    status: row.status,
    scoreResultId: row.score_result_id,
    enqueuedAt: row.enqueued_at?.toISOString?.() ?? row.enqueued_at,
    releasedAt: row.released_at?.toISOString?.() ?? row.released_at,
    agreedWithExtractor: row.agreed_with_extractor,
  };
}

export default router;
