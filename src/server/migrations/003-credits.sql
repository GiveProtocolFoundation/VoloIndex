-- Volo Index — Credits Ledger
-- Migration 003: append-only credits ledger for session-start gating
--
-- Depends on: 001-initial-schema (users, sessions tables)
-- Applied by: src/server/migrate.js

BEGIN;

-- ── Credits ledger (append-only) ────────────────────────────────────────
-- Balance = SUM(delta) WHERE user_id = $1.
-- Each row is immutable once written; corrections use a new row (refund).

CREATE TABLE IF NOT EXISTS credits_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('purchase', 'grant', 'debit', 'refund')),
  session_id    UUID REFERENCES sessions(id) ON DELETE SET NULL,
  provider_ref  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credits_ledger_user_id ON credits_ledger(user_id);

-- Webhook idempotency for child C (Stripe): only one row per provider_ref.
CREATE UNIQUE INDEX IF NOT EXISTS idx_credits_ledger_provider_ref
  ON credits_ledger(provider_ref) WHERE provider_ref IS NOT NULL;

-- ── Schema version ───────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, name)
VALUES (3, '003-credits')
ON CONFLICT (version) DO NOTHING;

COMMIT;
