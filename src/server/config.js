/**
 * Volo Index — Server Configuration (T2-A + T2-C auth)
 *
 * Environment-based configuration. All secrets come from env vars.
 * See .env.example for the full list.
 */

import { randomBytes } from 'node:crypto';

const requiredInProduction = (key) => {
  const val = process.env[key];
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
};

// Dev-only fallback secret — production MUST set JWT_SECRET env var
const devJwtSecret = process.env.NODE_ENV === 'production'
  ? undefined
  : (process.env.JWT_SECRET || 'dev-jwt-secret-do-not-use-in-prod');

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  // ── Postgres ──────────────────────────────────────────────────────
  db: {
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/voloindex',
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },

  // ── Anthropic (for LLM adapter) ──────────────────────────────────
  anthropicApiKey: requiredInProduction('ANTHROPIC_API_KEY'),

  // ── Auth (T2-C) ───────────────────────────────────────────────────
  auth: {
    jwtSecret: requiredInProduction('JWT_SECRET') || devJwtSecret,
    jwtTtlSeconds: parseInt(process.env.JWT_TTL_SECONDS || '86400', 10),        // 24 hours
    magicLinkTtlMinutes: parseInt(process.env.MAGIC_LINK_TTL_MINUTES || '30', 10), // 30 min
    baseUrl: process.env.AUTH_BASE_URL || '',                                    // e.g. https://voloindex.org
    internalKey: process.env.INTERNAL_API_KEY || randomBytes(32).toString('hex'), // server-only endpoints
    emailProvider: process.env.EMAIL_PROVIDER || '',                              // 'postmark' | 'sendgrid' | '' (console)
    sendEmail: null,                                                              // plugged at startup if emailProvider set
  },

  // ── Rate limiting ────────────────────────────────────────────────
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),   // 15 min
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),          // per window
    chatWindowMs: parseInt(process.env.RATE_LIMIT_CHAT_WINDOW_MS || '60000', 10), // 1 min
    chatMaxRequests: parseInt(process.env.RATE_LIMIT_CHAT_MAX || '30', 10),  // per window
  },

  // ── CORS ─────────────────────────────────────────────────────────
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000'],
};
