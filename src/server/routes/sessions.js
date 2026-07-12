/**
 * Volo Index — Session Routes (T2-A)
 *
 * CRUD + lifecycle endpoints for assessment sessions.
 * Wraps the AssessmentSession model (src/assessment/session.js) with
 * Postgres persistence.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { AppError } from '../middleware/error-handler.js';
import { AssessmentSession } from '../../assessment/session.js';
import { ChatInterviewController } from '../../assessment/chat-controller.js';
import { AnthropicLlmAdapter } from '../../assessment/anthropic-adapter.js';
import { registerController, unregisterController, getActiveSessions } from './chat.js';

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────

function sessionFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    consentGiven: row.consent_given,
    consentAt: row.consent_at?.toISOString?.() ?? row.consent_at,
    startedAt: row.started_at?.toISOString?.() ?? row.started_at,
    completedAt: row.completed_at?.toISOString?.() ?? row.completed_at,
    abandonedAt: row.abandoned_at?.toISOString?.() ?? row.abandoned_at,
    abandonReason: row.abandon_reason,
    dimensionProgress: row.dimension_progress,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}

async function loadTurns(sessionId) {
  const { rows } = await query(
    `SELECT turn_index, role, content, dimension
     FROM transcript_turns
     WHERE session_id = $1
     ORDER BY turn_index`,
    [sessionId],
  );
  return rows.map(r => ({
    role: r.role,
    content: r.content,
    ...(r.dimension ? { dimension: r.dimension } : {}),
  }));
}

// ── POST /api/sessions — create a new assessment session ───────────

router.post('/', async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) throw new AppError('userId is required', 400, 'MISSING_FIELD');

    // Verify user exists
    const userCheck = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rowCount === 0) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

    const id = randomUUID();
    const { rows } = await query(
      `INSERT INTO sessions (id, user_id, status, dimension_progress)
       VALUES ($1, $2, 'created', $3)
       RETURNING *`,
      [id, userId, JSON.stringify({})],
    );

    res.status(201).json({ session: sessionFromRow(rows[0]) });
  } catch (err) { next(err); }
});

// ── GET /api/sessions/:id — fetch session state ───────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');

    const session = sessionFromRow(rows[0]);
    const turns = await loadTurns(req.params.id);

    res.json({ session, turns, turnCount: turns.length });
  } catch (err) { next(err); }
});

// ── GET /api/sessions?userId=... — list sessions for a user ───────

router.get('/', async (req, res, next) => {
  try {
    const { userId } = req.query;
    if (!userId) throw new AppError('userId query param is required', 400, 'MISSING_FIELD');

    const { rows } = await query(
      `SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );

    res.json({ sessions: rows.map(sessionFromRow) });
  } catch (err) { next(err); }
});

// ── POST /api/sessions/:id/consent — record D4 consent ────────────

router.post('/:id/consent', async (req, res, next) => {
  try {
    const { granted } = req.body;
    if (typeof granted !== 'boolean') {
      throw new AppError('granted (boolean) is required', 400, 'MISSING_FIELD');
    }

    const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
    if (rows[0].status !== 'created') {
      throw new AppError('Consent can only be recorded in created state', 409, 'INVALID_STATE');
    }

    if (!granted) {
      // Decline consent → abandon session
      const { rows: updated } = await query(
        `UPDATE sessions SET status = 'abandoned', abandoned_at = NOW(), abandon_reason = 'consent_declined', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id],
      );
      return res.json({ session: sessionFromRow(updated[0]) });
    }

    const { rows: updated } = await query(
      `UPDATE sessions SET consent_given = TRUE, consent_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id],
    );

    res.json({ session: sessionFromRow(updated[0]) });
  } catch (err) { next(err); }
});

// ── POST /api/sessions/:id/start — transition to in_progress ──────

router.post('/:id/start', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');

    const row = rows[0];
    if (row.status !== 'created') {
      throw new AppError(`Cannot start session in state: ${row.status}`, 409, 'INVALID_STATE');
    }
    if (!row.consent_given) {
      throw new AppError('Cannot start session without consent (D4 policy)', 409, 'CONSENT_REQUIRED');
    }

    const { rows: updated } = await query(
      `UPDATE sessions SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id],
    );

    // ── Wire ChatInterviewController for this session ──────────────
    const sessionId = req.params.id;
    const adapterFactory = req.app.locals.llmAdapterFactory || (() => new AnthropicLlmAdapter());
    const adapter = adapterFactory();
    const ctrl = new ChatInterviewController({
      candidateId: row.user_id,
      llmAdapter: adapter,
      sessionId,
    });

    // Persist interviewer turns to DB and relay via SSE
    ctrl.on('question', async ({ question, dimension }) => {
      try {
        const { rows: turnRows } = await query(
          'SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM transcript_turns WHERE session_id = $1',
          [sessionId],
        );
        const turnIndex = turnRows[0].max_idx + 1;

        await query(
          `INSERT INTO transcript_turns (session_id, turn_index, role, content, dimension)
           VALUES ($1, $2, 'interviewer', $3, $4)`,
          [sessionId, turnIndex, question, dimension || null],
        );

        // Relay to SSE listeners
        const entry = getActiveSessions().get(sessionId);
        if (entry) {
          for (const send of entry.listeners) {
            send({ event: 'interviewerTurn', data: { turnIndex, content: question, dimension } });
          }
        }
      } catch (err) {
        console.error(`[sessions] failed to persist interviewer turn for ${sessionId}:`, err.message);
      }
    });

    // Handle terminal state transitions
    ctrl.on('stateChange', async ({ to }) => {
      try {
        if (to === 'completed') {
          await query(
            `UPDATE sessions SET status = 'completed', completed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [sessionId],
          );
          unregisterController(sessionId);
        } else if (to === 'abandoned' || to === 'cost_capped') {
          const reason = to === 'cost_capped' ? 'cost_cap_exceeded' : 'candidate_ended';
          await query(
            `UPDATE sessions SET status = 'abandoned', abandoned_at = NOW(), abandon_reason = $2, updated_at = NOW()
             WHERE id = $1`,
            [sessionId, reason],
          );
          unregisterController(sessionId);
        }
      } catch (err) {
        console.error(`[sessions] failed to update state for ${sessionId}:`, err.message);
      }
    });

    registerController(sessionId, ctrl);
    ctrl.begin();
    ctrl.grantConsent(); // consent already recorded in DB before /start

    res.json({ session: sessionFromRow(updated[0]) });
  } catch (err) { next(err); }
});

// ── POST /api/sessions/:id/complete — transition to completed ─────

router.post('/:id/complete', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');

    if (rows[0].status !== 'in_progress') {
      throw new AppError(`Cannot complete session in state: ${rows[0].status}`, 409, 'INVALID_STATE');
    }

    const { rows: updated } = await query(
      `UPDATE sessions SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id],
    );

    unregisterController(req.params.id);

    res.json({ session: sessionFromRow(updated[0]) });
  } catch (err) { next(err); }
});

// ── POST /api/sessions/:id/abandon — transition to abandoned ──────

router.post('/:id/abandon', async (req, res, next) => {
  try {
    const { reason } = req.body;

    const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');

    const status = rows[0].status;
    if (status !== 'created' && status !== 'in_progress') {
      throw new AppError(`Cannot abandon session in state: ${status}`, 409, 'INVALID_STATE');
    }

    const { rows: updated } = await query(
      `UPDATE sessions SET status = 'abandoned', abandoned_at = NOW(), abandon_reason = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, reason || null],
    );

    unregisterController(req.params.id);

    res.json({ session: sessionFromRow(updated[0]) });
  } catch (err) { next(err); }
});

export default router;
