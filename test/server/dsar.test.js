/**
 * DSAR erasure module tests (GIV-743)
 *
 * Covers: eraseUser idempotency, financial carve-out (credits_ledger
 * pseudonymisation), tombstone correctness, exportUserData completeness,
 * and user-not-found error.
 *
 * Run: node --test test/server/dsar.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { eraseUser, exportUserData } from '../../src/server/dsar.js';

// ── In-memory tables ────────────────────────────────────────────────

let users, sessions, transcriptTurns, transcripts, scoreResults,
    certificates, publicationQueue, authSessions, dailyUsage,
    magicLinkTokens, creditsLedger;

function resetTables() {
  users = [];
  sessions = [];
  transcriptTurns = [];
  transcripts = [];
  scoreResults = [];
  certificates = [];
  publicationQueue = [];
  authSessions = [];
  dailyUsage = [];
  magicLinkTokens = [];
  creditsLedger = [];
}

function seedUser(overrides = {}) {
  const user = {
    id: 'user-1',
    email: 'alice@example.com',
    display_name: 'Alice',
    email_verified: true,
    email_verified_at: new Date(),
    entitlements: { plan: 'free', maxConcurrentSessions: 1, dailyAssessmentLimit: 3 },
    age_attested_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    last_active_at: new Date(),
    erased_at: null,
    ...overrides,
  };
  users.push(user);
  return user;
}

function seedSession(userId, id = 'sess-1') {
  const s = { id, user_id: userId, status: 'completed', consent_given: true, consent_at: new Date(),
    started_at: new Date(), completed_at: new Date(), abandoned_at: null, abandon_reason: null,
    dimension_progress: {}, created_at: new Date(), updated_at: new Date() };
  sessions.push(s);
  return s;
}

// ── Mock pool ───────────────────────────────────────────────────────

function createMockPool() {
  function createClient() {
    return {
      async query(sql, params) { return handleQuery(sql, params); },
      release() { /* no-op */ },
    };
  }

  const pool = {
    async connect() { return createClient(); },
    async query(sql, params) { return handleQuery(sql, params); },
  };
  return pool;
}

