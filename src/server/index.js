/**
 * Volo Index — HTTP Server (T2-A + T2-C auth + T2-D certs)
 *
 * Express application wiring: middleware → routes → error handler.
 * Starts listening only when run directly (not when imported for testing).
 */

// Sentry must be imported before any other module so it can instrument them.
// No-op when SENTRY_DSN is unset (local dev / tests).
import './sentry.js';

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { pool, query } from './db.js';
import { apiLimiter } from './middleware/rate-limit.js';
import { requireAuth, requireInternal } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { PostgresTranscriptStore } from './stores/postgres-transcript-store.js';
import { buildOGMeta } from '../web/sharing.js';

// Routes
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import sessionRoutes from './routes/sessions.js';
import chatRoutes from './routes/chat.js';
import resultRoutes from './routes/results.js';
import publicationRoutes from './routes/publication.js';
import { createTranscriptRoutes } from './routes/transcripts.js';
import credentialRoutes from './routes/credentials.js';   // T2-D public
import certificateRoutes from './routes/certificates.js'; // T2-D auth
import creditRoutes from './routes/credits.js';           // GIV-705 credits
import checkoutRoutes from './routes/checkout.js';           // GIV-711 PayPal checkout
import paypalWebhookRoutes from './routes/webhook-paypal.js'; // GIV-711 PayPal webhook

// ── App factory ───────────────────────────────────────────────────────

export function createApp({ transcriptStore, llmAdapterFactory } = {}) {
  const app = express();
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const webDir = path.resolve(rootDir, 'web');

  // ── Dependency injection for testability ──────────────────────────
  if (llmAdapterFactory) {
    app.locals.llmAdapterFactory = llmAdapterFactory;
  }

  // ── Global middleware ─────────────────────────────────────────────
  // CSP: allow inline scripts for the assessment SPA (app.html ships one
  // self-contained <script> block). Landing page loads Google Fonts.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
      },
    },
  }));
  app.use(cors({ origin: config.corsOrigins }));

  // ── PayPal webhook (raw body, no rate limit) ──────────────────────
  // MUST be mounted BEFORE express.json() — PayPal signature verification
  // requires the raw request body. Also excluded from the API rate limiter
  // so PayPal's servers are never throttled (GIV-711).
  app.use('/api/webhooks/paypal', express.raw({ type: 'application/json' }), paypalWebhookRoutes);

  app.use(express.json({ limit: '1mb' }));
  app.use(apiLimiter);

  // ── Public routes (no auth required) ──────────────────────────────
  app.use('/api', healthRoutes);
  app.use('/auth', authRoutes);

  // ── T2-D: public credentials API (no auth — LinkedIn crawler, verifier) ─
  app.use('/api/credentials', credentialRoutes);

  // ── Protected routes (require auth) ───────────────────────────────
  app.use('/api/sessions', requireAuth, sessionRoutes);
  app.use('/api/sessions', requireAuth, chatRoutes);
  app.use('/api/results', requireAuth, resultRoutes);
  app.use('/api/certificates', requireAuth, certificateRoutes);
  app.use('/api/credits', creditRoutes);
  app.use('/api/checkout', checkoutRoutes);                   // GIV-707

  const store = transcriptStore || new PostgresTranscriptStore({ pool });
  app.use('/api/transcripts', requireAuth, createTranscriptRoutes(store));

  // ── Internal routes (QA/ops — require X-Internal-Key header) ────────
  app.use('/api/publication', requireInternal, publicationRoutes);

  // ── T2-D: Public credential page with SSR OG meta ─────────────────
  // Template read once at startup — static HTML with placeholder <meta> tags.
  const credentialHtml = readFileSync(path.join(webDir, 'credential.html'), 'utf8');
  const baseUrl = config.auth.baseUrl || 'https://voloindex.org';

  app.get('/credential/:certId', async (req, res, next) => {
    try {
      const { certId } = req.params;

      // Guard: certificates.id is a Postgres uuid — a malformed param would
      // throw "invalid input syntax for type uuid" (observed as a 500 on
      // staging). Malformed IDs get the same placeholder page as unknown IDs.
      const { rows } = isUuid(certId)
        ? await query(
            `SELECT holder_name, overall_tier, id FROM certificates WHERE id = $1 AND revoked_at IS NULL`,
            [certId],
          )
        : { rows: [] };

      let html = credentialHtml;

      if (rows.length > 0) {
        const cert = rows[0];
        const certUrl = `${baseUrl}/credential/${cert.id}`;
        const ogMeta = buildOGMeta({
          holderName: cert.holder_name,
          tier:       cert.overall_tier,
          certUrl,
          baseUrl,
        });

        // Splice SSR OG values into the known placeholder <meta> tags.
        // credential.html uses id="og-title" etc. but has content="" placeholders;
        // we target the property/name attribute pattern instead for robustness.
        html = injectOGMeta(html, ogMeta, certUrl);
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) { next(err); }
  });

  // ── T2-D: static badge + OG card assets ──────────────────────────
  app.use('/badges', express.static(path.join(webDir, 'badges'), {
    maxAge: '7d',
  }));

  // ── Original landing page assets ──────────────────────────────────
  // The root index.html references Assets/ for favicons.
  app.use('/Assets', express.static(path.join(rootDir, 'Assets'), {
    maxAge: '7d',
  }));

  // ── QA review UI (internal) ─────────────────────────────────────
  app.get('/qa/review', (_req, res) => {
    res.sendFile(path.join(webDir, 'qa-review.html'));
  });

  // ── Landing page (original, unauthenticated visitors) ────────────
  // GET / restores the original Volo Index landing page (index.html at
  // project root). This was the page before GIV-699 replaced it with
  // the assessment SPA.
  app.get('/', (_req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
  });

  // ── Login page ────────────────────────────────────────────────────
  // GET /login serves the magic-link sign-in form (GIV-706).
  // Redirects to /app immediately if a valid token is already stored.
  app.get('/login', (_req, res) => {
    res.sendFile(path.join(webDir, 'login.html'));
  });

  // ── Assessment SPA (authenticated users after magic-link) ─────────
  // GET /app serves the T2-B assessment web app. Auth flow redirects
  // here after /auth/verify so authenticated users get the real SPA.
  app.get('/app', (_req, res) => {
    res.sendFile(path.join(webDir, 'app.html'));
  });

  // ── Error handler (must be last) ──────────────────────────────────
  app.use(errorHandler);

  return app;
}

