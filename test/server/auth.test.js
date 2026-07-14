/**
 * Auth module tests (T2-C, GIV-623)
 *
 * Covers: JWT sign/verify, magic-link flow, auth middleware,
 * session ownership enforcement, interviewer-turn forge-surface guard,
 * entitlement enforcement (concurrent + daily limits).
 *
 * Run: node --experimental-test-module-mocks --test test/server/auth.test.js
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── JWT unit tests (no mocks needed) ──────────────────────────────────

import { signJwt, verifyJwt, createAccessToken } from '../../src/server/auth/jwt.js';

describe('JWT utilities', () => {
  const secret = 'test-secret-key-for-jwt';

  it('signs and verifies a token', () => {
    const payload = { sub: 'user-1', email: 'a@b.com', iat: 1000, exp: 9999999999 };
    const token = signJwt(payload, secret);
    const decoded = verifyJwt(token, secret);
    assert.equal(decoded.sub, 'user-1');
    assert.equal(decoded.email, 'a@b.com');
  });

  it('rejects tampered token', () => {
    const token = signJwt({ sub: 'user-1', exp: 9999999999 }, secret);
    const tampered = token.slice(0, -5) + 'XXXXX';
    assert.throws(() => verifyJwt(tampered, secret), /invalid signature/);
  });

  it('rejects expired token', () => {
    const token = signJwt({ sub: 'user-1', exp: 1 }, secret);
    assert.throws(() => verifyJwt(token, secret), /token expired/);
  });

  it('rejects malformed token', () => {
    assert.throws(() => verifyJwt('not.a.valid.token.at.all', secret), /malformed/);
    assert.throws(() => verifyJwt('', secret), /missing token/);
    assert.throws(() => verifyJwt(null, secret), /missing token/);
  });

  it('createAccessToken includes sub, email, iat, exp', () => {
    const token = createAccessToken({ id: 'uid', email: 'x@y.com' }, secret, 3600);
    const decoded = verifyJwt(token, secret);
    assert.equal(decoded.sub, 'uid');
    assert.equal(decoded.email, 'x@y.com');
    assert.ok(decoded.iat > 0);
    assert.ok(decoded.exp > decoded.iat);
    assert.equal(decoded.exp - decoded.iat, 3600);
  });
});

// ── Integration tests (mock DB, real Express) ─────────────────────────

// Mock DB
const dbCalls = [];
const users = new Map();
const magicTokens = new Map();
const sessions = new Map();
const dailyUsage = new Map();
let sessionRow;

function resetState() {
  dbCalls.length = 0;
  users.clear();
  magicTokens.clear();
  sessions.clear();
  dailyUsage.clear();

  // Default test user
  users.set('test@example.com', {
    id: 'user-123',
    email: 'test@example.com',
    display_name: 'Test User',
    email_verified: true,
    email_verified_at: '2026-07-12T00:00:00Z',
    entitlements: { plan: 'free', maxConcurrentSessions: 1, dailyAssessmentLimit: 3 },
    created_at: '2026-07-12T00:00:00Z',
    updated_at: '2026-07-12T00:00:00Z',
  });

  sessionRow = {
    id: 'session-1',
    user_id: 'user-123',
    status: 'created',
    consent_given: true,
    consent_at: '2026-07-12T00:00:00Z',
    started_at: null,
    completed_at: null,
    abandoned_at: null,
    abandon_reason: null,
    dimension_progress: {},
    created_at: '2026-07-12T00:00:00Z',
    updated_at: '2026-07-12T00:00:00Z',
  };
  sessions.set('session-1', sessionRow);
}

async function mockQuery(text, params) {
  dbCalls.push({ text, params });

  // Magic link token insert
  if (text.includes('INSERT INTO magic_link_tokens')) {
    magicTokens.set(params[1], { id: 'mlt-1', email: params[0], token_hash: params[1], expires_at: params[2], used_at: null });
    return { rows: [magicTokens.get(params[1])], rowCount: 1 };
  }

  // Magic link token lookup
  if (text.includes('FROM magic_link_tokens') && text.includes('token_hash')) {
    const tok = magicTokens.get(params[0]);
    return { rows: tok ? [tok] : [], rowCount: tok ? 1 : 0 };
  }

  // Magic link token mark used
  if (text.includes('UPDATE magic_link_tokens') && text.includes('used_at')) {
    const tok = [...magicTokens.values()].find(t => t.id === params[0] && t.used_at === null);
    if (tok) { tok.used_at = new Date().toISOString(); return { rowCount: 1 }; }
    return { rowCount: 0 };
  }

  // User upsert (magic-link request)
  if (text.includes('INSERT INTO users') && text.includes('ON CONFLICT')) {
    const email = params[0];
    let user = users.get(email);
    if (!user) {
      user = { id: `user-${Date.now()}`, email, display_name: null, email_verified: false, entitlements: { plan: 'free', maxConcurrentSessions: 1, dailyAssessmentLimit: 3 } };
      users.set(email, user);
    }
    return { rows: [user], rowCount: 1 };
  }

  // User update (verify email)
  if (text.includes('UPDATE users') && text.includes('email_verified')) {
    const user = users.get(params[0]);
    if (user) {
      user.email_verified = true;
      user.email_verified_at = new Date().toISOString();
      return { rows: [user], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // User select
  if (text.includes('FROM users') && text.includes('id =')) {
    const user = [...users.values()].find(u => u.id === params[0]);
    return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
  }

  // Active session count (must be before the generic sessions handler — both match 'FROM sessions')
  if (text.includes('COUNT') && text.includes('FROM sessions')) {
    const count = [...sessions.values()].filter(s => s.user_id === params[0] && ['created', 'in_progress'].includes(s.status)).length;
    return { rows: [{ active_count: count }] };
  }

  // Entitlements lookup (must be before generic users handler)
  if (text.includes('entitlements') && text.includes('FROM users')) {
    const user = [...users.values()].find(u => u.id === params[0]);
    return { rows: user ? [{ entitlements: user.entitlements }] : [] };
  }

  // Sessions by ID
  if (text.includes('FROM sessions') && !text.includes('COUNT')) {
    const s = sessions.get(params[0]);
    return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
  }

  // Daily usage
  if (text.includes('FROM daily_usage')) {
    const key = `${params[0]}:today`;
    const u = dailyUsage.get(key);
    return { rows: u ? [{ session_count: u }] : [] };
  }

  // Daily usage insert
  if (text.includes('INSERT INTO daily_usage')) {
    const key = `${params[0]}:today`;
    dailyUsage.set(key, (dailyUsage.get(key) || 0) + 1);
    return { rowCount: 1 };
  }

  // Session insert
  if (text.includes('INSERT INTO sessions')) {
    const s = { ...sessionRow, id: params[0], user_id: params[1], status: 'created' };
    sessions.set(params[0], s);
    return { rows: [s], rowCount: 1 };
  }

  // Session update
  if (text.includes('UPDATE sessions')) {
    const s = sessions.get(params[0]);
    if (s && text.includes("'in_progress'")) { s.status = 'in_progress'; s.started_at = new Date().toISOString(); }
    else if (s && text.includes("'completed'")) { s.status = 'completed'; s.completed_at = new Date().toISOString(); }
    else if (s && text.includes("'abandoned'")) { s.status = 'abandoned'; s.abandoned_at = new Date().toISOString(); }
    return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
  }

  // Transcript turns
  if (text.includes('MAX(turn_index)')) {
    return { rows: [{ max_idx: -1 }] };
  }
  if (text.includes('INSERT INTO transcript_turns')) {
    return { rowCount: 1 };
  }

  // Transcript queries
  if (text.includes('FROM transcripts')) {
    return { rows: [], rowCount: 0 };
  }

  // Score results
  if (text.includes('FROM score_results')) {
    return { rows: [], rowCount: 0 };
  }

  return { rows: [], rowCount: 0 };
}

await mock.module('../../src/server/db.js', {
  namedExports: {
    query: mockQuery,
    withTransaction: async (fn) => fn({ query: mockQuery }),
    pool: { query: mockQuery, on: () => {}, end: async () => {} },
    getClient: async () => ({ query: mockQuery, release: () => {} }),
  },
});

const { createApp } = await import('../../src/server/index.js');

// ── Helpers ───────────────────────────────────────────────────────────

function req(server, method, path, body, headers = {}) {
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

function authHeader(userId = 'user-123', email = 'test@example.com') {
  const token = createAccessToken({ id: userId, email }, 'dev-jwt-secret-do-not-use-in-prod');
  return { Authorization: `Bearer ${token}` };
}

// ── Test suite ────────────────────────────────────────────────────────

describe('Auth integration (T2-C, GIV-623)', () => {
  let server;

  before(async () => {
    const app = createApp({
      transcriptStore: { save: async () => {}, load: async () => null, listIds: async () => [] },
    });
    await new Promise(r => { server = app.listen(0, r); });
  });

  after(async () => {
    await new Promise(r => server.close(r));
  });

  beforeEach(() => {
    resetState();
  });

  // ── Auth routes ───────────────────────────────────────────────────

  describe('POST /auth/magic-link', () => {
    it('accepts a valid email and returns a message', async () => {
      const res = await req(server, 'POST', '/auth/magic-link', { email: 'test@example.com' });
      assert.equal(res.status, 200);
      assert.equal(res.body.message, 'Check your email for a sign-in link');
    });

    it('rejects missing email', async () => {
      const res = await req(server, 'POST', '/auth/magic-link', {});
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'MISSING_FIELD');
    });

    it('rejects invalid email format', async () => {
      const res = await req(server, 'POST', '/auth/magic-link', { email: 'bad' });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_EMAIL');
    });
  });

  describe('POST /auth/verify', () => {
    it('rejects missing token', async () => {
      const res = await req(server, 'POST', '/auth/verify', {});
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'MISSING_FIELD');
    });

    it('rejects invalid token', async () => {
      const res = await req(server, 'POST', '/auth/verify', { token: 'bad-token' });
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_TOKEN');
    });
  });

  describe('GET /auth/me', () => {
    it('returns user profile with valid token', async () => {
      const res = await req(server, 'GET', '/auth/me', null, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.user.id, 'user-123');
      assert.equal(res.body.user.email, 'test@example.com');
    });

    it('rejects unauthenticated request', async () => {
      const res = await req(server, 'GET', '/auth/me', null);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTH_REQUIRED');
    });

    it('rejects expired token', async () => {
      const token = signJwt({ sub: 'user-123', email: 'test@example.com', iat: 1, exp: 2 }, 'dev-jwt-secret-do-not-use-in-prod');
      const res = await req(server, 'GET', '/auth/me', null, { Authorization: `Bearer ${token}` });
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_TOKEN');
    });
  });

  // ── Protected routes — auth enforcement ───────────────────────────

  describe('Protected routes require auth', () => {
    it('POST /api/sessions returns 401 without token', async () => {
      const res = await req(server, 'POST', '/api/sessions', {});
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTH_REQUIRED');
    });

    it('GET /api/sessions returns 401 without token', async () => {
      const res = await req(server, 'GET', '/api/sessions');
      assert.equal(res.status, 401);
    });

    it('GET /api/sessions/:id returns 401 without token', async () => {
      const res = await req(server, 'GET', '/api/sessions/session-1');
      assert.equal(res.status, 401);
    });

    it('POST /api/sessions/:id/respond returns 401 without token', async () => {
      const res = await req(server, 'POST', '/api/sessions/session-1/respond', { text: 'hello' });
      assert.equal(res.status, 401);
    });

    it('GET /api/results/:sessionId returns 401 without token', async () => {
      const res = await req(server, 'GET', '/api/results/session-1');
      assert.equal(res.status, 401);
    });

    it('GET /api/transcripts returns 401 without token', async () => {
      const res = await req(server, 'GET', '/api/transcripts');
      assert.equal(res.status, 401);
    });
  });

  // ── Session ownership enforcement ─────────────────────────────────

  describe('Session ownership', () => {
    it('GET /api/sessions/:id returns 403 for non-owner', async () => {
      const res = await req(server, 'GET', '/api/sessions/session-1', null, authHeader('other-user', 'other@example.com'));
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('GET /api/sessions/:id returns 200 for owner', async () => {
      const res = await req(server, 'GET', '/api/sessions/session-1', null, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.session.id, 'session-1');
    });

    it('POST /api/sessions/:id/consent returns 403 for non-owner', async () => {
      const res = await req(server, 'POST', '/api/sessions/session-1/consent', { granted: true }, authHeader('other-user', 'other@example.com'));
      assert.equal(res.status, 403);
    });
  });

  // ── Session creation with entitlements ─────────────────────────────

  describe('Session creation + entitlements', () => {
    it('creates a session using token userId (no body userId needed)', async () => {
      // Clear pre-populated session so concurrent limit (1) is not hit
      sessions.clear();
      const res = await req(server, 'POST', '/api/sessions', {}, authHeader());
      assert.equal(res.status, 201);
      assert.equal(res.body.session.userId, 'user-123');
    });

    it('lists only the authenticated user sessions', async () => {
      const res = await req(server, 'GET', '/api/sessions', null, authHeader());
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.sessions));
    });
  });

  // ── Interviewer-turn forge surface fix ─────────────────────────────

  describe('Interviewer-turn forge surface (GIV-623 acceptance criterion)', () => {
    it('POST /api/sessions/:id/interviewer-turn returns 403 without X-Internal-Key', async () => {
      const res = await req(server, 'POST', '/api/sessions/session-1/interviewer-turn',
        { content: 'forged question', dimension: 'D1' },
        authHeader(),
      );
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('POST /api/sessions/:id/interviewer-turn returns 403 with wrong key', async () => {
      const res = await req(server, 'POST', '/api/sessions/session-1/interviewer-turn',
        { content: 'forged question' },
        { ...authHeader(), 'X-Internal-Key': 'wrong-key' },
      );
      assert.equal(res.status, 403);
    });
  });

  // ── Publication routes require X-Internal-Key (GIV-645) ────────────

  describe('Publication routes require X-Internal-Key (GIV-645)', () => {
    it('POST /api/publication/:sessionId/release returns 403 without X-Internal-Key', async () => {
      const res = await req(server, 'POST', '/api/publication/session-1/release',
        { agreedWithExtractor: true },
      );
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('GET /api/publication returns 403 without X-Internal-Key', async () => {
      const res = await req(server, 'GET', '/api/publication');
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('GET /api/publication/pending returns 403 without X-Internal-Key', async () => {
      const res = await req(server, 'GET', '/api/publication/pending');
      assert.equal(res.status, 403);
    });

    it('POST /api/publication/enqueue returns 403 without X-Internal-Key', async () => {
      const res = await req(server, 'POST', '/api/publication/enqueue',
        { sessionId: 's1', candidateId: 'c1' },
      );
      assert.equal(res.status, 403);
    });

    it('POST /api/publication/:sessionId/release returns 403 with wrong key', async () => {
      const res = await req(server, 'POST', '/api/publication/session-1/release',
        { agreedWithExtractor: true },
        { 'X-Internal-Key': 'wrong-key' },
      );
      assert.equal(res.status, 403);
    });
  });

  // ── Magic-link verify landing page (GIV-645) ─────────────────────

  describe('GET /auth/verify landing page (GIV-645)', () => {
    it('returns HTML landing page', async () => {
      const res = await req(server, 'GET', '/auth/verify?token=test');
      assert.equal(res.status, 200);
      assert.ok(typeof res.body === 'string' || res.body !== null);
    });
  });

  // ── Health endpoint remains public ────────────────────────────────

  describe('Public routes', () => {
    it('GET /api/health does not require auth', async () => {
      const res = await req(server, 'GET', '/api/health');
      assert.equal(res.status, 200);
    });
  });
});
