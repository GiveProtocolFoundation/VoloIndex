#!/usr/bin/env node
/**
 * Volo Index — Schema Migrator (T2-A)
 *
 * Applies SQL migrations from src/server/migrations/ in version order.
 * Idempotent: skips already-applied versions.
 *
 * Usage: node src/server/migrate.js
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedVersions() {
  const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(rows.map(r => r.version));
}

async function migrate() {
  await ensureMigrationsTable();
  const applied = await getAppliedVersions();

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    const match = file.match(/^(\d+)-/);
    if (!match) continue;
    const version = parseInt(match[1], 10);
    if (applied.has(version)) {
      console.log(`  [skip] ${file} (already applied)`);
      continue;
    }

    console.log(`  [apply] ${file} ...`);
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await pool.query(sql);
    // The migration itself may INSERT into schema_migrations;
    // double-check and insert if it didn't.
    const check = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
    if (check.rowCount === 0) {
      await pool.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [version, file],
      );
    }
    count++;
  }

  console.log(count > 0 ? `  ${count} migration(s) applied.` : '  All migrations up to date.');
}

try {
  await migrate();
} catch (err) {
  console.error('[migrate] error:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
