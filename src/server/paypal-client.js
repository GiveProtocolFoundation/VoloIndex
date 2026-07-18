/**
 * Volo Index — PayPal REST API Client (GIV-711)
 *
 * Thin wrapper around PayPal Orders API v2 and Webhook Verification API.
 * Uses Node 18+ built-in fetch — no extra npm package required.
 *
 * Exported functions are imported by routes and can be mocked in tests
 * via mock.module('../../src/server/paypal-client.js', { namedExports: … }).
 */

import { config } from './config.js';

// ── OAuth token cache ─────────────────────────────────────────────────

let _cachedToken = null;
let _tokenExpiry = 0;

/**
 * Get a cached OAuth 2.0 access token via client credentials grant.
 * Refreshes automatically 60 s before expiry.
 */
export async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) {
    return _cachedToken;
  }

  const credentials = Buffer.from(
    `${config.paypal.clientId}:${config.paypal.clientSecret}`,
  ).toString('base64');

  const res = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`PayPal token request failed: ${res.status}`);
  }

  const data = await res.json();
  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in * 1000);
  return _cachedToken;
}

// ── Bundle → USD amount ───────────────────────────────────────────────

const BUNDLE_AMOUNTS = { 1: '19.00', 3: '45.00', 10: '120.00' };

/**
 * Create a PayPal Order for the given credit bundle.
 *
 * @param {string} userId  - stored in purchase_unit.custom_id for webhook lookup
 * @param {number} credits - 1 | 3 | 10
 * @param {string} baseUrl - e.g. https://voloindex.org
 * @returns {{ orderID: string, approveUrl: string }}
 */
export async function createOrder(userId, credits, baseUrl) {
  const token = await getAccessToken();
  const amount = BUNDLE_AMOUNTS[credits];
  if (!amount) throw new Error(`Unknown bundle: ${credits}`);

  const res = await fetch(`${config.paypal.baseUrl}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'USD', value: amount },
        custom_id: userId,
        description: `Volo Index — ${credits} evaluation credit${credits > 1 ? 's' : ''}`,
      }],
      application_context: {
        return_url: `${baseUrl}/api/checkout/capture`,
        cancel_url: `${baseUrl}/app?purchase=cancelled`,
        brand_name: 'Volo Index',
        user_action: 'PAY_NOW',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal create order failed: ${res.status} — ${err}`);
  }

  const order = await res.json();
  const approveLink = order.links?.find(l => l.rel === 'approve');
  if (!approveLink) throw new Error('PayPal order response missing approve link');

  return { orderID: order.id, approveUrl: approveLink.href };
}

/**
 * Capture a previously approved PayPal order.
 * Called from GET /api/checkout/capture after the payer returns from PayPal.
 *
 * @param {string} orderId - PayPal order ID (the `token` query param on return)
 * @returns {object} PayPal capture response
 */
export async function captureOrder(orderId) {
  const token = await getAccessToken();

  const res = await fetch(
    `${config.paypal.baseUrl}/v2/checkout/orders/${orderId}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal capture failed: ${res.status} — ${err}`);
  }

  return res.json();
}

/**
 * Verify a PayPal webhook event using the Webhook Verification API.
 *
 * @param {Buffer|string} rawBody - raw request body (from express.raw())
 * @param {object} headers        - req.headers (must include paypal-* verification headers)
 * @returns {boolean} true when verification_status === 'SUCCESS'
 */
export async function verifyWebhook(rawBody, headers) {
  const token = await getAccessToken();
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;

  const res = await fetch(
    `${config.paypal.baseUrl}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: config.paypal.webhookId,
        webhook_event: JSON.parse(body),
      }),
    },
  );

  if (!res.ok) return false;
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}
