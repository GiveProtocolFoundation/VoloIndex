/**
 * Account / DSAR endpoint tests (GIV-743)
 *
 * Covers: DELETE /api/account (with/without confirmation),
 * GET /api/account/export, PATCH /api/account (rectification),
 * POST /api/internal/dsar/erase, and auth guards.
 *
 * Run: node --test test/server/account.test.js
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── Stub DB module before importing routes ──────────────────────────

let users, sessions, creditsLedger, authSessions, dailyUsage, magicLinkTokens;
let transcriptTurns, transcripts, scoreResults, certificates;

function resetTables() {
  users = [
    {
      id: 'user-1', email: 'alice@example.com', display_name: 'Alice',
      email_verified: true, email_verified_at: new Date(),
      entitlements: { plan: 'free', maxConcurrentSessions: 1, dailyAssessmentLimit: 3 },
      age_attested_at: new Date(), created_at: new Date(), updated_at: new Date(),
      last_active_at: new Date(), erased_at: null,
    },
  ];
  sessions = [];
  creditsLedger = [];
  authSessions = [];
  dailyUsage = [];
  magicLinkTokens = [];
  transcriptTurns = [];
  transcripts = [];
  scoreResults = [];
  certificates = [];
}

// Mock db module
const mockQuery = async (sql, params) => {
  const text = sql.replace(/\s+/g, ' ').trim();

  if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
    return { rows: [], rowCount: 0 };
  }

  if (text.includes('FROM users WHERE id') && text.includes('FOR UPDATE')) {
    const user = users.find(u => u.id === params[0]);
    return { rows: user ? [user] : [] };
  }
  if (text.includes('FROM users WHERE id') && !text.includes('FOR UPDATE')) {
    const user = users.find(u => u.id === params[0]);
    return { rows: user ? [user] : [] };
  }
  if (text.includes('FROM users WHERE email')) {
    const user = users.find(u => u.email === params[0]);
    return { rows: user ? [user] : [] };
  }
  if (text.includes('DELETE FROM sessions WHERE user_id')) {
    sessions = sessions.filter(s => s.user_id !== params[0]);
    return { rowCount: 0 };
  }
  if (text.includes('DELETE FROM auth_sessions WHERE user_id')) {
    authSessions = authSessions.filter(s => s.user_id !== params[0]);
    return { rowCount: 0 };
  }
  if (text.includes('DELETE FROM daily_usage WHERE user_id')) {
    dailyUsage = dailyUsage.filter(d => d.user_id !== params[0]);
    return { rowCount: 0 };
  }
  if (text.includes('DELETE FROM magic_link_tokens WHERE email')) {
    magicLinkTokens = magicLinkTokens.filter(t => t.email !== params[0]);
    return { rowCount: 0 };
  }
  if (text.includes('UPDATE credits_ledger SET subject_key')) {
    for (const row of creditsLedger) {
      if (row.user_id === params[0]) {
        row.subject_key = params[1];
        row.user_id = null;
      }
    }
    return { rowCount: 0 };
  }
  // PATCH rectification (must precede tombstone match — both contain 'erased_at')
  if (text.includes('UPDATE users SET display_name')) {
    const user = users.find(u => u.id === params[0] && !u.erased_at);
    if (user) {
      user.display_name = params[1];
      return { rows: [user] };
    }
    return { rows: [] };
  }
  if (text.includes('UPDATE users SET') && text.includes('erased_at')) {
    const user = users.find(u => u.id === params[0]);
    if (user) {
      user.email = params[1];
      user.display_name = null;
      user.email_verified = false;
      user.erased_at = new Date();
    }
    return { rowCount: user ? 1 : 0 };
  }
  if (text.includes('UPDATE auth_sessions SET revoked_at')) {
    return { rowCount: 0 };
  }
  // Export queries
  if (text.includes('FROM sessions WHERE user_id')) {
    return { rows: sessions.filter(s => s.user_id === params[0]) };
  }
  if (text.includes('FROM transcript_turns WHERE session_id = ANY')) {
    return { rows: transcriptTurns.filter(t => (params[0] || []).includes(t.session_id)) };
  }
  if (text.includes('FROM transcripts WHERE session_id = ANY')) {
    return { rows: transcripts.filter(t => (params[0] || []).includes(t.session_id)) };
  }
  if (text.includes('FROM score_results WHERE session_id = ANY')) {
    return { rows: scoreResults.filter(sr => (params[0] || []).includes(sr.session_id)) };
  }
  if (text.includes('FROM certificates WHERE session_id = ANY')) {
    return { rows: certificates.filter(c => (params[0] || []).includes(c.session_id)) };
  }
  if (text.includes('FROM credits_ledger WHERE user_id')) {
    return { rows: creditsLedger.filter(c => c.user_id === params[0]) };
  }

  return { rows: [], rowCount: 0 };
};

const mockPool = {
  async connect() {
    return {
      async query(sql, params) { return mockQuery(sql, params); },
      release() { /* no-op */ },
    };
  },
  async query(sql, params) { return mockQuery(sql, params); },
};

