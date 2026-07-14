/**
 * Volo Index — Credentials Routes (T2-D)
 *
 * Public endpoint for credential verification. No auth required.
 * Serves structured cert data for:
 *   - credential.html client-side rendering
 *   - LinkedIn OG card crawlers (via SSR in server/index.js)
 *   - Third-party verification integrations
 */

import { Router } from 'express';
import { query } from '../db.js';
import { AppError } from '../middleware/error-handler.js';
import { DIMENSIONS } from '../../scoring/config.js';

const router = Router();

// Dimension display names (D1–D6) — derived from the authoritative rubric
// config so credential pages can never drift from the scoring engine.
const DIMENSION_NAMES = Object.fromEntries(
  DIMENSIONS.map(d => [d.id, `${d.id}: ${d.name}`]),
);

// ── GET /api/credentials/:certId — fetch public cert data ──────────

router.get('/:certId', async (req, res, next) => {
  try {
    const { certId } = req.params;

    // Guard: certificates.id is a Postgres uuid — a malformed param throws
    // "invalid input syntax for type uuid" (22P02) and surfaced as a 500 on
    // staging. Treat malformed IDs exactly like unknown IDs.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(certId)) {
      throw new AppError('Certificate not found', 404, 'CERT_NOT_FOUND');
    }

    const { rows } = await query(
      `SELECT
         c.id,
         c.holder_name,
         c.overall_score,
         c.overall_tier,
         c.dimension_scores,
         c.rubric_version,
         c.issued_at,
         c.revoked_at,
         c.revocation_reason,
         pq.status AS publication_status
       FROM certificates c
       LEFT JOIN sessions s ON s.id = c.session_id
       LEFT JOIN publication_queue pq ON pq.session_id = c.session_id
       WHERE c.id = $1`,
      [certId],
    );

    if (rows.length === 0) throw new AppError('Certificate not found', 404, 'CERT_NOT_FOUND');

    const row = rows[0];
    res.json({ cert: formatPublicCert(row) });
  } catch (err) { next(err); }
});

function formatPublicCert(row) {
  const dimScores = row.dimension_scores ?? {};
  const dimensions = Object.entries(dimScores).map(([key, val]) => {
    const score = typeof val === 'object' ? val.score : val;
    const tier  = typeof val === 'object' ? val.tier  : undefined;
    const ie    = typeof val === 'object' ? val.insufficientEvidence : false;
    return {
      name:                DIMENSION_NAMES[key] ?? key,
      score:               ie || score == null ? null : parseFloat(score),
      tier:                ie || !tier ? undefined : tier,
      insufficientEvidence: !!ie,
    };
  });

  return {
    id:                row.id,
    holderName:        row.holder_name,
    tier:              row.overall_tier,
    overallScore:      parseFloat(row.overall_score),
    rubricVersion:     row.rubric_version,
    issuedAt:          row.issued_at?.toISOString?.() ?? row.issued_at,
    revoked:           row.revoked_at != null,
    revocationReason:  row.revocation_reason ?? undefined,
    publicationStatus: row.publication_status ?? 'published',
    dimensions,
  };
}

export default router;
