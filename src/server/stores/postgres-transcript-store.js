/**
 * Volo Index — PostgresTranscriptStore (T2-A)
 *
 * Production TranscriptStore backed by Postgres, replacing the
 * InMemoryTranscriptStore and FileTranscriptStore stopgaps.
 *
 * Implements the TranscriptStore interface from src/assessment/consent-store.js.
 * Enforces the D4 invariant: no transcript stored without consentGiven === true
 * (enforced both here AND by the CHECK constraint in the transcripts table).
 */

import { TranscriptStore } from '../../assessment/consent-store.js';

export class PostgresTranscriptStore extends TranscriptStore {
  /**
   * @param {{ pool: import('pg').Pool }} opts
   */
  constructor({ pool }) {
    super();
    if (!pool) throw new Error('PostgresTranscriptStore requires a { pool } option');
    this._pool = pool;
  }

  /**
   * Persist a transcript record.
   * D4 invariant: throws if consentGiven !== true.
   *
   * @param {import('../../assessment/consent-store.js').TranscriptRecord} record
   */
  async save(record) {
    if (!record || typeof record !== 'object') {
      throw new TypeError('Transcript record must be an object');
    }
    if (!record.sessionId || typeof record.sessionId !== 'string') {
      throw new Error('Transcript record must have a sessionId string');
    }
    if (!record.candidateId || typeof record.candidateId !== 'string') {
      throw new Error('Transcript record must have a candidateId string');
    }
    if (record.consentGiven !== true) {
      throw new Error('Cannot store transcript without consentGiven: true (D4 policy — no transcript without consent)');
    }
    if (!record.transcript || typeof record.transcript !== 'object') {
      throw new Error('Transcript record must have a transcript object');
    }

    const savedAt = record.savedAt ?? new Date().toISOString();

    await this._pool.query(
      `INSERT INTO transcripts (session_id, candidate_id, consent_given, consent_at, transcript, saved_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id) DO UPDATE SET
         transcript = EXCLUDED.transcript,
         saved_at   = EXCLUDED.saved_at`,
      [
        record.sessionId,
        record.candidateId,
        true,
        record.consentAt || new Date().toISOString(),
        JSON.stringify(record.transcript),
        savedAt,
      ],
    );
  }

  /**
   * Load a stored record by session ID.
   * @param {string} sessionId
   * @returns {Promise<import('../../assessment/consent-store.js').TranscriptRecord|null>}
   */
  async load(sessionId) {
    const { rows } = await this._pool.query(
      `SELECT session_id, candidate_id, consent_given, consent_at, transcript, saved_at
       FROM transcripts WHERE session_id = $1`,
      [sessionId],
    );
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      sessionId: row.session_id,
      candidateId: row.candidate_id,
      consentGiven: row.consent_given,
      consentAt: row.consent_at?.toISOString?.() ?? row.consent_at,
      transcript: row.transcript,
      savedAt: row.saved_at?.toISOString?.() ?? row.saved_at,
    };
  }

  /**
   * List all stored session IDs.
   * @returns {Promise<string[]>}
   */
  async listIds() {
    const { rows } = await this._pool.query(
      'SELECT session_id FROM transcripts ORDER BY saved_at',
    );
    return rows.map(r => r.session_id);
  }
}
