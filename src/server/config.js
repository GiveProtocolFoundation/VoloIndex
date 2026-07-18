/**
 * Volo Index — Server Configuration (T2-A + T2-C auth)
 *
 * Environment-based configuration. All secrets come from env vars.
 * See .env.example for the full list.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const requiredInProduction = (key) => {
  const val = process.env[key];
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
};

/**
 * DB TLS config from DB_SSL:
 *   - 'false' / unset → no TLS (local dev)
 *   - 'true'          → TLS with certificate verification (rejectUnauthorized: true).
 *                       Neon/managed Postgres certs chain to public CAs in Node's
 *                       bundled store; set DB_SSL_CA (PEM file path or inline PEM)
 *                       for a private CA.
 *   - 'no-verify'     → TLS without verification. Dev/debug ONLY — refused in production.
 */
const dbSslConfig = () => {
  const mode = process.env.DB_SSL || 'false';
  if (mode === 'false' || mode === '') return false;
  if (mode === 'no-verify') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DB_SSL=no-verify is not allowed in production — use DB_SSL=true (CA-verified)');
    }
    return { rejectUnauthorized: false };
  }
  // 'true' (and any other truthy value) → verified TLS
  const ssl = { rejectUnauthorized: true };
  const ca = process.env.DB_SSL_CA;
  if (ca) {
    ssl.ca = ca.includes('-----BEGIN') ? ca : readFileSync(ca, 'utf8');
  }
  return ssl;
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
    ssl: dbSslConfig(),
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
  },

  // ── Email (GIV-708) ───────────────────────────────────────────────
  // Resend HTTP API for transactional email (magic-link delivery).
  // Absent RESEND_API_KEY → log-only fallback (dev/tests unchanged).
  email: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMAIL_FROM || 'login@voloindex.org',
  },

  // ── Rate limiting ────────────────────────────────────────────────
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),   // 15 min
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),          // per window
    chatWindowMs: parseInt(process.env.RATE_LIMIT_CHAT_WINDOW_MS || '60000', 10), // 1 min
    chatMaxRequests: parseInt(process.env.RATE_LIMIT_CHAT_MAX || '30', 10),  // per window
  },

  // ── Credits (GIV-705) ────────────────────────────────────────────
  // When true, POST /api/sessions/:id/start requires a credit and debits 1.
  // Default false: staging and existing E2E keep working until launch flip.
  creditsRequired: process.env.CREDITS_REQUIRED === 'true',

  // ── Stripe (GIV-707) ──────────────────────────────────────────────
  // Absent keys → checkout endpoints return 503 (deploy stays healthy).
  stripe: {
    secretKey:     process.env.STRIPE_SECRET_KEY     || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    prices: {
      1:  process.env.STRIPE_PRICE_1  || '',
      3:  process.env.STRIPE_PRICE_3  || '',
      10: process.env.STRIPE_PRICE_10 || '',
    },
  },

  // ── CORS ─────────────────────────────────────────────────────────
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000'],
};
