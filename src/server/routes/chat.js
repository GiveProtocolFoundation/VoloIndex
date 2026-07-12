/**
 * Volo Index — Chat Routes (T2-A + T2-C auth)
 *
 * Handles candidate responses during an active interview session.
 * Persists each turn to Postgres and relays to/from the ChatInterviewController.
 *
 * POST /api/sessions/:id/respond         — submit candidate text (requires auth + ownership)
 * POST /api/sessions/:id/interviewer-turn — persist LLM response (server-internal only)
 * GET  /api/sessions/:id/stream          — SSE stream (requires auth + ownership)
 */

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError } from '../middleware/error-handler.js';
import { chatLimiter } from '../middleware/rate-limit.js';
import { requireInternal } from '../middleware/auth.js';

const router = Router();

// ── In-flight session controllers (per-process; T2-G will add clustering) ──
// Maps sessionId → { controller, listeners }
const activeSessions = new Map();

/**
 * Register a ChatInterviewController for a session.
 * Called by the session /start endpoint when it initialises the controller.
 */
export function registerController(sessionId, controller) {
  activeSessions.set(sessionId, { controller, listeners: new Set() });
}

export function unregisterController(sessionId) {
  const entry = activeSessions.get(sessionId);
  if (entry) {
    for (const send of entry.listeners) {
      send({ event: 'end', data: {} });
    }
    activeSessions.delete(sessionId);
  }
}

/**
 * Expose the activeSessions map for session routes to relay events.
 * @returns {Map}
 */
export function getActiveSessions() {
  return activeSessions;
}

// ── POST /api/sessions/:id/respond ────────────────────────────────
// Requires auth (applied at router mount level in index.js).

router.post('/:id/respond', chatLimiter, async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      throw new AppError('text is required', 400, 'MISSING_FIELD');
    }
    if (text.length > 10_000) {
      throw new AppError('Response too long (max 10 000 chars)', 400, 'INPUT_TOO_LONG');
    }

    // Check session exists, is in_progress, and belongs to the authenticated user
    const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
    if (rows[0].user_id !== req.user.id) throw new AppError('You do not own this session', 403, 'FORBIDDEN');
    if (rows[0].status !== 'in_progress') {
      throw new AppError(`Session is ${rows[0].status}, not in_progress`, 409, 'INVALID_STATE');
    }

    // Get current turn count to set turn_index
    const { rows: turnRows } = await query(
      'SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM transcript_turns WHERE session_id = $1',
      [req.params.id],
    );
    const candidateTurnIndex = turnRows[0].max_idx + 1;

    // Persist candidate turn
    await query(
      `INSERT INTO transcript_turns (session_id, turn_index, role, content)
       VALUES ($1, $2, 'candidate', $3)`,
      [req.params.id, candidateTurnIndex, text],
    );

    // Update dimension progress turn count
    await query(
      `UPDATE sessions SET updated_at = NOW() WHERE id = $1`,
      [req.params.id],
    );

    // Notify SSE listeners
    const entry = activeSessions.get(req.params.id);
    if (entry) {
      for (const send of entry.listeners) {
        send({ event: 'candidateTurn', data: { turnIndex: candidateTurnIndex, text } });
      }
    }

    res.json({
      turnIndex: candidateTurnIndex,
      role: 'candidate',
      status: 'accepted',
    });
  } catch (err) { next(err); }
});

// ── POST /api/sessions/:id/interviewer-turn — persist LLM response ─
// T2-C: Server-internal only — requires X-Internal-Key header.
// This prevents external clients from forging interviewer turns.

router.post('/:id/interviewer-turn', requireInternal, async (req, res, next) => {
  try {
    const { content, dimension } = req.body;
    if (!content || typeof content !== 'string') {
      throw new AppError('content is required', 400, 'MISSING_FIELD');
    }

    const { rows } = await query('SELECT status FROM sessions WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
    if (rows[0].status !== 'in_progress') {
      throw new AppError(`Session is ${rows[0].status}`, 409, 'INVALID_STATE');
    }

    const { rows: turnRows } = await query(
      'SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM transcript_turns WHERE session_id = $1',
      [req.params.id],
    );
    const turnIndex = turnRows[0].max_idx + 1;

    await query(
      `INSERT INTO transcript_turns (session_id, turn_index, role, content, dimension)
       VALUES ($1, $2, 'interviewer', $3, $4)`,
      [req.params.id, turnIndex, content, dimension || null],
    );

    // Notify SSE listeners
    const entry = activeSessions.get(req.params.id);
    if (entry) {
      for (const send of entry.listeners) {
        send({ event: 'interviewerTurn', data: { turnIndex, content, dimension } });
      }
    }

    res.json({ turnIndex, role: 'interviewer' });
  } catch (err) { next(err); }
});

// ── GET /api/sessions/:id/stream — SSE event stream ───────────────
// Requires auth (applied at router mount level).

router.get('/:id/stream', async (req, res, next) => {
  try {
    // Verify session exists and belongs to the authenticated user
    const { rows } = await query('SELECT status, user_id FROM sessions WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
    if (rows[0].user_id !== req.user.id) throw new AppError('You do not own this session', 403, 'FORBIDDEN');

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ sessionId: req.params.id, status: rows[0].status })}\n\n`);

    // Register listener
    const send = ({ event, data }) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch { /* client disconnected */ }
    };

    let entry = activeSessions.get(req.params.id);
    if (!entry) {
      entry = { controller: null, listeners: new Set() };
      activeSessions.set(req.params.id, entry);
    }
    entry.listeners.add(send);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 15_000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      entry.listeners.delete(send);
      if (entry.listeners.size === 0 && !entry.controller) {
        activeSessions.delete(req.params.id);
      }
    });
  } catch (err) { next(err); }
});

export default router;
