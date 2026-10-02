#!/usr/bin/env node
/**
 * Volo Index — Retention Purge Engine (GIV-737 / GIV-742)
 *
 * Ordered purge steps per RoPA volo-data-protection A.6.
 * Each step runs in its own transaction and returns a deleted/affected count.
 *
 * Invocation:
 *   CLI:  node src/server/retention.js [--dry-run]
 *   API:  POST /api/internal/retention/run  { dryRun?: true }
 *   Cron: .github/workflows/retention.yml (daily)
 *
 * @module retention
 */

import { pool, withTransaction } from './db.js';
import { eraseUser } from './dsar.js';

/**
 * Scrub verbatim spanText/excerpt strings from a signals/details JSONB
 * structure for sessions whose transcript_turns have been purged.
 * Same leak path closed by GIV-736 redaction — categories/scores retained,
 * raw quotes are not.
 *
 * @param {any} value - signals or details JSONB value (mutated in place)
 * @param {string} placeholder
 * @returns {any}
 */
function scrubAllQuotes(value, placeholder) {
  if (Array.isArray(value)) {
    for (const item of value) scrubAllQuotes(item, placeholder);
  } else if (value && typeof value === 'object') {
    if (typeof value.spanText === 'string') {
      value.spanText = placeholder;
    }
    if (typeof value.excerpt === 'string') {
      value.excerpt = placeholder;
    }
    for (const key of Object.keys(value)) scrubAllQuotes(value[key], placeholder);
  }
  return value;
}

const SCRUB_PLACEHOLDER = '[Removed — retention policy]';

/**
 * Ordered retention steps. Each entry: { name, description, run(client, dryRun) → count }.
 * The array is exported so Engineer 2 (impl B) can append R7 (eraseUser for inactivity).
 */
