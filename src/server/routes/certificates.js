/**
 * Volo Index — Certificate Routes (T2-D + GIV-736 publication opt-in)
 *
 * Certificate issuance (on publication-queue release), listing, and revocation.
 * POST /api/certificates       — issue a certificate for a published session (auth)
 * GET  /api/certificates       — list the authenticated user's certificates (auth)
 * POST /api/certificates/:id/publish   — explicit publication opt-in (auth, owner)
 * POST /api/certificates/:id/unpublish — revoke publication opt-in (auth, owner)
 * POST /api/certificates/:id/revoke — revoke a certificate (internal API key only)
 */

import { Router } from 'express';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { query } from '../db.js';
import { AppError } from '../middleware/error-handler.js';
import { config } from '../config.js';

const router = Router();

// ── POST /api/certificates — issue a certificate ──────────────────
//
// Called after a score result enters published state (D5 publication queue).
// Idempotent: if a cert already exists for the session, returns it.
//
// Body: { sessionId, holderName }
//   holderName — display name to appear on the certificate.
//                Defaults to the user's email address if omitted.

router.post('/', async (req, res, next) => {
  try {
    const { sessionId, holderName } = req.body;
    if (!sessionId) throw new AppError('sessionId is required', 400, 'MISSING_FIELD');

    // Verify session ownership
    const { rows: sessionRows } = await query(
      'SELECT user_id, status FROM sessions WHERE id = $1',
      [sessionId],
    );
    if (sessionRows.length === 0) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
    if (sessionRows[0].user_id !== req.user.id) {
      throw new AppError('You do not own this session', 403, 'FORBIDDEN');
    }
    if (sessionRows[0].status !== 'completed') {
      throw new AppError('Certificates can only be issued for completed sessions', 409, 'INVALID_STATE');
    }

    // Verify score result exists
    const { rows: scoreRows } = await query(
      'SELECT overall_score, overall_tier, dimension_scores, rubric_version FROM score_results WHERE session_id = $1',
      [sessionId],
    );
    if (scoreRows.length === 0) {
      throw new AppError('No score result found for this session — score must be stored first', 409, 'NO_SCORE');
    }

    // Verify publication status — only published scores yield a certificate
    const { rows: pubRows } = await query(
      'SELECT status FROM publication_queue WHERE session_id = $1',
      [sessionId],
    );
    const pubStatus = pubRows[0]?.status;
    if (pubStatus !== 'published') {
      throw new AppError(
        pubStatus === 'pending_review'
          ? 'This result is pending QA review. Certificate will be issued once released.'
          : 'This session has not been published. Submit to publication queue first.',
        409,
        'NOT_PUBLISHED',
      );
    }

    // Idempotent: return existing cert if already issued
    const { rows: existing } = await query(
      'SELECT * FROM certificates WHERE session_id = $1',
      [sessionId],
    );
    if (existing.length > 0) {
      return res.status(200).json({ cert: formatCert(existing[0]), created: false });
    }

    // Resolve holder name — prefer supplied name, fall back to user email
    let resolvedName = holderName?.trim() || null;
    if (!resolvedName) {
      const { rows: userRows } = await query(
        'SELECT email, display_name FROM users WHERE id = $1',
        [req.user.id],
      );
      resolvedName = userRows[0]?.display_name || userRows[0]?.email || 'Unknown';
    }

    const score = scoreRows[0];
    const certId = randomUUID();

    const { rows } = await query(
      `INSERT INTO certificates
         (id, session_id, user_id, holder_name, overall_score, overall_tier, dimension_scores, rubric_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (session_id) DO NOTHING
       RETURNING *`,
      [
        certId,
        sessionId,
        req.user.id,
        resolvedName,
        score.overall_score,
        score.overall_tier,
        JSON.stringify(score.dimension_scores),
        score.rubric_version,
      ],
    );

    // Concurrent-issue race: another request inserted first — return theirs.
    if (rows.length === 0) {
      const { rows: race } = await query(
        'SELECT * FROM certificates WHERE session_id = $1',
        [sessionId],
      );
      return res.status(200).json({ cert: formatCert(race[0]), created: false });
    }

    res.status(201).json({ cert: formatCert(rows[0]), created: true });
  } catch (err) { next(err); }
});

