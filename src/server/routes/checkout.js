/**
 * Volo Index — PayPal Checkout Routes (GIV-711)
 *
 * POST /api/checkout           (requireAuth) → create PayPal order, return { orderID, approveUrl }
 * GET  /api/checkout/capture   (no auth)     → capture approved order, redirect to /app
 *
 * Returns 503 when PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not configured.
 *
 * Flow:
 *   1. Client POSTs bundle choice → server creates PayPal order → returns approveUrl
 *   2. Frontend redirects to approveUrl (PayPal hosted page)
 *   3. After payer approves, PayPal redirects to GET /api/checkout/capture?token=<orderId>
 *   4. Server captures the order → PayPal fires PAYMENT.CAPTURE.COMPLETED webhook → credits granted
 */

import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import * as paypalClient from '../paypal-client.js';

const router = Router();

function paypalConfigured() {
  return !!(config.paypal.clientId && config.paypal.clientSecret);
}

// ── POST /api/checkout — create PayPal order ──────────────────────────

router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (!paypalConfigured()) {
      throw new AppError(
        'Payments are not configured — contact support',
        503, 'PAYMENTS_NOT_CONFIGURED',
      );
    }

    const { bundle } = req.body;
    const credits = Number(bundle);

    if (![1, 3, 10].includes(credits)) {
      throw new AppError(
        'Invalid bundle — choose 1, 3, or 10',
        400, 'INVALID_BUNDLE',
      );
    }

    const baseUrl = config.auth.baseUrl || `${req.protocol}://${req.get('host')}`;
    const { orderID, approveUrl } = await paypalClient.createOrder(req.user.id, credits, baseUrl);

    res.json({ orderID, approveUrl });
  } catch (err) { next(err); }
});

// ── GET /api/checkout/capture — PayPal return redirect ─────────────────
//
// PayPal redirects here after the payer approves the order.
// Query params set by PayPal: ?token=<orderId>&PayerID=<payerId>
// No auth required — this is an external redirect from PayPal.

router.get('/capture', async (req, res) => {
  const baseUrl = config.auth.baseUrl || `${req.protocol}://${req.get('host')}`;
  const orderId = req.query.token;

  if (!orderId) {
    return res.redirect(`${baseUrl}/app?purchase=cancelled`);
  }

  if (!paypalConfigured()) {
    return res.redirect(`${baseUrl}/app?purchase=error`);
  }

  try {
    await paypalClient.captureOrder(orderId);
    res.redirect(`${baseUrl}/app?purchase=success`);
  } catch (err) {
    console.error('[paypal-capture] capture failed:', err.message);
    res.redirect(`${baseUrl}/app?purchase=error`);
  }
});

export default router;
