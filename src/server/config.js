/**
 * Volo Index — Server Configuration (T2-A)
 *
 * Environment-based configuration. All secrets come from env vars.
 * See .env.example for the full list.
 */

const requiredInProduction = (key) => {
  const val = process.env[key];
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
};

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