// ── GET /api/certificates — list user's certificates ─────────────

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.* FROM certificates c
       WHERE c.user_id = $1
       ORDER BY c.issued_at DESC`,
      [req.user.id],
    );
    res.json({ certificates: rows.map(formatCert) });
  } catch (err) { next(err); }
});

// ── GET /api/certificates/:certId — fetch one cert (auth) ─────────

router.get('/:certId', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM certificates WHERE id = $1 AND user_id = $2',
      [req.params.certId, req.user.id],
    );
    if (rows.length === 0) throw new AppError('Certificate not found', 404, 'CERT_NOT_FOUND');
    res.json({ cert: formatCert(rows[0]) });
  } catch (err) { next(err); }
});

// ── POST /api/certificates/:certId/publish — publication opt-in ───
//
// GIV-736 (P5): public exposure of a certificate requires a separate,
// explicit, revocable opt-in — distinct from sessions.consent_given.
// Default is private. Body must carry { consent: true } so the grant is
// an affirmative act, never a side effect of another call.

router.post('/:certId/publish', async (req, res, next) => {
  try {
    if (req.body?.consent !== true) {
      throw new AppError(
        'Explicit consent is required: send { "consent": true } to publish this certificate',
        400,
        'CONSENT_REQUIRED',
      );
    }

    const cert = await loadOwnedCert(req.params.certId, req.user.id);
    if (cert.revoked_at) {
      throw new AppError('Certificate has been revoked and cannot be published', 409, 'CERT_REVOKED');
    }

    // Re-opt-in after a revoked opt-in starts a fresh consent record.
    const { rows } = await query(
      `UPDATE certificates
       SET publication_consent_at = NOW(), publication_consent_revoked_at = NULL
       WHERE id = $1
       RETURNING *`,
      [cert.id],
    );

    res.json({ cert: formatCert(rows[0]) });
  } catch (err) { next(err); }
});

// ── POST /api/certificates/:certId/unpublish — revoke opt-in ──────
//
// Removes the credential from the public API (GET /api/credentials/:id
// and the /credential/:id OG page return 404 afterwards). The original
// opt-in timestamp is kept for the Art. 7 consent audit trail.

router.post('/:certId/unpublish', async (req, res, next) => {
  try {
    const cert = await loadOwnedCert(req.params.certId, req.user.id);

    const { rows } = await query(
      `UPDATE certificates
       SET publication_consent_revoked_at = COALESCE(publication_consent_revoked_at, NOW())
       WHERE id = $1
       RETURNING *`,
      [cert.id],
    );

    res.json({ cert: formatCert(rows[0]) });
  } catch (err) { next(err); }
});

// ── POST /api/certificates/:certId/revoke — revoke (internal) ─────
//
// Requires X-Internal-Key header matching config.auth.internalKey.
// Used by ops/admin tooling; not exposed to end-users.

router.post('/:certId/revoke', async (req, res, next) => {
  try {
    // Internal key check (timing-safe). Compare SHA-256 digests so buffers
    // are always equal-length — timingSafeEqual THROWS on length mismatch,
    // which would turn a bad key into a 500 instead of a 403.
    const supplied = req.headers['x-internal-key'];
    const expected = config.auth.internalKey;
    const digest = (v) => createHash('sha256').update(String(v)).digest();
    if (!supplied || !expected || !timingSafeEqual(digest(supplied), digest(expected))) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    const { reason } = req.body;

    const { rows } = await query(
      `UPDATE certificates
       SET revoked_at = NOW(), revocation_reason = $2
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING *`,
      [req.params.certId, reason || null],
    );

    if (rows.length === 0) {
      // Might already be revoked or not found
      const { rows: check } = await query('SELECT id FROM certificates WHERE id = $1', [req.params.certId]);
      if (check.length === 0) throw new AppError('Certificate not found', 404, 'CERT_NOT_FOUND');
      throw new AppError('Certificate is already revoked', 409, 'ALREADY_REVOKED');
    }

    res.json({ cert: formatCert(rows[0]), revoked: true });
  } catch (err) { next(err); }
});

// ── Helpers ────────────────────────────────────────────────────────

async function loadOwnedCert(certId, userId) {
  const { rows } = await query(
    'SELECT * FROM certificates WHERE id = $1 AND user_id = $2',
    [certId, userId],
  );
  if (rows.length === 0) throw new AppError('Certificate not found', 404, 'CERT_NOT_FOUND');
  return rows[0];
}

/** GIV-736: a cert is publicly resolvable only with an active opt-in and no revocation. */
export function isPubliclyVisible(row) {
  return row.revoked_at == null
    && row.publication_consent_at != null
    && row.publication_consent_revoked_at == null;
}

function formatCert(row) {
  const baseUrl = config.auth.baseUrl || 'https://voloindex.org';
  return {
    id:               row.id,
    sessionId:        row.session_id,
    userId:           row.user_id,
    holderName:       row.holder_name,
    overallScore:     parseFloat(row.overall_score),
    overallTier:      row.overall_tier,
    tier:             row.overall_tier, // alias used by credential.html
    dimensionScores:  row.dimension_scores,
    rubricVersion:    row.rubric_version,
    issuedAt:         row.issued_at?.toISOString?.() ?? row.issued_at,
    certUrl:          `${baseUrl}/credential/${row.id}`,
    revoked:          row.revoked_at != null,
    revokedAt:        row.revoked_at?.toISOString?.() ?? null,
    revocationReason: row.revocation_reason ?? null,
    // GIV-736 publication opt-in state (owner-facing)
    isPublic:                    isPubliclyVisible(row),
    publicationConsentAt:        row.publication_consent_at?.toISOString?.() ?? row.publication_consent_at ?? null,
    publicationConsentRevokedAt: row.publication_consent_revoked_at?.toISOString?.() ?? row.publication_consent_revoked_at ?? null,
  };
}

export default router;
