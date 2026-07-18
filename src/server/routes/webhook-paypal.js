/**
 * Volo Index — PayPal Webhook Route (GIV-711)
 *
 * POST /api/webhooks/paypal — verify PayPal webhook signature, handle
 * PAYMENT.CAPTURE.COMPLETED → insert credits_ledger 'purchase' row.
 *
 * IMPORTANT: this route needs the RAW body for signature verification.
 * It is mounted with express.raw() BEFORE the global express.json()
 * middleware (see index.js).
 *
 * The credits_ledger.provider_ref unique index (GIV-705 migration 003)
 * makes double-deliveries idempotent — a duplicate insert is caught
 * and silently acknowledged (200 { duplicate: true }).
 */

import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import * as paypalClient from '../paypal-client.js';

const router = Router();

/** PayPal capture amount (USD string) → credit count */
const AMOUNT_CREDITS = { '19.00': 1, '45.00': 3, '120.00': 10 };

// ── POST /api/webhooks/paypal ──────────────────────────────────────────

router.post('/', async (req, res) => {
  // All three PayPal secrets absent → 503 (same as checkout)
  if (!config.paypal.clientId || !config.paypal.clientSecret || !config.paypal.webhookId) {
    return res.status(503).json({
      error: { code: 'PAYMENTS_NOT_CONFIGURED', message: 'Webhook not configured' },
    });
  }

  // Verify webhook signature via PayPal Webhook Verification API
  let verified;
  try {
    verified = await paypalClient.verifyWebhook(req.body, req.headers);
  } catch (err) {
    console.warn('[paypal-webhook] verification error:', err.message);
    verified = false;
  }

  if (!verified) {
    return res.status(400).json({
      error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' },
    });
  }

  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
  const event = JSON.parse(raw);

  // Only handle PAYMENT.CAPTURE.COMPLETED — acknowledge everything else
  if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
    return res.json({ received: true });
  }

  const capture = event.resource;
  const userId = capture?.custom_id;
  const captureId = capture?.id;
  const amountValue = capture?.amount?.value;

  if (!userId) {
    console.error('[paypal-webhook] PAYMENT.CAPTURE.COMPLETED missing custom_id');
    return res.status(400).json({
      error: { code: 'MISSING_USER', message: 'No custom_id on capture resource' },
    });
  }

  const credits = AMOUNT_CREDITS[amountValue] ?? null;

  if (!credits) {
    console.error('[paypal-webhook] could not determine credits for amount:', amountValue);
    return res.status(400).json({
      error: { code: 'UNKNOWN_BUNDLE', message: 'Could not determine credit amount from capture' },
    });
  }

  // Insert purchase row — provider_ref unique index makes this idempotent
  try {
    await query(
      `INSERT INTO credits_ledger (user_id, delta, reason, provider_ref)
       VALUES ($1, $2, 'purchase', $3)`,
      [userId, credits, captureId],
    );
  } catch (err) {
    // Unique violation on provider_ref → duplicate delivery, already granted
    if (err.code === '23505' && err.constraint?.includes('provider_ref')) {
      return res.json({ received: true, duplicate: true });
    }
    console.error('[paypal-webhook] failed to insert credit:', err.message);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }

  console.log(`[paypal-webhook] granted ${credits} credit(s) to user ${userId} (ref: ${captureId})`);
  res.json({ received: true, credits });
});

export default router;