function handleQuery(sql, params) {
  const text = sql.replace(/\s+/g, ' ').trim();

  if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
    return { rows: [], rowCount: 0 };
  }

  // SELECT user FOR UPDATE
  if (text.includes('FROM users WHERE id') && text.includes('FOR UPDATE')) {
    const user = users.find(u => u.id === params[0]);
    return { rows: user ? [user] : [] };
  }

  // SELECT user (export)
  if (text.includes('FROM users WHERE id') && !text.includes('FOR UPDATE')) {
    const user = users.find(u => u.id === params[0]);
    return { rows: user ? [user] : [] };
  }

  // DELETE sessions
  if (text.includes('DELETE FROM sessions WHERE user_id')) {
    const before = sessions.length;
    sessions = sessions.filter(s => s.user_id !== params[0]);
    return { rowCount: before - sessions.length };
  }

  // DELETE auth_sessions
  if (text.includes('DELETE FROM auth_sessions WHERE user_id')) {
    const before = authSessions.length;
    authSessions = authSessions.filter(s => s.user_id !== params[0]);
    return { rowCount: before - authSessions.length };
  }

  // DELETE daily_usage
  if (text.includes('DELETE FROM daily_usage WHERE user_id')) {
    const before = dailyUsage.length;
    dailyUsage = dailyUsage.filter(d => d.user_id !== params[0]);
    return { rowCount: before - dailyUsage.length };
  }

  // DELETE magic_link_tokens
  if (text.includes('DELETE FROM magic_link_tokens WHERE email')) {
    const before = magicLinkTokens.length;
    magicLinkTokens = magicLinkTokens.filter(t => t.email !== params[0]);
    return { rowCount: before - magicLinkTokens.length };
  }

  // UPDATE credits_ledger (pseudonymise)
  if (text.includes('UPDATE credits_ledger SET subject_key')) {
    let count = 0;
    for (const row of creditsLedger) {
      if (row.user_id === params[0]) {
        row.subject_key = params[1];
        row.user_id = null;
        count++;
      }
    }
    return { rowCount: count };
  }

  // UPDATE users (tombstone)
  if (text.includes('UPDATE users SET') && text.includes('erased_at')) {
    const user = users.find(u => u.id === params[0]);
    if (user) {
      user.email = params[1];
      user.display_name = null;
      user.email_verified = false;
      user.entitlements = { plan: 'free', maxConcurrentSessions: 1, dailyAssessmentLimit: 3 };
      user.age_attested_at = null;
      user.erased_at = new Date();
      user.updated_at = new Date();
    }
    return { rowCount: user ? 1 : 0 };
  }

  // SELECT sessions (export)
  if (text.includes('FROM sessions WHERE user_id')) {
    return { rows: sessions.filter(s => s.user_id === params[0]) };
  }

  // SELECT transcript_turns (export)
  if (text.includes('FROM transcript_turns WHERE session_id = ANY')) {
    const ids = params[0];
    return { rows: transcriptTurns.filter(t => ids.includes(t.session_id)) };
  }

  // SELECT transcripts (export)
  if (text.includes('FROM transcripts WHERE session_id = ANY')) {
    const ids = params[0];
    return { rows: transcripts.filter(t => ids.includes(t.session_id)) };
  }

  // SELECT score_results (export)
  if (text.includes('FROM score_results WHERE session_id = ANY')) {
    const ids = params[0];
    return { rows: scoreResults.filter(sr => ids.includes(sr.session_id)) };
  }

  // SELECT certificates (export)
  if (text.includes('FROM certificates WHERE session_id = ANY')) {
    const ids = params[0];
    return { rows: certificates.filter(c => ids.includes(c.session_id)) };
  }

  // SELECT credits_ledger (export)
  if (text.includes('FROM credits_ledger WHERE user_id')) {
    return { rows: creditsLedger.filter(c => c.user_id === params[0]) };
  }

  return { rows: [], rowCount: 0 };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('eraseUser', () => {
  beforeEach(() => resetTables());

  it('erases a user with all associated data', async () => {
    const user = seedUser();
    seedSession(user.id, 'sess-1');
    authSessions.push({ id: 'auth-1', user_id: user.id });
    dailyUsage.push({ user_id: user.id, usage_date: new Date() });
    magicLinkTokens.push({ id: 'mlt-1', email: user.email });

    const result = await eraseUser(createMockPool(), user.id);

    assert.deepEqual(result, { erased: true, alreadyErased: false });
    assert.equal(sessions.length, 0);
    assert.equal(authSessions.length, 0);
    assert.equal(dailyUsage.length, 0);
    assert.equal(magicLinkTokens.length, 0);
    assert.equal(user.erased_at !== null, true);
    assert.equal(user.display_name, null);
    assert.equal(user.email_verified, false);
    assert.equal(user.age_attested_at, null);
    assert.match(user.email, /^erased\+user-1@invalid\.voloindex\.org$/);
  });

  it('pseudonymises credits_ledger (financial carve-out)', async () => {
    const user = seedUser();
    creditsLedger.push(
      { id: 'cl-1', user_id: user.id, delta: 5, reason: 'purchase', provider_ref: 'paypal-123', subject_key: null },
      { id: 'cl-2', user_id: user.id, delta: -1, reason: 'debit', provider_ref: null, subject_key: null },
    );

    await eraseUser(createMockPool(), user.id);

    const expectedKey = createHash('sha256').update(user.id).digest('hex');
    assert.equal(creditsLedger[0].subject_key, expectedKey);
    assert.equal(creditsLedger[0].user_id, null);
    assert.equal(creditsLedger[0].provider_ref, 'paypal-123');
    assert.equal(creditsLedger[1].subject_key, expectedKey);
    assert.equal(creditsLedger[1].user_id, null);
  });

  it('is idempotent — erasing an already-erased user is a no-op', async () => {
    const user = seedUser({ erased_at: new Date() });

    const result = await eraseUser(createMockPool(), user.id);

    assert.deepEqual(result, { erased: true, alreadyErased: true });
  });

  it('throws for a non-existent user', async () => {
    await assert.rejects(
      () => eraseUser(createMockPool(), 'nonexistent-id'),
      { message: 'User not found: nonexistent-id' },
    );
  });

  it('does not affect other users', async () => {
    const alice = seedUser({ id: 'user-alice', email: 'alice@example.com' });
    const bob = seedUser({ id: 'user-bob', email: 'bob@example.com' });
    seedSession(alice.id, 'sess-alice');
    seedSession(bob.id, 'sess-bob');
    authSessions.push({ id: 'auth-a', user_id: alice.id });
    authSessions.push({ id: 'auth-b', user_id: bob.id });

    await eraseUser(createMockPool(), alice.id);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'sess-bob');
    assert.equal(authSessions.length, 1);
    assert.equal(authSessions[0].user_id, bob.id);
    assert.equal(bob.erased_at, null);
    assert.equal(bob.email, 'bob@example.com');
  });

  it('tombstones user row without hard-deleting it', async () => {
    const user = seedUser();
    await eraseUser(createMockPool(), user.id);

    assert.equal(users.length, 1);
    assert.equal(users[0].id, user.id);
    assert.notEqual(users[0].erased_at, null);
  });
});

