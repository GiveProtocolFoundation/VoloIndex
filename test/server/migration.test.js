/**
 * Migration SQL — structural tests (T2-A)
 *
 * Validates migration files parse correctly and contain expected structures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../src/server/migrations');

describe('migration files', () => {
  it('migration directory contains at least one .sql file', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
    assert.ok(files.length >= 1, 'Expected at least one migration file');
  });

  it('001-initial-schema.sql exists and is non-empty', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '001-initial-schema.sql'), 'utf8');
    assert.ok(sql.length > 100, 'Migration file should be non-trivial');
  });

  it('001 creates all required tables', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '001-initial-schema.sql'), 'utf8');

    const requiredTables = [
      'users',
      'sessions',
      'transcript_turns',
      'transcripts',
      'score_results',
      'certificates',
      'publication_queue',
      // NOTE: schema_migrations is bootstrapped by migrate.js (CREATE TABLE IF
      // NOT EXISTS) before any migration runs — see 34435a5 fresh-DB fix — so
      // it intentionally does NOT appear in 001-initial-schema.sql.
    ];

    for (const table of requiredTables) {
      assert.ok(
        sql.includes(`CREATE TABLE ${table}`),
        `Missing CREATE TABLE ${table}`,
      );
    }
  });

  it('001 enforces D4 consent invariant on transcripts table', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '001-initial-schema.sql'), 'utf8');
    assert.ok(sql.includes('consent_given = TRUE'), 'transcripts table must CHECK consent_given = TRUE');
  });

  it('001 defines proper session status CHECK constraint', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '001-initial-schema.sql'), 'utf8');
    assert.ok(sql.includes("'created'"));
    assert.ok(sql.includes("'in_progress'"));
    assert.ok(sql.includes("'completed'"));
    assert.ok(sql.includes("'abandoned'"));
  });

  it('001 defines publication queue status CHECK constraint', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '001-initial-schema.sql'), 'utf8');
    assert.ok(sql.includes("'pending_review'"));
    assert.ok(sql.includes("'published'"));
  });

  it('001 creates indexes for performance-critical queries', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '001-initial-schema.sql'), 'utf8');
    assert.ok(sql.includes('idx_sessions_user_id'));
    assert.ok(sql.includes('idx_sessions_status'));
    assert.ok(sql.includes('idx_transcript_turns_session'));
    assert.ok(sql.includes('idx_publication_queue_status'));
    assert.ok(sql.includes('idx_certificates_user_id'));
  });

  it('001 uses UUID primary keys', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '001-initial-schema.sql'), 'utf8');
    assert.ok(sql.includes('gen_random_uuid()'));
  });

  it('001 wraps in a transaction', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '001-initial-schema.sql'), 'utf8');
    assert.ok(sql.includes('BEGIN'));
    assert.ok(sql.includes('COMMIT'));
  });
});
