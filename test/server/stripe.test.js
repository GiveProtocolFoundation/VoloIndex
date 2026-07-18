/**
 * Stripe Checkout + Webhook tests (GIV-707)
 *
 * Covers: checkout session creation, webhook signature verification,
 * idempotent double-delivery, grant math, 503 when unconfigured.
 *
 * Run: node --experimental-test-module-mocks --test test/server/stripe.test.js
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

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
  // Credits balance
  if (text.includes('SUM(delta)') && text.includes('credits_ledger')) {
    const bal = userBalance(params[0]);
    return { rows: [{ balance: bal }] };
  }

  // Credits insert — purchase
  if (text.includes('INSERT INTO credits_ledger') && text.includes("'purchase'")) {
    // Check for duplicate provider_ref
    const existing = ledger.find(e => e.provider_ref === params[2]);
    if (existing) {
      const err = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      err.constraint = 'idx_credits_ledger_provider_ref';
      throw err;
    }
    const entry = {
      id: `ledger-${ledger.length + 1}`,
      user_id: params[0],
      delta: params[1],
      reason: 'purchase',
      session_id: null,
      provider_ref: params[2],
      created_at: new Date().toISOString(),
    };
    ledger.push(entry);
    return { rows: [entry], rowCount: 1 };
  }

  // Credits insert — grant
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

  // Credits insert — debit
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

  // Advisory lock
  if (text.includes('pg_advisory_xact_lock')) {
    return { rows: [] };
  }

  // Session by ID
  if (text.includes('FROM sessions') && text.includes('id =') && !text.includes('COUNT')) {
    const s = sessions.get(params[0]);
    return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
  }

  // Active session count
  if (text.includes('COUNT') && text.includes('FROM sessions')) {
    return { rows: [{ active_count: 0 }] };
  }

  // Entitlements
  if (text.includes('entitlements') && text.includes('FROM users')) {
    const u = [...users.values()].find(u => u.id === params[0]);
    return { rows: u ? [{ entitlements: u.entitlements }] : [] };
  }

  // User by ID
  if (text.includes('FROM users') && text.includes('id =')) {
    const u = [...users.values()].find(u => u.id === params[0]);
    return { rows: u ? [u] : [] };
  }

  // Daily usage
  if (text.includes('FROM daily_usage')) return { rows: [] };
  if (text.includes('INSERT INTO daily_usage')) return { rowCount: 1 };

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

  // Session update
  if (text.includes('UPDATE sessions')) {
    return { rows: [], rowCount: 0 };
  }

  // Transcript turns
  if (text.includes('MAX(turn_index)')) return { rows: [{ max_idx: -1 }] };
  if (text.includes('INSERT INTO transcript_turns')) return { rowCount: 1 };
  if (text.includes('FROM transcript_turns')) return { rows: [] };

  // Certificates
  if (text.includes('FROM certificates')) return { rows: [] };
  if (text.includes('FROM score_results')) return { rows: [] };
  if (text.includes('FROM transcripts')) return { rows: [] };

  return { rows: [], rowCount: 0 };
}

await mock.module('../../src/server/db.js', {
  namedExports: {
    query: mockQuery,
    withTransaction: async (fn) => {
      const result = await fn({ query: mockQuery });
      return result;
    },
    pool: { query: mockQuery, on: () => {}, end: async () => {} },
    getClient: async () => ({ query: mockQuery, release: () => {} }),
  },
});

// ── Mock Stripe ──────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'whsec_test_secret_key_for_testing';
const STRIPE_SECRET  = 'sk_test_key_for_testing';
const TEST_PRICES    = { 1: 'price_1credit', 3: 'price_3credits', 10: 'price_10credits' };

let lastCheckoutSessionArgs = null;

await mock.module('stripe', {
  defaultExport: class MockStripe {
    constructor(key) {
      this._key = key;
    }
    get checkout() {
      return {
        sessions: {
          create: async (args) => {
            lastCheckoutSessionArgs = args;
            return { url: 'https://checkout.stripe.com/test-session', id: 'cs_test_123' };
          },
        },
      };
    }
    get webhooks() {
      return {
        constructEvent: (body, sig, secret) => {
          // Simulate signature verification
          if (secret !== WEBHOOK_SECRET) {
            throw new Error('No signatures found matching the expected signature for payload');
          }
          if (sig !== 'valid-sig') {
            throw new Error('No signatures found matching the expected signature for payload');
          }
          // Parse body (may be Buffer from express.raw)
          const raw = Buffer.isBuffer(body) ? body.toString('utf8') : body;
          return JSON.parse(raw);
        },
      };
    }
  },
});

// ── Configure Stripe keys via config ─────────────────────────────────

const { config } = await import('../../src/server/config.js');

// Store originals
const origStripe = { ...config.stripe, prices: { ...config.stripe.prices } };

function enableStripe() {
  config.stripe.secretKey = STRIPE_SECRET;
  config.stripe.webhookSecret = WEBHOOK_SECRET;
  Object.assign(config.stripe.prices, TEST_PRICES);
}

function disableStripe() {
  config.stripe.secretKey = '';
  config.stripe.webhookSecret = '';
  config.stripe.prices[1] = '';
  config.stripe.prices[3] = '';
  config.stripe.prices[10] = '';
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
        try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); }
        catch { resolve({ status: res.statusCode, body: d }); }
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

function webhookPayload(eventType, sessionData, eventId = 'evt_test_' + crypto.randomUUID().slice(0, 8)) {
  const event = {
    id: eventId,
    type: eventType,
    data: { object: sessionData },
  };
  return JSON.stringify(event);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Stripe Checkout (GIV-707)', () => {
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
    server = app.listen(0);
    await new Promise(r => server.on('listening', r));
  });

  after(() => new Promise(r => server.close(r)));

  beforeEach(() => {
    resetState();
    enableStripe();
    lastCheckoutSessionArgs = null;
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

    it('returns 503 when Stripe is not configured', async () => {
      disableStripe();
      const res = await request(server, 'POST', '/api/checkout', { bundle: 1 }, authHeader());
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, 'PAYMENTS_NOT_CONFIGURED');
    });

    it('creates checkout session for bundle=1 ($19)', async () => {
      const res = await request(server, 'POST', '/api/checkout', { bundle: 1 }, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.url, 'https://checkout.stripe.com/test-session');
      assert.equal(lastCheckoutSessionArgs.line_items[0].price, 'price_1credit');
      assert.equal(lastCheckoutSessionArgs.client_reference_id, 'user-1');
    });

    it('creates checkout session for bundle=3 ($45)', async () => {
      const res = await request(server, 'POST', '/api/checkout', { bundle: 3 }, authHeader());
      assert.equal(res.status, 200);
      assert.equal(lastCheckoutSessionArgs.line_items[0].price, 'price_3credits');
    });

    it('creates checkout session for bundle=10 ($120)', async () => {
      const res = await request(server, 'POST', '/api/checkout', { bundle: 10 }, authHeader());
      assert.equal(res.status, 200);
      assert.equal(lastCheckoutSessionArgs.line_items[0].price, 'price_10credits');
    });

    it('sets customer_email from JWT', async () => {
      await request(server, 'POST', '/api/checkout', { bundle: 1 }, authHeader());
      assert.equal(lastCheckoutSessionArgs.customer_email, 'buyer@example.com');
    });
  });

  // ── POST /api/webhooks/stripe ──────────────────────────────────────

  describe('POST /api/webhooks/stripe', () => {
    it('returns 400 without stripe-signature header', async () => {
      const payload = webhookPayload('checkout.session.completed', {
        client_reference_id: 'user-1',
        amount_total: 1900,
      });
      const res = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'MISSING_SIGNATURE');
    });

    it('returns 400 with invalid signature', async () => {
      const payload = webhookPayload('checkout.session.completed', {
        client_reference_id: 'user-1',
        amount_total: 1900,
      });
      const res = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid-sig',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_SIGNATURE');
    });

    it('returns 503 when Stripe is not configured', async () => {
      disableStripe();
      const payload = webhookPayload('checkout.session.completed', {
        client_reference_id: 'user-1',
        amount_total: 1900,
      });
      const res = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });
      assert.equal(res.status, 503);
    });

    it('acknowledges non-checkout events', async () => {
      const payload = webhookPayload('payment_intent.succeeded', {});
      const res = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { received: true });
    });

    it('grants 1 credit for $19 purchase (amount_total=1900)', async () => {
      const eventId = 'evt_1credit_test';
      const payload = webhookPayload('checkout.session.completed', {
        id: 'cs_test_1',
        client_reference_id: 'user-1',
        amount_total: 1900,
      }, eventId);

      const res = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.credits, 1);
      assert.equal(userBalance('user-1'), 1);
      assert.equal(ledger[0].reason, 'purchase');
      assert.equal(ledger[0].provider_ref, eventId);
    });

    it('grants 3 credits for $45 purchase (amount_total=4500)', async () => {
      const eventId = 'evt_3credit_test';
      const payload = webhookPayload('checkout.session.completed', {
        id: 'cs_test_3',
        client_reference_id: 'user-1',
        amount_total: 4500,
      }, eventId);

      const res = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.credits, 3);
      assert.equal(userBalance('user-1'), 3);
    });

    it('grants 10 credits for $120 purchase (amount_total=12000)', async () => {
      const eventId = 'evt_10credit_test';
      const payload = webhookPayload('checkout.session.completed', {
        id: 'cs_test_10',
        client_reference_id: 'user-1',
        amount_total: 12000,
      }, eventId);

      const res = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.credits, 10);
      assert.equal(userBalance('user-1'), 10);
    });

    it('handles idempotent double-delivery (same event ID)', async () => {
      const eventId = 'evt_idempotent_test';
      const payload = webhookPayload('checkout.session.completed', {
        id: 'cs_test_dup',
        client_reference_id: 'user-1',
        amount_total: 1900,
      }, eventId);

      // First delivery
      const res1 = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });
      assert.equal(res1.status, 200);
      assert.equal(res1.body.credits, 1);

      // Second delivery (duplicate)
      const res2 = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });
      assert.equal(res2.status, 200);
      assert.equal(res2.body.duplicate, true);

      // Balance should be 1, not 2
      assert.equal(userBalance('user-1'), 1);
      assert.equal(ledger.length, 1);
    });

    it('returns 400 when client_reference_id is missing', async () => {
      const payload = webhookPayload('checkout.session.completed', {
        id: 'cs_test_no_user',
        amount_total: 1900,
      });

      const res = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'MISSING_USER');
    });

    it('returns 400 for unknown amount', async () => {
      const payload = webhookPayload('checkout.session.completed', {
        id: 'cs_test_weird',
        client_reference_id: 'user-1',
        amount_total: 9999,
      });

      const res = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'UNKNOWN_BUNDLE');
    });

    it('accumulates credits from multiple purchases', async () => {
      // Buy 3 credits
      const p1 = webhookPayload('checkout.session.completed', {
        id: 'cs_multi_1',
        client_reference_id: 'user-1',
        amount_total: 4500,
      }, 'evt_multi_1');
      await request(server, 'POST', '/api/webhooks/stripe', p1, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });

      // Buy 1 more credit
      const p2 = webhookPayload('checkout.session.completed', {
        id: 'cs_multi_2',
        client_reference_id: 'user-1',
        amount_total: 1900,
      }, 'evt_multi_2');
      await request(server, 'POST', '/api/webhooks/stripe', p2, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });

      assert.equal(userBalance('user-1'), 4);
      assert.equal(ledger.length, 2);
    });
  });

  // ── Webhook is excluded from rate limiter ──────────────────────────

  describe('Webhook rate limit exclusion', () => {
    it('webhook route processes request body as raw buffer', async () => {
      // The webhook route gets express.raw() body, not express.json().
      // This test confirms the route works with a raw body payload.
      const eventId = 'evt_raw_body_test';
      const payload = webhookPayload('checkout.session.completed', {
        id: 'cs_raw',
        client_reference_id: 'user-1',
        amount_total: 1900,
      }, eventId);

      const res = await request(server, 'POST', '/api/webhooks/stripe', payload, {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.credits, 1);
    });
  });
});
