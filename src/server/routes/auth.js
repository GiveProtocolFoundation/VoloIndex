/**
 * Volo Index — Auth Routes (T2-C)
 *
 * POST /auth/magic-link  — request a sign-in link
 * POST /auth/verify       — verify token, get access JWT
 * GET  /auth/me           — fetch current user profile (requires auth)
 */

import { Router } from 'express';
import { requestMagicLink, verifyMagicLink } from '../auth/magic-link.js';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import { config } from '../config.js';

const router = Router();

// Rate limit: max 5 magic-link requests per email per 15 minutes
// (stacks with the global API limiter)
const recentRequests = new Map();
const ML_WINDOW_MS = 15 * 60 * 1000;
const ML_MAX = 5;

function magicLinkRateLimit(req, res, next) {
  const email = (req.body.email || '').toLowerCase().trim();
  if (!email) return next();

  const now = Date.now();
  const entry = recentRequests.get(email);
  if (entry) {
    // Prune old timestamps
    entry.timestamps = entry.timestamps.filter(t => now - t < ML_WINDOW_MS);
    if (entry.timestamps.length >= ML_MAX) {
      return res.status(429).json({
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many sign-in requests — try again later' },
      });
    }
    entry.timestamps.push(now);
  } else {
    recentRequests.set(email, { timestamps: [now] });
  }

  // Periodic cleanup
  if (recentRequests.size > 10_000) {
    for (const [key, val] of recentRequests) {
      val.timestamps = val.timestamps.filter(t => now - t < ML_WINDOW_MS);
      if (val.timestamps.length === 0) recentRequests.delete(key);
    }
  }

  next();
}

// ── POST /auth/magic-link — request a sign-in link ───────────────────

router.post('/magic-link', magicLinkRateLimit, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        error: { code: 'MISSING_FIELD', message: 'email is required' },
      });
    }

    // Basic email format check
    if (!email.includes('@') || email.length < 5 || email.length > 254) {
      return res.status(400).json({
        error: { code: 'INVALID_EMAIL', message: 'Please provide a valid email address' },
      });
    }

    const baseUrl = config.auth.baseUrl || `${req.protocol}://${req.get('host')}`;
    const result = await requestMagicLink(email, baseUrl);
    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /auth/verify — verify magic-link token, return JWT ──────────

router.post('/verify', async (req, res, next) => {
  try {
    const token = req.body.token || req.query.token;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        error: { code: 'MISSING_FIELD', message: 'token is required' },
      });
    }

    const result = await verifyMagicLink(token);
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /auth/me — current user profile (requires auth) ─────────────

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, display_name, email_verified, email_verified_at, entitlements, created_at
       FROM users WHERE id = $1`,
      [req.user.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const u = rows[0];
    res.json({
      user: {
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        emailVerified: u.email_verified,
        emailVerifiedAt: u.email_verified_at?.toISOString?.() ?? u.email_verified_at,
        entitlements: u.entitlements,
        createdAt: u.created_at?.toISOString?.() ?? u.created_at,
      },
    });
  } catch (err) { next(err); }
});

export default router;
