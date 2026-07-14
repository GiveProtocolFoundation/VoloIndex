-- Volo Index — T2-C Auth Tables
-- Migration 002: magic-link tokens, user entitlements, auth sessions
--
-- Depends on: 001-initial-schema (users table)
-- Applied by: src/server/migrate.js

BEGIN;

-- ── Magic-link tokens ────────────────────────────────────────────────────
-- Raw token never stored; only SHA-256 hash.

CREATE TABLE magic_link_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_magic_link_tokens_email ON magic_link_tokens(email);
CREATE INDEX idx_magic_link_tokens_expires ON magic_link_tokens(expires_at);

-- ── User entitlements ────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN email_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN email_verified_at    TIMESTAMPTZ,
  ADD COLUMN entitlements         JSONB NOT NULL DEFAULT '{"plan":"free","maxConcurrentSessions":1,"dailyAssessmentLimit":3}';

-- ── Auth sessions (opaque refresh tokens, JWT is short-lived) ────────────

CREATE TABLE auth_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_token_hash ON auth_sessions(token_hash);

-- ── Track daily assessment usage ─────────────────────────────────────────

CREATE TABLE daily_usage (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  session_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

-- ── Schema version ───────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, name)
VALUES (2, '002-auth-tables');

COMMIT;
