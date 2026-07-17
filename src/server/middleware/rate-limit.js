/**
 * Volo Index — Rate Limiting Middleware (T2-A)
 *
 * Two tiers:
 * - General API: 100 req / 15 min (configurable)
 * - Chat endpoint: 30 req / 1 min (tighter, to match LLM cost exposure)
 *
 * Client IP resolution (GIV-698): behind Cloudflare → Fly proxy the chain is
 * client → CF → fly-proxy → app.  Blind `trust proxy: true` lets clients
 * spoof X-Forwarded-For against the bare fly.dev hostname, so we extract the
 * real client IP from trusted proxy headers directly:
 *   1. CF-Connecting-IP  (set by Cloudflare edge — single IP, unspoofable)
 *   2. Fly-Client-IP     (set by Fly proxy — single IP, unspoofable)
 *   3. req.ip             (falls back to socket peer when trust proxy is off)
 */

import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

/**
 * Extract the real client IP from trusted proxy headers.
 * Exported for testing.
 */
export function clientIp(req) {
  return req.headers['cf-connecting-ip']
    || req.headers['fly-client-ip']
    || req.ip;
}

/** General API rate limiter. */
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests — try again later' } },
});

/** Tighter limiter for chat/response endpoints (LLM cost exposure). */
export const chatLimiter = rateLimit({
  windowMs: config.rateLimit.chatWindowMs,
  max: config.rateLimit.chatMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many chat requests — slow down' } },
});