/** Loose RFC-4122 shape check — enough to keep non-uuid strings out of a Postgres uuid cast. */
export function isUuid(str) {
  return typeof str === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Inject SSR OG meta into the credential.html template.
 * Targets <meta> tags by property/name attribute using simple regex substitution
 * on the static placeholder values. Only replaces known safe patterns.
 *
 * SECURITY: replacements are applied via a replacer FUNCTION so that `$&`,
 * `$'`, `` $` `` etc. in user-controlled values (holder_name) are inert —
 * a string replacement would let those patterns splice template HTML into
 * the attribute and break out of it (stored XSS on the public page).
 */
export function injectOGMeta(html, ogMeta, certUrl) {
  const pairs = [
    [/property="og:title"\s+content="[^"]*"/, `property="og:title" content="${escAttr(ogMeta['og:title'])}"`],
    [/content="[^"]*"\s+property="og:title"/, `content="${escAttr(ogMeta['og:title'])}" property="og:title"`],
    [/property="og:description"\s+content="[^"]*"/, `property="og:description" content="${escAttr(ogMeta['og:description'])}"`],
    [/content="[^"]*"\s+property="og:description"/, `content="${escAttr(ogMeta['og:description'])}" property="og:description"`],
    [/property="og:url"\s+content="[^"]*"/, `property="og:url" content="${escAttr(certUrl)}"`],
    [/content="[^"]*"\s+property="og:url"/, `content="${escAttr(certUrl)}" property="og:url"`],
    [/property="og:image"\s+content="[^"]*"/, `property="og:image" content="${escAttr(ogMeta['og:image'])}"`],
    [/content="[^"]*"\s+property="og:image"/, `content="${escAttr(ogMeta['og:image'])}" property="og:image"`],
    [/name="twitter:title"\s+content="[^"]*"/, `name="twitter:title" content="${escAttr(ogMeta['twitter:title'])}"`],
    [/content="[^"]*"\s+name="twitter:title"/, `content="${escAttr(ogMeta['twitter:title'])}" name="twitter:title"`],
    [/name="twitter:description"\s+content="[^"]*"/, `name="twitter:description" content="${escAttr(ogMeta['twitter:description'])}"`],
    [/content="[^"]*"\s+name="twitter:description"/, `content="${escAttr(ogMeta['twitter:description'])}" name="twitter:description"`],
    [/name="twitter:image"\s+content="[^"]*"/, `name="twitter:image" content="${escAttr(ogMeta['twitter:image'])}"`],
    [/content="[^"]*"\s+name="twitter:image"/, `content="${escAttr(ogMeta['twitter:image'])}" name="twitter:image"`],
  ];
  for (const [pattern, replacement] of pairs) {
    html = html.replace(pattern, () => replacement);
  }
  return html;
}

export function escAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Start server when run directly ────────────────────────────────────

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[volo-index] server listening on :${config.port} (${config.env})`);
  });

  // Graceful shutdown
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      console.log(`[volo-index] ${signal} received, shutting down…`);
      server.close(() => {
        pool.end().then(() => process.exit(0));
      });
    });
  }
}
