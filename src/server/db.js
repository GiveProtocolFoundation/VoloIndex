/**
 * Volo Index — Postgres Connection Pool (T2-A)
 *
 * Single shared pool for the application lifetime.
 * Callers: import { pool, query } from './db.js';
 */

import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.db.connectionString,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  ssl: config.db.ssl || undefined,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error:', err.message);
});

/**
 * Shorthand: pool.query(text, params).
 * @param {string} text  SQL text
 * @param {any[]}  [params]
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Acquire a client for a transaction.
 * Caller MUST release it: `client.release()`.
 * @returns {Promise<pg.PoolClient>}
 */
export async function getClient() {
  return pool.connect();
}

/**
 * Run `fn(client)` inside a BEGIN/COMMIT/ROLLBACK transaction.
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
