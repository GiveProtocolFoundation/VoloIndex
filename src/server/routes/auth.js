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

// ── GET /auth/verify — magic-link landing page ───────────────────────
// Emails link to GET /auth/verify?token=… — serve a small page that
// POSTs the token, stores the JWT, and redirects to the app.

router.get('/verify', (req, res) => {
  res.set('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Volo Index — Signing in…</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#faf9f5;color:#2c1d13}
  .card{background:#fff;border-radius:12px;padding:32px 28px;box-shadow:0 2px 16px rgba(44,29,19,.09);max-width:400px;text-align:center}
  h1{font-size:20px;margin-bottom:8px}
  p{font-size:14px;color:#7a6252;margin-bottom:16px}
  .err{color:#c0392b;background:#fdecea;padding:12px;border-radius:8px;font-size:13px;display:none}
</style>
</head><body>
<div class="card">
  <h1>Signing you in…</h1>
  <p id="status">Verifying your sign-in link.</p>
  <div id="error" class="err"></div>
</div>
<script>
(async()=>{
  const token=new URLSearchParams(location.search).get('token');
  if(!token){show('No token found in the link.'); return;}
  try{
    const r=await fetch('/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    const d=await r.json();
    if(!r.ok){show(d.error?.message||'Verification failed.');return;}
    localStorage.setItem('volo-access-token',d.accessToken);
    document.getElementById('status').textContent='Success! Redirecting…';
    setTimeout(()=>{location.href='/';},500);
  }catch(e){show('Network error — please try again.');}
})();
function show(msg){const el=document.getElementById('error');el.textContent=msg;el.style.display='block';document.getElementById('status').textContent='Something went wrong.';}
</script>
</body></html>`);
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
