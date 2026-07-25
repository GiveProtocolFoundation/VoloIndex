-- Volo Index — GIV-737 Retention & DSAR schema support
-- Migration 006: last_active_at/erased_at on users, financial carve-out on credits_ledger
--
-- Source: CTO design doc §1 (giv-737-retention-dsar-design), grounded in
-- RoPA volo-data-protection A.6 retention schedule.
--
-- Depends on: 001-initial-schema, 002-auth-tables, 003-credits
-- Applied by: src/server/migrate.js

BEGIN;

-- ── Inactivity clock + erasure tombstone on users ──────────────────────

ALTER TABLE users
  ADD COLUMN last_active_at TIMESTAMPTZ,
  ADD COLUMN erased_at      TIMESTAMPTZ;

-- Backfill so the inactivity clock never starts at NULL:
UPDATE users u SET last_active_at = GREATEST(
  u.updated_at,
  COALESCE(
    (SELECT MAX(a.created_at) FROM auth_sessions a WHERE a.user_id = u.id),
    u.updated_at
  )
);

-- ── Financial carve-out (Art. 6(1)(c)) ─────────────────────────────────
-- The ledger must survive account erasure for 7 years. Migration 003
-- created user_id with ON DELETE CASCADE — that would destroy the record
-- on hard-delete. Relax to SET NULL and keep an immutable pseudonymous
-- subject key so refund/audit reconciliation still works after erasure.

ALTER TABLE credits_ledger
  ADD COLUMN subject_key TEXT;

ALTER TABLE credits_ledger
  DROP CONSTRAINT credits_ledger_user_id_fkey;

ALTER TABLE credits_ledger
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE credits_ledger
  ADD CONSTRAINT credits_ledger_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- ── Schema version ─────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, name)
VALUES (6, '006-retention-dsar');

COMMIT;
