/**
 * Credits ledger tests (GIV-705)
 *
 * Covers: balance endpoint, grant endpoint auth, 402 path,
 * debit atomicity/concurrency, flag-off passthrough.
 *
 * Run: node --experimental-test-module-mocks --test test/server/credits.test.js
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── In-memory state ──────────────────────────────────────────────────

const users = new Map();
const sessions = new Map();
const ledger = [];       // append-only credits_ledger rows
const dailyUsage = new Map();
let creditsRequired = false;
let advisoryLockCalled = false;

function resetState() {
  users.clear();
  sessions.clear();
  ledger.length = 0;
  dailyUsage.clear();
  advisoryLockCalled = false;

  users.set('user-1', {
    id: 'user-1',
    email: 'test@example.com',
    display_name: 'Test User',
    email_verified: true,
    entitlements: { plan: 'free', maxConcurrentSessions: 1, dailyAssessmentLimit: 3 },
    created_at: '2026-07-17T00:00:00Z',
    updated_at: '2026-07-17T00:00:00Z',
  });

  sessions.set('sess-1', {
    id: 'sess-1',
    user_id: 'user-1',
    status: 'created',
    consent_given: true,
    consent_at: '2026-07-17T00:00:00Z',
    started_at: null,
    completed_at: null,
    abandoned_at: null,
    abandon_reason: null,
    dimension_progress: {},
    created_at: '2026-07-17T00:00:00Z',
    updated_at: '2026-07-17T00:00:00Z',
  });
}

function userBalance(userId) {
  return ledger
    .filter(e => e.user_id === userId)
    .reduce((sum, e) => sum + e.delta, 0);
}

// ── Mock DB ──────────────────────────────────────────────────────────

async function mockQuery(text, params) {
  // Advisory lock (concurrency guard)
  if (text.includes('pg_advisory_xact_lock')) {
    advisoryLockCalled = true;
    return { rows: [] };
  }

  // Credits balance
  if (text.includes('SUM(delta)') && text.includes('credits_ledger')) {
    const bal = userBalance(params[0]);
    return { rows: [{ balance: bal }] };
  }

  // Credits insert — debit (delta hardcoded as -1, session_id is $2)
  if (text.includes('INSERT INTO credits_ledger') && text.includes("'debit'")) {
    const entry = {
      id: `ledger-${ledger.length + 1}`,
      user_id: params[0],
      delta: -1,
      reason: 'debit',
      session_id: params[1],
      provider_ref: null,
      created_at: new Date().toISOString(),
    };
    ledger.push(entry);
    return { rows: [entry], rowCount: 1 };
  }

  // Credits insert — grant (delta is $2, no session_id)
  if (text.includes('INSERT INTO credits_ledger') && text.includes("'grant'")) {
    const entry = {
      id: `ledger-${ledger.length + 1}`,
      user_id: params[0],
      delta: params[1],
      reason: 'grant',
      session_id: null,
      provider_ref: null,
      created_at: new Date().toISOString(),
    };
    ledger.push(entry);
    return { rows: [entry], rowCount: 1 };
  }

  // Session update to in_progress
  if (text.includes('UPDATE sessions') && text.includes("'in_progress'")) {
    const s = sessions.get(params[0]);
    if (s) {
      s.status = 'in_progress';
      s.started_at = new Date().toISOString();
      s.updated_at = new Date().toISOString();
    }
    return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
  }

  // Session by ID
  if (text.includes('FROM sessions') && text.includes('id =') && !text.includes('COUNT')) {
    const s = sessions.get(params[0]);
    return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
  }

  // Active session count
  if (text.includes('COUNT') && text.includes('FROM sessions')) {
    const count = [...sessions.values()].filter(
      s => s.user_id === params[0] && ['created', 'in_progress'].includes(s.status),
    ).length;
    return { rows: [{ active_count: count }] };
  }

  // Entitlements
  if (text.includes('entitlements') && text.includes('FROM users')) {
    const u = [...users.values()].find(u => u.id === params[0]);
    return { rows: u ? [{ entitlements: u.entitlements }] : [] };
  }

  // Daily usage
  if (text.includes('FROM daily_usage')) {
    return { rows: [] };
  }
  if (text.includes('INSERT INTO daily_usage')) {
    return { rowCount: 1 };
  }

  // Session insert
  if (text.includes('INSERT INTO sessions')) {
    const s = {
      id: params[0], user_id: params[1], status: 'created',
      consent_given: false, consent_at: null, started_at: null,
      completed_at: null, abandoned_at: null, abandon_reason: null,
      dimension_progress: {}, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    sessions.set(params[0], s);
    return { rows: [s], rowCount: 1 };
  }

  // Transcript turns
  if (text.includes('MAX(turn_index)')) {
    return { rows: [{ max_idx: -1 }] };
  }
  if (text.includes('INSERT INTO transcript_turns')) {
    return { rowCount: 1 };
  }

  // User by ID
  if (text.includes('FROM users') && text.includes('id =')) {
    const u = [...users.values()].find(u => u.id === params[0]);
    return { rows: u ? [u] : [] };
  }

  // Certificates
  if (text.includes('FROM certificates')) {
    return { rows: [] };
  }

  // Score results
  if (text.includes('FROM score_results')) {
    return { rows: [] };
  }

  // Transcripts
  if (text.includes('FROM transcripts')) {
    return { rows: [] };
  }

  // Transcript turns select
  if (text.includes('FROM transcript_turns')) {
    return { rows: [] };
  }

  return { rows: [], rowCount: 0 };
}

await mock.module('../../src/server/db.js', {
  namedExports: {
    query: mockQuery,
    withTransaction: async (fn) => {
      // Simulate transaction: run fn with a client-like object
      const result = await fn({ query: mockQuery });
      return result;
    },
    pool: { query: mockQuery, on: () => {}, end: async () => {} },
    getClient: async () => ({ query: mockQuery, release: () => {} }),
  },
});

// Mock config to allow toggling creditsRequired at runtime
const realConfig = (await import('../../src/server/config.js')).config;
// We'll mutate creditsRequired on the config object directly
Object.defineProperty(realConfig, 'creditsRequired', {
  get: () => creditsRequired,
  configurable: true,
});

const { createApp } = await import('../../src/server/index.js');

// ── Helpers ──────────────────────────────────────────────────────────

import { createAccessToken } from '../../src/server/auth/jwt.js';

function request(server, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const hdrs = { 'Content-Type': 'application/json', ...headers };
    const r = http.request({ hostname: '127.0.0.1', port, path, method, headers: hdrs }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function authHeader(userId = 'user-1', email = 'test@example.com') {
  const token = createAccessToken({ id: userId, email }, 'dev-jwt-secret-do-not-use-in-prod');
  return { Authorization: `Bearer ${token}` };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Credits ledger (GIV-705)', () => {
  let server;

  before(async () => {
    const app = createApp({
      transcriptStore: { save: async () => {}, load: async () => null, listIds: async () => [] },
      llmAdapterFactory: () => ({
        on: () => {},
        begin: () => {},
        grantConsent: () => {},
      }),
    });
    await new Promise(r => { server = app.listen(0, r); });
  });

  after(async () => {
    await new Promise(r => server.close(r));
  });

  beforeEach(() => {
    resetState();
    creditsRequired = false;
  });

  // ── GET /api/credits/me ─────────────────────────────────────────

  describe('GET /api/credits/me', () => {
    it('returns 0 balance for a new user', async () => {
      const res = await request(server, 'GET', '/api/credits/me', null, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.balance, 0);
    });

    it('returns correct balance after grants', async () => {
      ledger.push({ user_id: 'user-1', delta: 5, reason: 'grant' });
      ledger.push({ user_id: 'user-1', delta: 3, reason: 'grant' });
      const res = await request(server, 'GET', '/api/credits/me', null, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.balance, 8);
    });

    it('reflects debits in balance', async () => {
      ledger.push({ user_id: 'user-1', delta: 5, reason: 'grant' });
      ledger.push({ user_id: 'user-1', delta: -1, reason: 'debit' });
      const res = await request(server, 'GET', '/api/credits/me', null, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.balance, 4);
    });

    it('requires authentication', async () => {
      const res = await request(server, 'GET', '/api/credits/me');
      assert.equal(res.status, 401);
    });
  });

  // ── POST /api/credits/grant ─────────────────────────────────────

  describe('POST /api/credits/grant', () => {
    it('requires X-Internal-Key', async () => {
      const res = await request(server, 'POST', '/api/credits/grant',
        { userId: 'user-1', delta: 5 }, authHeader());
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('rejects wrong X-Internal-Key', async () => {
      const res = await request(server, 'POST', '/api/credits/grant',
        { userId: 'user-1', delta: 5 },
        { 'X-Internal-Key': 'wrong-key', ...authHeader() });
      assert.equal(res.status, 403);
    });

    it('grants credits with valid internal key', async () => {
      const res = await request(server, 'POST', '/api/credits/grant',
        { userId: 'user-1', delta: 10 },
        { 'X-Internal-Key': realConfig.auth.internalKey });
      assert.equal(res.status, 201);
      assert.equal(res.body.entry.delta, 10);
      assert.equal(res.body.entry.reason, 'grant');
      assert.equal(ledger.length, 1);
    });

    it('rejects missing userId', async () => {
      const res = await request(server, 'POST', '/api/credits/grant',
        { delta: 5 },
        { 'X-Internal-Key': realConfig.auth.internalKey });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'MISSING_FIELD');
    });

    it('rejects non-positive delta', async () => {
      const res = await request(server, 'POST', '/api/credits/grant',
        { userId: 'user-1', delta: -3 },
        { 'X-Internal-Key': realConfig.auth.internalKey });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_FIELD');
    });

    it('rejects zero delta', async () => {
      const res = await request(server, 'POST', '/api/credits/grant',
        { userId: 'user-1', delta: 0 },
        { 'X-Internal-Key': realConfig.auth.internalKey });
      assert.equal(res.status, 400);
    });

    it('rejects non-integer delta', async () => {
      const res = await request(server, 'POST', '/api/credits/grant',
        { userId: 'user-1', delta: 2.5 },
        { 'X-Internal-Key': realConfig.auth.internalKey });
      assert.equal(res.status, 400);
    });
  });

  // ── Session start: flag off → no debit ──────────────────────────

  describe('Session start with CREDITS_REQUIRED=false', () => {
    it('starts session without debit when flag is off', async () => {
      creditsRequired = false;
      const res = await request(server, 'POST', '/api/sessions/sess-1/start', {}, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.session.status, 'in_progress');
      assert.equal(ledger.length, 0, 'no debit should be recorded');
    });

    it('starts session even with zero balance when flag is off', async () => {
      creditsRequired = false;
      // Reset session to created state
      sessions.get('sess-1').status = 'created';
      sessions.get('sess-1').started_at = null;
      // But use a fresh session ID
      sessions.set('sess-2', {
        id: 'sess-2', user_id: 'user-1', status: 'created',
        consent_given: true, consent_at: '2026-07-17T00:00:00Z',
        started_at: null, completed_at: null, abandoned_at: null,
        abandon_reason: null, dimension_progress: {},
        created_at: '2026-07-17T00:00:00Z', updated_at: '2026-07-17T00:00:00Z',
      });
      // Remove the first session from active (complete it) so concurrent limit doesn't block
      sessions.get('sess-1').status = 'completed';
      const res = await request(server, 'POST', '/api/sessions/sess-2/start', {}, authHeader());
      assert.equal(res.status, 200);
      assert.equal(ledger.length, 0);
    });
  });

  // ── Session start: flag on → 402 ───────────────────────────────

  describe('Session start with CREDITS_REQUIRED=true', () => {
    it('returns 402 when balance is 0', async () => {
      creditsRequired = true;
      const res = await request(server, 'POST', '/api/sessions/sess-1/start', {}, authHeader());
      assert.equal(res.status, 402);
      assert.equal(res.body.error.code, 'INSUFFICIENT_CREDITS');
      // Session should remain in created state
      assert.equal(sessions.get('sess-1').status, 'created');
    });

    it('debits 1 credit on successful start', async () => {
      creditsRequired = true;
      ledger.push({ user_id: 'user-1', delta: 3, reason: 'grant' });
      const res = await request(server, 'POST', '/api/sessions/sess-1/start', {}, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.session.status, 'in_progress');
      // Should have 2 ledger entries: initial grant + debit
      assert.equal(ledger.length, 2);
      const debit = ledger.find(e => e.reason === 'debit');
      assert.ok(debit, 'debit entry should exist');
      assert.equal(debit.delta, -1);
      assert.equal(debit.session_id, 'sess-1');
    });

    it('uses advisory lock for concurrency safety', async () => {
      creditsRequired = true;
      ledger.push({ user_id: 'user-1', delta: 1, reason: 'grant' });
      advisoryLockCalled = false;
      await request(server, 'POST', '/api/sessions/sess-1/start', {}, authHeader());
      assert.ok(advisoryLockCalled, 'pg_advisory_xact_lock should be called');
    });

    it('402 when balance exactly 0 after debits', async () => {
      creditsRequired = true;
      ledger.push({ user_id: 'user-1', delta: 1, reason: 'grant' });
      ledger.push({ user_id: 'user-1', delta: -1, reason: 'debit' });
      const res = await request(server, 'POST', '/api/sessions/sess-1/start', {}, authHeader());
      assert.equal(res.status, 402);
    });

    it('succeeds when balance is exactly 1', async () => {
      creditsRequired = true;
      ledger.push({ user_id: 'user-1', delta: 1, reason: 'grant' });
      const res = await request(server, 'POST', '/api/sessions/sess-1/start', {}, authHeader());
      assert.equal(res.status, 200);
    });
  });

  // ── Concurrency: double-start must not double-debit ─────────────

  describe('Concurrency: double-start protection', () => {
    it('second start returns 409 (session already in_progress), no extra debit', async () => {
      creditsRequired = true;
      ledger.push({ user_id: 'user-1', delta: 5, reason: 'grant' });

      // First start
      const res1 = await request(server, 'POST', '/api/sessions/sess-1/start', {}, authHeader());
      assert.equal(res1.status, 200);
      const debitCount1 = ledger.filter(e => e.reason === 'debit').length;
      assert.equal(debitCount1, 1);

      // Second start — session is now in_progress, should get 409
      const res2 = await request(server, 'POST', '/api/sessions/sess-1/start', {}, authHeader());
      assert.equal(res2.status, 409);
      assert.equal(res2.body.error.code, 'INVALID_STATE');

      // No additional debit
      const debitCount2 = ledger.filter(e => e.reason === 'debit').length;
      assert.equal(debitCount2, 1, 'should not double-debit');
    });
  });

  // ── Balance math ────────────────────────────────────────────────

  describe('Balance math', () => {
    it('grants, debits, and refunds produce correct balance', async () => {
      ledger.push({ user_id: 'user-1', delta: 10, reason: 'grant' });
      ledger.push({ user_id: 'user-1', delta: -1, reason: 'debit' });
      ledger.push({ user_id: 'user-1', delta: -1, reason: 'debit' });
      ledger.push({ user_id: 'user-1', delta: 1, reason: 'refund' });
      const res = await request(server, 'GET', '/api/credits/me', null, authHeader());
      assert.equal(res.body.balance, 9);
    });

    it('does not mix balances between users', async () => {
      ledger.push({ user_id: 'user-1', delta: 10, reason: 'grant' });
      ledger.push({ user_id: 'user-other', delta: 50, reason: 'grant' });
      const res = await request(server, 'GET', '/api/credits/me', null, authHeader());
      assert.equal(res.body.balance, 10);
    });
  });
});
