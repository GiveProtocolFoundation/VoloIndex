/**
 * Volo Index — Account / DSAR Routes (GIV-737 / GIV-753)
 *
 * Per CTO design doc §4:
 *   DELETE /api/account        — self-serve erasure (JWT)
 *   GET    /api/account/export — Art. 15/20 data portability (JWT)
 *   PATCH  /api/account        — rectification (display_name only, JWT)
 *   POST   /api/internal/dsar/erase — operator DSAR execution (x-internal-key)
 */

import { Router } from 'express';
import { pool, query } from '../db.js';
import { eraseUser, findUserIdByEmail } from '../dsar.js';

const router = Router();

/**
 * DELETE /api/account — self-serve account erasure.
 * Requires body {confirm: true} to prevent accidental deletion.
 */
router.delete('/', async (req, res, next) => {
  try {
    if (req.body.confirm !== true) {
      return res.status(400).json({
        error: { code: 'CONFIRM_REQUIRED', message: 'Send {confirm: true} to confirm account deletion' },
      });
    }

    const result = await eraseUser(pool, req.user.id);

    // Revoke the calling auth session (the JWT is short-lived; this kills the refresh token)
    await query(
      'UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [req.user.id],
    );

    res.status(200).json({ erased: result.erased });
  } catch (err) { next(err); }
});

/**
 * GET /api/account/export — Art. 15 access + Art. 20 portability.
 * Returns a JSON bundle of all user data with Content-Disposition attachment.
 */
router.get('/export', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [
      userResult,
      sessionsResult,
      turnsResult,
      transcriptsResult,
      scoresResult,
      certsResult,
      ledgerResult,
    ] = await Promise.all([
      query('SELECT id, email, display_name, email_verified, email_verified_at, age_attested_at, entitlements, created_at, updated_at, last_active_at FROM users WHERE id = $1', [userId]),
      query('SELECT id, status, consent_given, consent_at, started_at, completed_at, abandoned_at, abandon_reason, dimension_progress, created_at, updated_at FROM sessions WHERE user_id = $1 ORDER BY created_at', [userId]),
      query('SELECT tt.session_id, tt.turn_index, tt.role, tt.content, tt.dimension, tt.redacted_at, tt.created_at FROM transcript_turns tt JOIN sessions s ON s.id = tt.session_id WHERE s.user_id = $1 ORDER BY tt.session_id, tt.turn_index', [userId]),
      query('SELECT t.session_id, t.candidate_id, t.consent_given, t.consent_at, t.transcript, t.saved_at FROM transcripts t JOIN sessions s ON s.id = t.session_id WHERE s.user_id = $1', [userId]),
      query('SELECT sr.id, sr.session_id, sr.signals, sr.dimension_scores, sr.overall_score, sr.overall_tier, sr.details, sr.rubric_version, sr.created_at FROM score_results sr JOIN sessions s ON s.id = sr.session_id WHERE s.user_id = $1', [userId]),
      query('SELECT id, session_id, holder_name, overall_score, overall_tier, dimension_scores, rubric_version, issued_at, revoked_at, publication_consent_at, publication_consent_revoked_at FROM certificates WHERE user_id = $1', [userId]),
      query('SELECT id, delta, reason, session_id, provider_ref, created_at FROM credits_ledger WHERE user_id = $1 ORDER BY created_at', [userId]),
    ]);

    const bundle = {
      exported_at: new Date().toISOString(),
      user: userResult.rows[0] || null,
      sessions: sessionsResult.rows,
      transcript_turns: turnsResult.rows,
      transcripts: transcriptsResult.rows,
      score_results: scoresResult.rows,
      certificates: certsResult.rows,
      credits_ledger: ledgerResult.rows,
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="voloindex-data-export.json"');
    res.status(200).json(bundle);
  } catch (err) { next(err); }
});

/**
 * PATCH /api/account — rectification (display_name only).
 * Email change stays a manual DSAR via privacy@.
 */
router.patch('/', async (req, res, next) => {
  try {
    const { display_name } = req.body;

    if (display_name === undefined) {
      return res.status(400).json({
        error: { code: 'NO_CHANGES', message: 'Provide display_name to update' },
      });
    }

    if (display_name !== null && typeof display_name !== 'string') {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'display_name must be a string or null' },
      });
    }

    await query(
      'UPDATE users SET display_name = $2, updated_at = NOW() WHERE id = $1',
      [req.user.id, display_name],
    );

    res.status(200).json({ updated: true });
  } catch (err) { next(err); }
});

export default router;

// ── Internal DSAR router (separate, guarded by requireInternal) ─────

export const internalDsarRouter = Router();

/**
 * POST /api/internal/dsar/erase — operator DSAR execution.
 * Body: {email} or {userId}, plus optional {actor, reason} for audit log.
 */
internalDsarRouter.post('/erase', async (req, res, next) => {
  try {
    const { email, userId: bodyUserId, actor, reason } = req.body;

    if (!email && !bodyUserId) {
      return res.status(400).json({
        error: { code: 'MISSING_IDENTIFIER', message: 'Provide email or userId' },
      });
    }

    let targetUserId = bodyUserId;
    if (!targetUserId && email) {
      targetUserId = await findUserIdByEmail(pool, email);
      if (!targetUserId) {
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'No user found with that email' },
        });
      }
    }

    console.log(`[dsar] erasure requested — userId=${targetUserId} actor=${actor || 'operator'} reason=${reason || 'DSAR'}`);

    const result = await eraseUser(pool, targetUserId);

    console.log(`[dsar] erasure complete — userId=${targetUserId} alreadyErased=${result.alreadyErased}`);

    res.status(200).json({ erased: result.erased, alreadyErased: result.alreadyErased });
  } catch (err) { next(err); }
});
