-- Volo Index — GIV-736 Consent & rights controls
-- Migration 004: publication opt-in, 16+ age attestation, transcript redaction
--
-- Legal basis: RoPA `volo-data-protection` v1.0 (GIV-710) A.3/A.4/A.7 and
-- CEO controller decisions D2/D3/D5 (GIV-733).
--
-- Depends on: 001-initial-schema, 002-auth-tables
-- Applied by: src/server/migrate.js

BEGIN;

-- ── Publication opt-in (P5, Art. 6(1)(a) explicit consent) ─────────────
-- Distinct from sessions.consent_given (D4 transcript-storage consent).
-- Default = private: both columns NULL means the certificate is NOT
-- publicly resolvable. Opt-in sets publication_consent_at; revocation of
-- the opt-in sets publication_consent_revoked_at (original timestamp kept
-- for the Art. 7(1) consent audit trail; re-opt-in clears it).

ALTER TABLE certificates
  ADD COLUMN publication_consent_at         TIMESTAMPTZ,
  ADD COLUMN publication_consent_revoked_at TIMESTAMPTZ;

-- ── 16+ age self-attestation (D5, mirrors give-protocol GIV-530) ──────

ALTER TABLE users
  ADD COLUMN age_attested_at TIMESTAMPTZ;

-- ── Transcript redaction (D3, Art. 9 notice+redact posture) ───────────
-- Marks candidate turns whose content was replaced at the user's request.

ALTER TABLE transcript_turns
  ADD COLUMN redacted_at TIMESTAMPTZ;

-- ── Schema version ─────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, name)
VALUES (4, '004-consent-controls');

COMMIT;