export const steps = [
  {
    name: 'R1',
    description: 'Purge expired/used magic_link_tokens',
    async run(client, dryRun) {
      const sql = `
        DELETE FROM magic_link_tokens
        WHERE expires_at < NOW() OR used_at IS NOT NULL
      `;
      if (dryRun) {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM magic_link_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL`);
        return rows[0].c;
      }
      const { rowCount } = await client.query(sql);
      return rowCount;
    },
  },
  {
    name: 'R2',
    description: 'Purge expired/revoked auth_sessions',
    async run(client, dryRun) {
      const sql = `
        DELETE FROM auth_sessions
        WHERE expires_at < NOW() OR revoked_at IS NOT NULL
      `;
      if (dryRun) {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM auth_sessions WHERE expires_at < NOW() OR revoked_at IS NOT NULL`);
        return rows[0].c;
      }
      const { rowCount } = await client.query(sql);
      return rowCount;
    },
  },
  {
    name: 'R3',
    description: 'Purge 90-day transcript_turns + scrub score_results verbatim quotes',
    async run(client, dryRun) {
      // Sessions whose score was issued more than 90 days ago
      const sessionSql = `
        SELECT sr.session_id
        FROM score_results sr
        WHERE sr.created_at < NOW() - INTERVAL '90 days'
      `;
      const { rows: sessions } = await client.query(sessionSql);
      if (sessions.length === 0) return 0;

      const sessionIds = sessions.map(r => r.session_id);

      if (dryRun) {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS c FROM transcript_turns WHERE session_id = ANY($1::uuid[])`,
          [sessionIds],
        );
        return rows[0].c;
      }

      // Delete transcript_turns for those sessions
      const { rowCount } = await client.query(
        `DELETE FROM transcript_turns WHERE session_id = ANY($1::uuid[])`,
        [sessionIds],
      );

      // Scrub verbatim spanText/excerpt inside score_results for those sessions
      const { rows: scoreRows } = await client.query(
        `SELECT id, signals, details FROM score_results WHERE session_id = ANY($1::uuid[])`,
        [sessionIds],
      );
      for (const row of scoreRows) {
        const signals = scrubAllQuotes(row.signals, SCRUB_PLACEHOLDER);
        const details = row.details == null ? null : scrubAllQuotes(row.details, SCRUB_PLACEHOLDER);
        await client.query(
          `UPDATE score_results SET signals = $2, details = $3 WHERE id = $1`,
          [row.id, JSON.stringify(signals), details == null ? null : JSON.stringify(details)],
        );
      }

      return rowCount;
    },
  },
  {
    name: 'R4',
    description: 'Purge revoked certificates after 30-day grace (incl. score_results, transcripts, publication_queue)',
    async run(client, dryRun) {
      // Certificates revoked more than 30 days ago
      const certSql = `
        SELECT c.id, c.session_id
        FROM certificates c
        WHERE c.revoked_at IS NOT NULL
          AND c.revoked_at < NOW() - INTERVAL '30 days'
      `;
      const { rows: certs } = await client.query(certSql);
      if (certs.length === 0) return 0;

      if (dryRun) return certs.length;

      const certIds = certs.map(r => r.id);
      const sessionIds = certs.map(r => r.session_id);

      // Delete in dependency order: publication_queue → score_results → transcripts → certificates
      await client.query(
        `DELETE FROM publication_queue WHERE session_id = ANY($1::uuid[])`,
        [sessionIds],
      );
      await client.query(
        `DELETE FROM score_results WHERE session_id = ANY($1::uuid[])`,
        [sessionIds],
      );
      await client.query(
        `DELETE FROM transcripts WHERE session_id = ANY($1::uuid[])`,
        [sessionIds],
      );
      await client.query(
        `DELETE FROM certificates WHERE id = ANY($1::uuid[])`,
        [certIds],
      );

      return certs.length;
    },
  },
  {
    name: 'R5',
    description: 'Purge daily_usage older than 13 months',
    async run(client, dryRun) {
      const where = `usage_date < NOW() - INTERVAL '13 months'`;
      if (dryRun) {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM daily_usage WHERE ${where}`);
        return rows[0].c;
      }
      const { rowCount } = await client.query(`DELETE FROM daily_usage WHERE ${where}`);
      return rowCount;
    },
  },
  {
    name: 'R6',
    description: 'Publication queue hygiene — remove rows for consent-revoked certificates',
    async run(client, dryRun) {
      const sql = `
        SELECT pq.session_id
        FROM publication_queue pq
        JOIN certificates c ON c.session_id = pq.session_id
        WHERE c.publication_consent_revoked_at IS NOT NULL
      `;
      const { rows } = await client.query(sql);
      if (rows.length === 0) return 0;

      if (dryRun) return rows.length;

      const sessionIds = rows.map(r => r.session_id);
      await client.query(
        `DELETE FROM publication_queue WHERE session_id = ANY($1::uuid[])`,
        [sessionIds],
      );
      return rows.length;
    },
  },
  {
    name: 'R7',
    description: '24-month inactivity erasure',
    async run(client, dryRun) {
      const { rows: inactiveUsers } = await client.query(`
        SELECT id FROM users
        WHERE erased_at IS NULL
          AND last_active_at < NOW() - INTERVAL '24 months'
      `);

      if (inactiveUsers.length === 0) return 0;
      if (dryRun) return inactiveUsers.length;

      // eraseUser uses its own transaction via withTransaction, so we need
      // the pool reference. Import at module level; the pool is the same
      // connection source. Each erasure is independent so partial failures
      // don't roll back already-erased users.
      let erased = 0;
      for (const user of inactiveUsers) {
        try {
          await eraseUser(pool, user.id);
          erased++;
        } catch (err) {
          console.error(`[retention] R7 eraseUser failed for ${user.id}:`, err.message);
        }
      }
      return erased;
    },
  },
];

/**
 * Run all retention steps in order.
 *
 * @param {import('pg').Pool} db - Postgres pool
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<Record<string, number>>} per-step counts
 */
export async function runRetention(db, { dryRun = false } = {}) {
  const results = {};

  for (const step of steps) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const count = await step.run(client, dryRun, db);
      if (!dryRun) {
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
      }
      results[step.name] = count;
      console.log(`[retention] ${step.name} (${step.description}): ${count} ${dryRun ? '(dry run)' : 'deleted/affected'}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[retention] ${step.name} failed:`, err.message);
      results[step.name] = -1;
    } finally {
      client.release();
    }
  }

  return results;
}

// ── CLI entrypoint ───────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[retention] starting${dryRun ? ' (DRY RUN)' : ''}…`);

  try {
    const results = await runRetention(pool, { dryRun });
    console.log('[retention] complete:', JSON.stringify(results));
    if (Object.values(results).some(v => v === -1)) {
      console.error('[retention] one or more steps failed (count = -1)');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('[retention] fatal error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