// Mock the db and config modules before importing the routes
await mock.module('../../src/server/db.js', {
  namedExports: {
    pool: mockPool,
    query: mockQuery,
    getClient: async () => (await mockPool.connect()),
    withTransaction: async (fn) => {
      const client = await mockPool.connect();
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  },
});

await mock.module('../../src/server/config.js', {
  namedExports: {
    config: {
      auth: {
        jwtSecret: 'test-secret',
        internalKey: 'test-internal-key',
      },
    },
  },
});

// Import after mocking
const { signJwt } = await import('../../src/server/auth/jwt.js');
const express = (await import('express')).default;
const { accountRoutes, dsarRoutes } = await import('../../src/server/routes/account.js');
const { requireAuth, requireInternal } = await import('../../src/server/middleware/auth.js');

// ── Test app setup ──────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/account', requireAuth, accountRoutes);
  app.use('/api/internal/dsar', requireInternal, dsarRoutes);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: { message: err.message } });
  });
  return app;
}

function makeToken(userId = 'user-1', email = 'alice@example.com') {
  return signJwt({ sub: userId, email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, 'test-secret');
}

function request(app, method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const data = body ? JSON.stringify(body) : undefined;
      const hdrs = { 'Content-Type': 'application/json', ...headers };
      if (data) hdrs['Content-Length'] = Buffer.byteLength(data);
      const opts = {
        hostname: '127.0.0.1', port, path, method,
        headers: hdrs,
      };

      const req = http.request(opts, (res) => {
        let chunks = '';
        res.on('data', (d) => { chunks += d; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(chunks) });
          } catch {
            resolve({ status: res.statusCode, body: chunks });
          }
        });
      });

      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('DELETE /api/account', () => {
  beforeEach(() => resetTables());

  it('requires authentication', async () => {
    const app = createTestApp();
    const res = await request(app, 'DELETE', '/api/account', { body: { confirm: true } });
    assert.equal(res.status, 401);
  });

  it('requires { confirm: true }', async () => {
    const app = createTestApp();
    const token = makeToken();
    const res = await request(app, 'DELETE', '/api/account', {
      body: {},
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'CONFIRMATION_REQUIRED');
  });

  it('erases the account on confirm', async () => {
    const app = createTestApp();
    const token = makeToken();
    const res = await request(app, 'DELETE', '/api/account', {
      body: { confirm: true },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.erased, true);
    assert.notEqual(users[0].erased_at, null);
  });
});

describe('GET /api/account/export', () => {
  beforeEach(() => resetTables());

  it('requires authentication', async () => {
    const app = createTestApp();
    const res = await request(app, 'GET', '/api/account/export');
    assert.equal(res.status, 401);
  });

  it('returns a data export bundle', async () => {
    const app = createTestApp();
    const token = makeToken();
    const res = await request(app, 'GET', '/api/account/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.exportedAt);
    assert.equal(res.body.user.id, 'user-1');
    assert.ok(Array.isArray(res.body.sessions));
    assert.ok(Array.isArray(res.body.transcriptTurns));
    assert.ok(Array.isArray(res.body.creditsLedger));
  });
});

describe('PATCH /api/account', () => {
  beforeEach(() => resetTables());

  it('requires authentication', async () => {
    const app = createTestApp();
    const res = await request(app, 'PATCH', '/api/account', { body: { display_name: 'Bob' } });
    assert.equal(res.status, 401);
  });

  it('requires display_name field', async () => {
    const app = createTestApp();
    const token = makeToken();
    const res = await request(app, 'PATCH', '/api/account', {
      body: {},
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MISSING_FIELD');
  });

  it('updates display_name', async () => {
    const app = createTestApp();
    const token = makeToken();
    const res = await request(app, 'PATCH', '/api/account', {
      body: { display_name: 'Bob' },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.updated, true);
  });

  it('sanitises HTML from display_name', async () => {
    const app = createTestApp();
    const token = makeToken();
    const res = await request(app, 'PATCH', '/api/account', {
      body: { display_name: '<script>alert(1)</script>Bob' },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(users[0].display_name, 'scriptalert(1)/scriptBob');
  });
});

describe('POST /api/internal/dsar/erase', () => {
  beforeEach(() => resetTables());

  it('requires internal key', async () => {
    const app = createTestApp();
    const res = await request(app, 'POST', '/api/internal/dsar/erase', {
      body: { userId: 'user-1' },
    });
    assert.equal(res.status, 403);
  });

  it('requires email or userId', async () => {
    const app = createTestApp();
    const res = await request(app, 'POST', '/api/internal/dsar/erase', {
      body: {},
      headers: { 'X-Internal-Key': 'test-internal-key' },
    });
    assert.equal(res.status, 400);
  });

  it('erases by userId', async () => {
    const app = createTestApp();
    const res = await request(app, 'POST', '/api/internal/dsar/erase', {
      body: { userId: 'user-1' },
      headers: { 'X-Internal-Key': 'test-internal-key' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.erased, true);
  });

  it('erases by email', async () => {
    const app = createTestApp();
    const res = await request(app, 'POST', '/api/internal/dsar/erase', {
      body: { email: 'alice@example.com' },
      headers: { 'X-Internal-Key': 'test-internal-key' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.erased, true);
  });

  it('returns 404 for unknown email', async () => {
    const app = createTestApp();
    const res = await request(app, 'POST', '/api/internal/dsar/erase', {
      body: { email: 'nobody@example.com' },
      headers: { 'X-Internal-Key': 'test-internal-key' },
    });
    assert.equal(res.status, 404);
  });
});
