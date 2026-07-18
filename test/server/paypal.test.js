/**
 * PayPal Checkout + Webhook tests (GIV-711)
 *
 * Covers: order creation, capture redirect, webhook signature verification,
 * idempotent double-delivery, grant math, 503 when unconfigured.
 *
 * Run: node --experimental-test-module-mocks --test test/server/paypal.test.js
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── In-memory state ──────────────────────────────────────────────────

const users = new Map();
const sessions = new Map();
const ledger = [];

function resetState() {
  users.clear();
  sessions.clear();
  ledger.length = 0;

  users.set('user-1', {
    id: 'user-1',
    email: 'buyer@example.com',
    display_name: 'Test Buyer',
    email_verified: true,
    entitlements: { plan: 'free', maxConcurrentSessions: 1, dailyAssessmentLimit: 3 },
    created_at: '2026-07-18T00:00:00Z',
    updated_at: '2026-07-18T00:00:00Z',
  });
}

function userBalance(userId) {
  return ledger
    .filter(e => e.user_id === userId)
    .reduce((sum, e) => sum + e.delta, 0);
}

// ── Mock DB ──────────────────────────────────────────────────────────

async function mockQuery(text, params) {
  if (text.includes('SUM(delta)') && text.includes('credits_ledger')) {
    return { rows: [{ balance: userBalance(params[0]) }] };
  }

  if (text.includes('INSERT INTO credits_ledger') && text.includes("'purchase'")) {
    const existing = ledger.find(e => e.provider_ref === params[2]);
    if (existing) {
      const err = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      err.constraint = 'idx_credits_ledger_provider_ref';
      throw err;
    }
    const entry = {
      id: `ledger-${ledger.length + 1}`,
      user_id: params[0], delta: params[1], reason: 'purchase',
      session_id: null, provider_ref: params[2],
      created_at: new Date().toISOString(),
    };
    ledger.push(entry);
    return { rows: [entry], rowCount: 1 };
  }

  if (text.includes('INSERT INTO credits_ledger') && text.includes("'grant'")) {
    const entry = {
      id: `ledger-${ledger.length + 1}`,
      user_id: params[0], delta: params[1], reason: 'grant',
      session_id: null, provider_ref: null,
      created_at: new Date().toISOString(),
    };
    ledger.push(entry);
    return { rows: [entry], rowCount: 1 };
  }

  if (text.includes('INSERT INTO credits_ledger') && text.includes("'debit'")) {
    const entry = {
      id: `ledger-${ledger.length + 1}`,
      user_id: params[0], delta: -1, reason: 'debit',
      session_id: params[1], provider_ref: null,
      created_at: new Date().toISOString(),
    };
    ledger.push(entry);
    return { rows: [entry], rowCount: 1 };
  }

  if (text.includes('pg_advisory_xact_lock')) return { rows: [] };

  if (text.includes('FROM sessions') && text.includes('id =') && !text.includes('COUNT')) {
    const s = sessions.get(params[0]);
    return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
  }

  if (text.includes('COUNT') && text.includes('FROM sessions')) {
    return { rows: [{ active_count: 0 }] };
  }

  if (text.includes('entitlements') && text.includes('FROM users')) {
    const u = [...users.values()].find(u => u.id === params[0]);
    return { rows: u ? [{ entitlements: u.entitlements }] : [] };
  }

  if (text.includes('FROM users') && text.includes('id =')) {
    const u = [...users.values()].find(u => u.id === params[0]);
    return { rows: u ? [u] : [] };
  }

  if (text.includes('FROM daily_usage')) return { rows: [] };
  if (text.includes('INSERT INTO daily_usage')) return { rowCount: 1 };

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

  if (text.includes('UPDATE sessions')) return { rows: [], rowCount: 0 };
  if (text.includes('MAX(turn_index)')) return { rows: [{ max_idx: -1 }] };
  if (text.includes('INSERT INTO transcript_turns')) return { rowCount: 1 };
  if (text.includes('FROM transcript_turns')) return { rows: [] };
  if (text.includes('FROM certificates')) return { rows: [] };
  if (text.includes('FROM score_results')) return { rows: [] };
  if (text.includes('FROM transcripts')) return { rows: [] };

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

// ── Mock PayPal client ────────────────────────────────────────────────

const TEST_ORDER_ID = 'PAYPAL-ORDER-TEST-123';
const TEST_APPROVE_URL = 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-TEST-123';

let lastCreateOrderArgs = null;
let lastCaptureOrderId = null;
let webhookVerifyResult = true;  // controlled per-test

await mock.module('../../src/server/paypal-client.js', {
  namedExports: {
    createOrder: async (userId, credits, baseUrl) => {
      lastCreateOrderArgs = { userId, credits, baseUrl };
      return { orderID: TEST_ORDER_ID, approveUrl: TEST_APPROVE_URL };
    },
    captureOrder: async (orderId) => {
      lastCaptureOrderId = orderId;
      return { status: 'COMPLETED', id: `CAPTURE-${orderId}` };
    },
    verifyWebhook: async (_body, headers) => {
      // Controlled by webhookVerifyResult; also honour test header
      if (headers['paypal-transmission-id'] === 'invalid-sig') return false;
      return webhookVerifyResult;
    },
    getAccessToken: async () => 'test-access-token',
  },
});

// ── Configure PayPal via config ───────────────────────────────────────

const { config } = await import('../../src/server/config.js');

function enablePayPal() {
  config.paypal.clientId = 'test-client-id';
  config.paypal.clientSecret = 'test-client-secret';
  config.paypal.webhookId = 'test-webhook-id';
}

function disablePayPal() {
  config.paypal.clientId = '';
  config.paypal.clientSecret = '';
  config.paypal.webhookId = '';
}

const { createApp } = await import('../../src/server/index.js');

// ── Helpers ──────────────────────────────────────────────────────────

import { createAccessToken } from '../../src/server/auth/jwt.js';

function request(server, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const hdrs = { ...headers };
    if (body && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      hdrs['Content-Type'] = 'application/json';
    }
    const r = http.request({ hostname: '127.0.0.1', port, path, method, headers: hdrs }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: d ? JSON.parse(d) : null,
            headers: res.headers,
          });
        } catch {
          resolve({ status: res.statusCode, body: d, headers: res.headers });
        }
      });
    });
    r.on('error', reject);
    if (body) {
      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        r.write(body);
      } else {
        r.write(JSON.stringify(body));
      }
    }
    r.end();
  });
}

function authHeader(userId = 'user-1', email = 'buyer@example.com') {
  const token = createAccessToken({ id: userId, email }, 'dev-jwt-secret-do-not-use-in-prod');
  return { Authorization: `Bearer ${token}` };
}

function captureEvent(captureId, userId, amountValue, eventId) {
  const event = {
    id: eventId || `WH-${Math.random().toString(36).slice(2)}`,
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: captureId,
      custom_id: userId,
      amount: { currency_code: 'USD', value: amountValue },
      status: 'COMPLETED',
    },
  };
  return JSON.stringify(event);
}

function validWebhookHeaders() {
  return {
    'Content-Type': 'application/json',
    'paypal-transmission-id': 'valid-transmission-id',
    'paypal-transmission-time': new Date().toISOString(),
    'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/test',
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-transmission-sig': 'test-sig',
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('PayPal Checkout (GIV-711)', () => {
  let server;

  before(async () => {
    const app = createApp({
      transcriptStore: { save: async () => {}, load: async () => null, listIds: async () => [] },
      llmAdapterFactory: () => ({ on: () => {}, begin: () => {}, grantConsent: () => {} }),
    });
    server = app.listen(0);
    await new Promise(r => server.on('listening', r));
  });

  after(() => new Promise(r => server.close(r)));

  beforeEach(() => {
    resetState();
    enablePayPal();
    lastCreateOrderArgs = null;
    lastCaptureOrderId = null;
    webhookVerifyResult = true;
  });

  // ── POST /api/checkout ─────────────────────────────────────────────

  describe('POST /api/checkout', () => {
    it('returns 401 without auth', async () => {
      const res = await request(server, 'POST', '/api/checkout', { bundle: 1 });
      assert.equal(res.status, 401);
    });

    it('returns 400 for invalid bundle', async () => {
      const res = await request(server, 'POST', '/api/checkout', { bundle: 5 }, authHeader());
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_BUNDLE');
    });

    it('returns 503 when PayPal is not configured', async () => {
      disablePayPal();
      const res = await request(server, 'POST', '/api/checkout', { bundle: 1 }, authHeader());
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, 'PAYMENTS_NOT_CONFIGURED');
    });

    it('returns orderID and approveUrl for bundle=1 ($19)', async () => {
      const res = await request(server, 'POST', '/api/checkout', { bundle: 1 }, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.orderID, TEST_ORDER_ID);
      assert.equal(res.body.approveUrl, TEST_APPROVE_URL);
      assert.equal(lastCreateOrderArgs.credits, 1);
      assert.equal(lastCreateOrderArgs.userId, 'user-1');
    });

    it('returns orderID and approveUrl for bundle=3 ($45)', async () => {
      const res = await request(server, 'POST', '/api/checkout', { bundle: 3 }, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.orderID, TEST_ORDER_ID);
      assert.equal(lastCreateOrderArgs.credits, 3);
    });

    it('returns orderID and approveUrl for bundle=10 ($120)', async () => {
      const res = await request(server, 'POST', '/api/checkout', { bundle: 10 }, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.orderID, TEST_ORDER_ID);
      assert.equal(lastCreateOrderArgs.credits, 10);
    });

    it('passes correct userId to createOrder', async () => {
      await request(server, 'POST', '/api/checkout', { bundle: 1 }, authHeader('user-1', 'buyer@example.com'));
      assert.equal(lastCreateOrderArgs.userId, 'user-1');
    });
  });

  // ── GET /api/checkout/capture ──────────────────────────────────────

  describe('GET /api/checkout/capture', () => {
    it('redirects to /app?purchase=success on valid token', async () => {
      const res = await request(server, 'GET', '/api/checkout/capture?token=PAYPAL-ORDER-123', null);
      assert.equal(res.status, 302);
      assert.ok(res.headers.location?.includes('purchase=success'), `location: ${res.headers.location}`);
      assert.equal(lastCaptureOrderId, 'PAYPAL-ORDER-123');
    });

    it('redirects to /app?purchase=cancelled when token is missing', async () => {
      const res = await request(server, 'GET', '/api/checkout/capture', null);
      assert.equal(res.status, 302);
      assert.ok(res.headers.location?.includes('purchase=cancelled'), `location: ${res.headers.location}`);
    });
  });

  // ── POST /api/webhooks/paypal ──────────────────────────────────────

  describe('POST /api/webhooks/paypal', () => {
    it('returns 503 when PayPal is not configured', async () => {
      disablePayPal();
      const payload = captureEvent('CAP-001', 'user-1', '19.00');
      const res = await request(server, 'POST', '/api/webhooks/paypal', payload, validWebhookHeaders());
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, 'PAYMENTS_NOT_CONFIGURED');
    });

    it('returns 400 with invalid signature', async () => {
      const payload = captureEvent('CAP-002', 'user-1', '19.00');
      const res = await request(server, 'POST', '/api/webhooks/paypal', payload, {
        ...validWebhookHeaders(),
        'paypal-transmission-id': 'invalid-sig',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_SIGNATURE');
    });

    it('acknowledges non-PAYMENT.CAPTURE.COMPLETED events', async () => {
      const payload = JSON.stringify({ event_type: 'PAYMENT.AUTHORIZATION.CREATED', resource: {} });
      const res = await request(server, 'POST', '/api/webhooks/paypal', payload, validWebhookHeaders());
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { received: true });
    });

    it('grants 1 credit for $19.00 capture', async () => {
      const captureId = 'CAP-19-001';
      const payload = captureEvent(captureId, 'user-1', '19.00');
      const res = await request(server, 'POST', '/api/webhooks/paypal', payload, validWebhookHeaders());
      assert.equal(res.status, 200);
      assert.equal(res.body.credits, 1);
      assert.equal(userBalance('user-1'), 1);
      assert.equal(ledger[0].reason, 'purchase');
      assert.equal(ledger[0].provider_ref, captureId);
    });

    it('grants 3 credits for $45.00 capture', async () => {
      const payload = captureEvent('CAP-45-001', 'user-1', '45.00');
      const res = await request(server, 'POST', '/api/webhooks/paypal', payload, validWebhookHeaders());
      assert.equal(res.status, 200);
      assert.equal(res.body.credits, 3);
      assert.equal(userBalance('user-1'), 3);
    });

    it('grants 10 credits for $120.00 capture', async () => {
      const payload = captureEvent('CAP-120-001', 'user-1', '120.00');
      const res = await request(server, 'POST', '/api/webhooks/paypal', payload, validWebhookHeaders());
      assert.equal(res.status, 200);
      assert.equal(res.body.credits, 10);
      assert.equal(userBalance('user-1'), 10);
    });

    it('handles idempotent double-delivery (same capture ID)', async () => {
      const captureId = 'CAP-DUP-001';
      const payload = captureEvent(captureId, 'user-1', '19.00');

      const res1 = await request(server, 'POST', '/api/webhooks/paypal', payload, validWebhookHeaders());
      assert.equal(res1.status, 200);
      assert.equal(res1.body.credits, 1);

      const res2 = await request(server, 'POST', '/api/webhooks/paypal', payload, validWebhookHeaders());
      assert.equal(res2.status, 200);
      assert.equal(res2.body.duplicate, true);

      assert.equal(userBalance('user-1'), 1);
      assert.equal(ledger.length, 1);
    });

    it('returns 400 when custom_id is missing', async () => {
      const event = JSON.stringify({
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: 'CAP-NO-USER', amount: { value: '19.00' } },
      });
      const res = await request(server, 'POST', '/api/webhooks/paypal', event, validWebhookHeaders());
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'MISSING_USER');
    });

    it('returns 400 for unknown amount', async () => {
      const event = JSON.stringify({
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: 'CAP-WEIRD', custom_id: 'user-1', amount: { value: '9.99' } },
      });
      const res = await request(server, 'POST', '/api/webhooks/paypal', event, validWebhookHeaders());
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'UNKNOWN_BUNDLE');
    });

    it('accumulates credits from multiple purchases', async () => {
      const p1 = captureEvent('CAP-MULTI-1', 'user-1', '45.00');
      await request(server, 'POST', '/api/webhooks/paypal', p1, validWebhookHeaders());

      const p2 = captureEvent('CAP-MULTI-2', 'user-1', '19.00');
      await request(server, 'POST', '/api/webhooks/paypal', p2, validWebhookHeaders());

      assert.equal(userBalance('user-1'), 4);
      assert.equal(ledger.length, 2);
    });

    it('webhook route processes request body as raw buffer', async () => {
      const payload = captureEvent('CAP-RAW-001', 'user-1', '19.00');
      const res = await request(server, 'POST', '/api/webhooks/paypal', payload, validWebhookHeaders());
      assert.equal(res.status, 200);
      assert.equal(res.body.credits, 1);
    });
  });
});
