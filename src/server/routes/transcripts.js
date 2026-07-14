/**
 * Volo Index — Transcript Routes (T2-A + T2-C auth)
 *
 * Endpoints for the D4 consent-gated transcript store.
 * All routes require authentication (applied at router mount level).
 * Session ownership is enforced.
 */

import { Router } from 'express';
import { query } from '../db.js';
import { AppError } from '../middleware/error-handler.js';

/**
 * @param {import('../stores/postgres-transcript-store.js').PostgresTranscriptStore} store
 */
export function createTranscriptRoutes(store) {
  const router = Router();

  async function verifySessionOwnership(sessionId, userId) {
    const { rows } = await query('SELECT user_id FROM sessions WHERE id = $1', [sessionId]);
    if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
    if (rows[0].user_id !== userId) throw new AppError('You do not own this session', 403, 'FORBIDDEN');
  }

  // ── POST /api/transcripts — store a transcript (D4 consent required) ──

  router.post('/', async (req, res, next) => {
    try {
      const { sessionId, candidateId, consentGiven, consentAt, transcript } = req.body;

      if (!sessionId) throw new AppError('sessionId is required', 400, 'MISSING_FIELD');
      if (!candidateId) throw new AppError('candidateId is required', 400, 'MISSING_FIELD');
      if (consentGiven !== true) {
        throw new AppError('consentGiven must be true (D4 policy)', 400, 'CONSENT_REQUIRED');
      }
      if (!transcript) throw new AppError('transcript is required', 400, 'MISSING_FIELD');

      await verifySessionOwnership(sessionId, req.user.id);
      await store.save({ sessionId, candidateId, consentGiven, consentAt, transcript });

      res.status(201).json({ stored: true, sessionId });
    } catch (err) { next(err); }
  });

  // ── GET /api/transcripts/:sessionId — load a transcript ──────────────

  router.get('/:sessionId', async (req, res, next) => {
    try {
      await verifySessionOwnership(req.params.sessionId, req.user.id);

      const record = await store.load(req.params.sessionId);
      if (!record) throw new AppError('Transcript not found', 404, 'TRANSCRIPT_NOT_FOUND');

      res.json({ transcript: record });
    } catch (err) { next(err); }
  });

  // ── GET /api/transcripts — list stored session IDs for the user ───────

  router.get('/', async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT t.session_id FROM transcripts t
         JOIN sessions s ON s.id = t.session_id
         WHERE s.user_id = $1
         ORDER BY t.saved_at`,
        [req.user.id],
      );
      const ids = rows.map(r => r.session_id);
      res.json({ sessionIds: ids, count: ids.length });
    } catch (err) { next(err); }
  });

  return router;
}
