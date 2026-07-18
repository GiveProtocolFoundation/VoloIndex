/**
 * Volo Index — Stripe Webhook Route (GIV-707)
 *
 * POST /api/webhooks/stripe — verify stripe-signature, handle
 * checkout.session.completed → insert credits_ledger 'purchase' row.
 *
 * IMPORTANT: this route needs the RAW body for signature verification.
 * It is mounted with express.raw() BEFORE the global express.json()
 * middleware (see index.js).
 *
 * The credits_ledger.provider_ref unique index (GIV-705 migration 003)
 * makes double-deliveries idempotent — a duplicate insert is caught
 * and silently acknowledged (200).
 */

import { Router } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { query } from '../db.js';

const router = Router();

/**
 * Bundle → credit-count map. Stripe sends the Price ID; we look up
 * how many credits that corresponds to.
 */
function creditsForPrice(priceId) {
  for (const [credits, pid] of Object.entries(config.stripe.prices)) {
    if (pid === priceId) return Number(credits);
  }
  return null;
}

// ── POST /api/webhooks/stripe ────────────────────────────────────────

router.post('/', async (req, res) => {
  // Stripe keys absent → 503 (same as checkout)
  if (!config.stripe.secretKey || !config.stripe.webhookSecret) {
    return res.status(503).json({
      error: { code: 'PAYMENTS_NOT_CONFIGURED', message: 'Webhook not configured' },
    });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({
      error: { code: 'MISSING_SIGNATURE', message: 'Missing stripe-signature header' },
    });
  }

  let event;
  try {
    const stripe = new Stripe(config.stripe.secretKey);
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (err) {
    console.warn('[stripe-webhook] signature verification failed:', err.message);
    return res.status(400).json({
      error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' },
    });
  }

  // Only handle checkout.session.completed — acknowledge everything else
  if (event.type !== 'checkout.session.completed') {
    return res.json({ received: true });
  }

  const session = event.data.object;
  const userId = session.client_reference_id;
  const providerRef = event.id;

  if (!userId) {
    console.error('[stripe-webhook] checkout.session.completed missing client_reference_id');
    return res.status(400).json({
      error: { code: 'MISSING_USER', message: 'No client_reference_id on session' },
    });
  }

  // Determine how many credits to grant from the line items
  // The line_items may not be expanded in the webhook payload — use the
  // amount_total as a fallback mapping: $19→1, $45→3, $120→10 (amounts in cents).
  let credits = null;

  // Try price-ID lookup first (if line_items are expanded)
  const items = session.line_items?.data;
  if (items && items.length > 0) {
    credits = creditsForPrice(items[0].price?.id);
  }

  // Fallback: map from amount_total (cents)
  if (credits === null && session.amount_total != null) {
    const amountMap = { 1900: 1, 4500: 3, 12000: 10 };
    credits = amountMap[session.amount_total] ?? null;
  }

  if (!credits) {
    console.error('[stripe-webhook] could not determine credits for session:', session.id);
    return res.status(400).json({
      error: { code: 'UNKNOWN_BUNDLE', message: 'Could not determine credit amount' },
    });
  }

  // Insert purchase row — provider_ref unique index makes this idempotent
  try {
    await query(
      `INSERT INTO credits_ledger (user_id, delta, reason, provider_ref)
       VALUES ($1, $2, 'purchase', $3)`,
      [userId, credits, providerRef],
    );
  } catch (err) {
    // Unique violation on provider_ref → duplicate delivery, already granted
    if (err.code === '23505' && err.constraint?.includes('provider_ref')) {
      return res.json({ received: true, duplicate: true });
    }
    console.error('[stripe-webhook] failed to insert credit:', err.message);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }

  console.log(`[stripe-webhook] granted ${credits} credit(s) to user ${userId} (ref: ${providerRef})`);
  res.json({ received: true, credits });
});

export default router;