describe('exportUserData', () => {
  beforeEach(() => resetTables());

  it('returns a complete data bundle for a user', async () => {
    const user = seedUser();
    seedSession(user.id, 'sess-1');
    transcriptTurns.push({ session_id: 'sess-1', turn_index: 0, role: 'interviewer', content: 'Hello', dimension: 'planning', redacted_at: null, created_at: new Date() });
    transcriptTurns.push({ session_id: 'sess-1', turn_index: 1, role: 'candidate', content: 'Secret answer', dimension: 'planning', redacted_at: new Date(), created_at: new Date() });
    scoreResults.push({ id: 'sr-1', session_id: 'sess-1', signals: [], dimension_scores: {}, overall_score: 3.5, overall_tier: 'B', details: null, rubric_version: '1.0', created_at: new Date() });
    certificates.push({ id: 'cert-1', session_id: 'sess-1', holder_name: 'Alice', overall_score: 3.5, overall_tier: 'B', dimension_scores: {}, rubric_version: '1.0', issued_at: new Date(), revoked_at: null, revocation_reason: null, publication_consent_at: null, publication_consent_revoked_at: null });
    creditsLedger.push({ id: 'cl-1', user_id: user.id, delta: 5, reason: 'purchase', session_id: null, provider_ref: 'pp-1', created_at: new Date() });

    const data = await exportUserData(createMockPool(), user.id);

    assert.ok(data.exportedAt);
    assert.equal(data.user.id, user.id);
    assert.equal(data.sessions.length, 1);
    assert.equal(data.transcriptTurns.length, 2);
    assert.equal(data.transcriptTurns[0].content, 'Hello');
    assert.equal(data.transcriptTurns[1].content, '[Redacted]');
    assert.equal(data.scoreResults.length, 1);
    assert.equal(data.certificates.length, 1);
    assert.equal(data.creditsLedger.length, 1);
  });

  it('throws for a non-existent user', async () => {
    await assert.rejects(
      () => exportUserData(createMockPool(), 'nonexistent-id'),
      { message: 'User not found: nonexistent-id' },
    );
  });

  it('returns empty arrays for a user with no data', async () => {
    seedUser();
    const data = await exportUserData(createMockPool(), 'user-1');

    assert.equal(data.sessions.length, 0);
    assert.equal(data.transcriptTurns.length, 0);
    assert.equal(data.scoreResults.length, 0);
    assert.equal(data.certificates.length, 0);
    assert.equal(data.creditsLedger.length, 0);
  });
});
