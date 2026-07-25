-- Volo Index — GIV-736 Publication latch: reject path
-- Migration 005: allow the reviewing operator to reject a queue entry
--
-- DPIA R-01 (GIV-734): the pending_review→published latch is a genuine
-- human safeguard only if the operator can REJECT (not merely release).
-- Rejected entries never issue a certificate.
--
-- Depends on: 001-initial-schema
-- Applied by: src/server/migrate.js

BEGIN;

ALTER TABLE publication_queue
  DROP CONSTRAINT publication_queue_status_check;

ALTER TABLE publication_queue
  ADD CONSTRAINT publication_queue_status_check
  CHECK (status IN ('pending_review', 'published', 'rejected'));

ALTER TABLE publication_queue
  ADD COLUMN rejected_at      TIMESTAMPTZ,
  ADD COLUMN rejection_reason TEXT;

INSERT INTO schema_migrations (version, name)
VALUES (5, '005-publication-reject');

COMMIT;
