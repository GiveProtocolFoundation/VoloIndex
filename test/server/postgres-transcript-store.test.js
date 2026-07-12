/**
 * PostgresTranscriptStore — unit tests (T2-A)
 *
 * Tests the store logic with a mock pg Pool.
 * No real database required.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresTranscriptStore } from '../../src/server/stores/postgres-transcript-store.js';

function createMockPool() {
  const rows = [];
  return {
    _rows: rows,
    _lastQuery: null,
    _lastParams: null,
    async query(text, params) {
      this._lastQuery = text;
      this._lastParams = params;

      // INSERT/UPSERT
      if (text.includes('INSERT INTO transcripts')) {
        rows.push({
          session_id: params[0],
          candidate_id: params[1],
          consent_given: params[2],
          consent_at: params[3],
          transcript: JSON.parse(params[4]),
          saved_at: params[5],
        });
        return { rowCount: 1 };
      }

      // SELECT by session_id
      if (text.includes('WHERE session_id =')) {
        const id = params[0];
        const found = rows.filter(r => r.session_id === id);
        return { rows: found };
      }

      // SELECT all session_ids
      if (text.includes('SELECT session_id FROM transcripts')) {
        return { rows: rows.map(r => ({ session_id: r.session_id })) };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

describe('PostgresTranscriptStore', () => {
  let store;
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
    store = new PostgresTranscriptStore({ pool: mockPool });
  });

  it('requires a pool option', () => {
    assert.throws(() => new PostgresTranscriptStore({}), /requires a { pool } option/);
  });

  it('saves a valid transcript record', async () => {
    await store.save({
      sessionId: 'sess-001',
      candidateId: 'cand-001',
      consentGiven: true,
      consentAt: '2026-07-12T10:00:00Z',
      transcript: { id: 'sess-001', turns: [] },
    });

    assert.equal(mockPool._rows.length, 1);
    assert.equal(mockPool._rows[0].session_id, 'sess-001');
    assert.equal(mockPool._rows[0].consent_given, true);
  });

  it('rejects save without consentGiven: true (D4 invariant)', async () => {
    await assert.rejects(
      () => store.save({
        sessionId: 'sess-002',
        candidateId: 'cand-002',
        consentGiven: false,
        transcript: { id: 'sess-002', turns: [] },
      }),
      /D4 policy/,
    );
  });

  it('rejects save with missing sessionId', async () => {
    await assert.rejects(
      () => store.save({
        candidateId: 'cand-003',
        consentGiven: true,
        transcript: { turns: [] },
      }),
      /sessionId/,
    );
  });

  it('rejects save with missing candidateId', async () => {
    await assert.rejects(
      () => store.save({
        sessionId: 'sess-004',
        consentGiven: true,
        transcript: { turns: [] },
      }),
      /candidateId/,
    );
  });

  it('rejects save with missing transcript', async () => {
    await assert.rejects(
      () => store.save({
        sessionId: 'sess-005',
        candidateId: 'cand-005',
        consentGiven: true,
      }),
      /transcript/,
    );
  });

  it('rejects save with non-object input', async () => {
    await assert.rejects(() => store.save(null), /must be an object/);
    await assert.rejects(() => store.save('string'), /must be an object/);
  });

  it('loads a stored record', async () => {
    await store.save({
      sessionId: 'sess-010',
      candidateId: 'cand-010',
      consentGiven: true,
      consentAt: '2026-07-12T10:00:00Z',
      transcript: { id: 'sess-010', turns: [{ role: 'interviewer', content: 'Hello' }] },
    });

    const record = await store.load('sess-010');
    assert.equal(record.sessionId, 'sess-010');
    assert.equal(record.candidateId, 'cand-010');
    assert.equal(record.consentGiven, true);
    assert.equal(record.transcript.turns.length, 1);
  });

  it('returns null for non-existent session', async () => {
    const record = await store.load('nonexistent');
    assert.equal(record, null);
  });

  it('lists stored session IDs', async () => {
    await store.save({
      sessionId: 'sess-020',
      candidateId: 'cand-020',
      consentGiven: true,
      consentAt: '2026-07-12T10:00:00Z',
      transcript: { id: 'sess-020', turns: [] },
    });
    await store.save({
      sessionId: 'sess-021',
      candidateId: 'cand-021',
      consentGiven: true,
      consentAt: '2026-07-12T10:01:00Z',
      transcript: { id: 'sess-021', turns: [] },
    });

    const ids = await store.listIds();
    assert.ok(ids.includes('sess-020'));
    assert.ok(ids.includes('sess-021'));
  });

  it('sets savedAt automatically when not provided', async () => {
    await store.save({
      sessionId: 'sess-030',
      candidateId: 'cand-030',
      consentGiven: true,
      consentAt: '2026-07-12T10:00:00Z',
      transcript: { id: 'sess-030', turns: [] },
    });

    assert.ok(mockPool._rows[0].saved_at);
  });
});
