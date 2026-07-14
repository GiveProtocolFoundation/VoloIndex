-- Volo Index — T2-A Initial Database Schema
-- Migration 001: users, sessions, transcripts, scores, certificates, publication queue
--
-- Depends on: PostgreSQL >= 14 (gen_random_uuid, JSONB)
-- Applied by: src/server/migrate.js

BEGIN;

-- ── Users ──────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Assessment Sessions ────────────────────────────────────────────────

CREATE TABLE sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'in_progress', 'completed', 'abandoned')),
  consent_given       BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at          TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  abandoned_at        TIMESTAMPTZ,
  abandon_reason      TEXT,
  dimension_progress  JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_status  ON sessions(status);

-- ── Transcript Turns (append-only, per-turn persistence) ───────────────

CREATE TABLE transcript_turns (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_index  INTEGER NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('interviewer', 'candidate')),
  content     TEXT NOT NULL,
  dimension   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, turn_index)
);

CREATE INDEX idx_transcript_turns_session ON transcript_turns(session_id);

-- ── Transcripts (D4 consent-gated, full snapshot after completion) ─────

CREATE TABLE transcripts (
  session_id    UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  candidate_id  TEXT NOT NULL,
  consent_given BOOLEAN NOT NULL CHECK (consent_given = TRUE),
  consent_at    TIMESTAMPTZ NOT NULL,
  transcript    JSONB NOT NULL,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Score Results ──────────────────────────────────────────────────────

CREATE TABLE score_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE UNIQUE,
  signals           JSONB NOT NULL,
  dimension_scores  JSONB NOT NULL,
  overall_score     NUMERIC(4,2) NOT NULL,
  overall_tier      TEXT NOT NULL,
  details           JSONB,
  rubric_version    TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Certificates ───────────────────────────────────────────────────────

CREATE TABLE certificates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE UNIQUE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holder_name       TEXT NOT NULL,
  overall_score     NUMERIC(4,2) NOT NULL,
  overall_tier      TEXT NOT NULL,
  dimension_scores  JSONB NOT NULL,
  rubric_version    TEXT NOT NULL,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at        TIMESTAMPTZ,
  revocation_reason TEXT
);

CREATE INDEX idx_certificates_user_id ON certificates(user_id);

-- ── Publication Queue (D5: first-50 QA hold + auto-publish latch) ─────

CREATE TABLE publication_queue (
  session_id              UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  candidate_id            TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending_review'
                            CHECK (status IN ('pending_review', 'published')),
  score_result_id         UUID REFERENCES score_results(id),
  enqueued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at             TIMESTAMPTZ,
  agreed_with_extractor   BOOLEAN
);

CREATE INDEX idx_publication_queue_status ON publication_queue(status);

-- ── Schema version tracking ────────────────────────────────────────────

-- IF NOT EXISTS: migrate.js pre-creates this table (ensureMigrationsTable)
-- before applying any migration; without it, this statement aborts the
-- whole transaction on a fresh database (GIV-627 staging smoke finding).
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version, name)
VALUES (1, '001-initial-schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
