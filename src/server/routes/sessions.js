/**
 * Volo Index — Session Routes (T2-A + T2-C auth)
 *
 * CRUD + lifecycle endpoints for assessment sessions.
 * All routes require authentication (applied at router mount level).
 * Session ownership is enforced: users can only access their own sessions.
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

/**
 * Load session and verify ownership. Returns the session row or throws.
 */
async function loadOwnedSession(sessionId, userId) {
  const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
  if (rows[0].user_id !== userId) throw new AppError('You do not own this session', 403, 'FORBIDDEN');
  return rows[0];
}

// ── POST /api/sessions — create a new assessment session ───────────
// userId derived from auth token (req.user.id).

router.post('/', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Entitlement check: concurrent session limit
    const { rows: activeRows } = await query(
      `SELECT COUNT(*)::int AS active_count FROM sessions
       WHERE user_id = $1 AND status IN ('created', 'in_progress')`,
      [userId],
    );
    const { rows: userRows } = await query(
      'SELECT entitlements FROM users WHERE id = $1',
      [userId],
    );
    const entitlements = userRows[0]?.entitlements || { maxConcurrentSessions: 1 };
    const maxConcurrent = entitlements.maxConcurrentSessions ?? 1;

    if (activeRows[0].active_count >= maxConcurrent) {
      throw new AppError(
        `Concurrent session limit reached (${maxConcurrent}). Complete or abandon an existing session first.`,
        429, 'CONCURRENT_LIMIT',
      );
    }

    // Entitlement check: daily assessment limit
    const dailyLimit = entitlements.dailyAssessmentLimit ?? 3;
    const { rows: usageRows } = await query(
      `SELECT session_count FROM daily_usage
       WHERE user_id = $1 AND usage_date = CURRENT_DATE`,
      [userId],
    );
    const todayCount = usageRows[0]?.session_count ?? 0;

    if (todayCount >= dailyLimit) {
      throw new AppError(
        `Daily assessment limit reached (${dailyLimit}). Try again tomorrow.`,
        429, 'DAILY_LIMIT',
      );
    }

    // Create session
    const id = randomUUID();
    const { rows } = await query(
      `INSERT INTO sessions (id, user_id, status, dimension_progress)
       VALUES ($1, $2, 'created', $3)
       RETURNING *`,
      [id, userId, JSON.stringify({})],
    );

    // Increment daily usage
    await query(
      `INSERT INTO daily_usage (user_id, usage_date, session_count)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, usage_date) DO UPDATE SET session_count = daily_usage.session_count + 1`,
      [userId],
    );

    res.status(201).json({ session: sessionFromRow(rows[0]) });
  } catch (err) { next(err); }
});

// ── GET /api/sessions/:id — fetch session state ───────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const row = await loadOwnedSession(req.params.id, req.user.id);
    const session = sessionFromRow(row);
    const turns = await loadTurns(req.params.id);

    res.json({ session, turns, turnCount: turns.length });
  } catch (err) { next(err); }
});

// ── GET /api/sessions — list sessions for the authenticated user ──

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id],
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

    const row = await loadOwnedSession(req.params.id, req.user.id);
    if (row.status !== 'created') {
      throw new AppError('Consent can only be recorded in created state', 409, 'INVALID_STATE');
    }

    if (!granted) {
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
    const row = await loadOwnedSession(req.params.id, req.user.id);
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

    // Surface controller errors — without this listener an LLM/adapter
    // failure is swallowed silently and the session just shows up as
    // abandoned (observed on staging: 401 from Anthropic, zero log lines).
    ctrl.on('error', ({ error }) => {
      console.error(`[sessions] interview controller error for ${sessionId}:`, error?.stack || error?.message || error);
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
          // Distinguish an internal error from the candidate walking away —
          // ctrl.error is set only when _runInterview caught an exception.
          const reason = to === 'cost_capped' ? 'cost_cap_exceeded'
            : ctrl.error ? 'error'
            : 'candidate_ended';
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
    const row = await loadOwnedSession(req.params.id, req.user.id);
    if (row.status !== 'in_progress') {
      throw new AppError(`Cannot complete session in state: ${row.status}`, 409, 'INVALID_STATE');
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
    const row = await loadOwnedSession(req.params.id, req.user.id);

    if (row.status !== 'created' && row.status !== 'in_progress') {
      throw new AppError(`Cannot abandon session in state: ${row.status}`, 409, 'INVALID_STATE');
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
