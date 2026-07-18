/**
 * Volo Index — Stripe Checkout Routes (GIV-707)
 *
 * POST /api/checkout  (requireAuth)  → creates a Stripe Checkout Session
 *                                      for the chosen credit bundle.
 *
 * Returns 503 when STRIPE_SECRET_KEY / price IDs are not configured.
 */

import { Router } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';

const router = Router();

/** True when the operator has staged all required Stripe env vars. */
function stripeConfigured() {
  return !!(config.stripe.secretKey && Object.values(config.stripe.prices).every(Boolean));
}

// ── POST /api/checkout — create Stripe Checkout Session ──────────────

router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (!stripeConfigured()) {
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

    const priceId = config.stripe.prices[credits];
    const stripe = new Stripe(config.stripe.secretKey);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: req.user.id,
      customer_email: req.user.email,
      success_url: `${config.auth.baseUrl || `${req.protocol}://${req.get('host')}`}/app?purchase=success`,
      cancel_url:  `${config.auth.baseUrl || `${req.protocol}://${req.get('host')}`}/app?purchase=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) { next(err); }
});

export default router;
