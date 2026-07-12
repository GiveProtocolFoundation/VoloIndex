/**
 * Volo Index — Rate Limiting Middleware (T2-A)
 *
 * Two tiers:
 * - General API: 100 req / 15 min (configurable)
 * - Chat endpoint: 30 req / 1 min (tighter, to match LLM cost exposure)
 */

import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

/** General API rate limiter. */
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests — try again later' } },
});

/** Tighter limiter for chat/response endpoints (LLM cost exposure). */
export const chatLimiter = rateLimit({
  windowMs: config.rateLimit.chatWindowMs,
  max: config.rateLimit.chatMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many chat requests — slow down' } },
});
