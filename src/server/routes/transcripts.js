/**
 * Volo Index — Transcript Routes (T2-A)
 *
 * Endpoints for the D4 consent-gated transcript store.
 * Wraps PostgresTranscriptStore.
 */

import { Router } from 'express';
import { AppError } from '../middleware/error-handler.js';

/**
 * @param {import('../stores/postgres-transcript-store.js').PostgresTranscriptStore} store
 */
export function createTranscriptRoutes(store) {
  const router = Router();

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

      await store.save({ sessionId, candidateId, consentGiven, consentAt, transcript });

      res.status(201).json({ stored: true, sessionId });
    } catch (err) { next(err); }
  });

  // ── GET /api/transcripts/:sessionId — load a transcript ──────────────

  router.get('/:sessionId', async (req, res, next) => {
    try {
      const record = await store.load(req.params.sessionId);
      if (!record) throw new AppError('Transcript not found', 404, 'TRANSCRIPT_NOT_FOUND');

      res.json({ transcript: record });
    } catch (err) { next(err); }
  });

  // ── GET /api/transcripts — list stored session IDs ───────────────────

  router.get('/', async (_req, res, next) => {
    try {
      const ids = await store.listIds();
      res.json({ sessionIds: ids, count: ids.length });
    } catch (err) { next(err); }
  });

  return router;
}
