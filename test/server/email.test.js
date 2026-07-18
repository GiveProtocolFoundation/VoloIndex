/**
 * Email adapter + magic-link route wiring tests (GIV-708)
 *
 * Tests that POST /auth/magic-link calls sendMagicLink with the correct
 * GET-landing URL (AUTH_BASE_URL/auth/verify?token=…) and correct recipient.
 *
 * The email module is mocked so tests run without a real RESEND_API_KEY.
 * See test/server/email-adapter.test.js for adapter unit tests.
 *
 * Run: node --experimental-test-module-mocks --test test/server/email.test.js
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── Shared state ───────────────────────────────────────────────────────

let emailCalls = [];
let mockSendMagicLink = async (to, url) => { emailCalls.push({ to, url }); };

// ── Mock DB ────────────────────────────────────────────────────────────

const users = new Map();
const magicTokens = new Map();

function resetState() {
  emailCalls = [];
  users.clear();
  magicTokens.clear();
  mockSendMagicLink = async (to, url) => { emailCalls.push({ to, url }); };
}

async function mockQuery(text, params) {
  if (text.includes('INSERT INTO magic_link_tokens')) {
    magicTokens.set(params[1], { id: 'mlt-1', email: params[0], token_hash: params[1], expires_at: params[2], used_at: null });
    return { rows: [magicTokens.get(params[1])], rowCount: 1 };
  }
  if (text.includes('INSERT INTO users') && text.includes('ON CONFLICT')) {
    const email = params[0];
    let user = users.get(email);
    if (!user) {
      user = { id: `user-${Date.now()}`, email, display_name: null, email_verified: false, entitlements: { plan: 'free' } };
      users.set(email, user);
    }
    return { rows: [user], rowCount: 1 };
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

await mock.module('../../src/server/email.js', {
  namedExports: {
    sendMagicLink: (to, url) => mockSendMagicLink(to, url),
  },
});

const { createApp } = await import('../../src/server/index.js');

// ── Helper ─────────────────────────────────────────────────────────────

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

// ── Tests ──────────────────────────────────────────────────────────────

describe('POST /auth/magic-link → sendMagicLink wiring (GIV-708)', () => {
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

  beforeEach(() => { resetState(); });

  it('calls sendMagicLink with recipient and GET-landing URL using AUTH_BASE_URL', async () => {
    const { config } = await import('../../src/server/config.js');
    const origBase = config.auth.baseUrl;
    config.auth.baseUrl = 'https://voloindex.org';

    const res = await req(server, 'POST', '/auth/magic-link', { email: 'user@example.com' });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Check your email for a sign-in link');

    assert.equal(emailCalls.length, 1, 'sendMagicLink must be called exactly once');
    const { to, url } = emailCalls[0];
    assert.equal(to, 'user@example.com', 'to must be the normalised email');
    assert.ok(
      url.startsWith('https://voloindex.org/auth/verify?token='),
      `magic-link URL must use AUTH_BASE_URL and point to GET /auth/verify; got: ${url}`,
    );

    config.auth.baseUrl = origBase;
  });

  it('normalises the email address (lowercases) before passing to sendMagicLink', async () => {
    const res = await req(server, 'POST', '/auth/magic-link', { email: 'User@Example.COM' });
    assert.equal(res.status, 200);
    assert.equal(emailCalls.length, 1);
    assert.equal(emailCalls[0].to, 'user@example.com', 'email must be lowercased');
  });

  it('calls sendMagicLink with host-based URL when AUTH_BASE_URL is unset', async () => {
    const { config } = await import('../../src/server/config.js');
    const origBase = config.auth.baseUrl;
    config.auth.baseUrl = '';

    const res = await req(server, 'POST', '/auth/magic-link', { email: 'other@example.com' });
    assert.equal(res.status, 200);
    assert.equal(emailCalls.length, 1);
    const { url } = emailCalls[0];
    assert.ok(url.includes('/auth/verify?token='), `URL must point to GET /auth/verify; got: ${url}`);

    config.auth.baseUrl = origBase;
  });

  it('returns 200 even when sendMagicLink throws (enumeration-safe response preserved)', async () => {
    mockSendMagicLink = async () => {
      throw Object.assign(new Error('Resend error'), { statusCode: 502, code: 'EMAIL_SEND_FAILED' });
    };

    const res = await req(server, 'POST', '/auth/magic-link', { email: 'user@example.com' });
    // Must not reveal account existence — 404/403 are forbidden responses here.
    assert.notEqual(res.status, 404, 'must not return 404 on email failure');
    assert.notEqual(res.status, 403, 'must not return 403 on email failure');
  });
});
