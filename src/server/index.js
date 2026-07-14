/**
 * Volo Index — HTTP Server (T2-A + T2-C auth + T2-D certs)
 *
 * Express application wiring: middleware → routes → error handler.
 * Starts listening only when run directly (not when imported for testing).
 */

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

// ── App factory ───────────────────────────────────────────────────────

export function createApp({ transcriptStore, llmAdapterFactory } = {}) {
  const app = express();

  // ── Dependency injection for testability ──────────────────────────
  if (llmAdapterFactory) {
    app.locals.llmAdapterFactory = llmAdapterFactory;
  }

  // ── Global middleware ─────────────────────────────────────────────
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
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

      // Fetch cert for SSR (LinkedIn's crawler needs populated OG in the raw HTML)
      const { rows } = await query(
        `SELECT holder_name, overall_tier, id FROM certificates WHERE id = $1 AND revoked_at IS NULL`,
        [certId],
      );

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

  // ── QA review UI (internal) ─────────────────────────────────────
  app.get('/qa/review', (_req, res) => {
    res.sendFile(path.join(webDir, 'qa-review.html'));
  });

  // ── Error handler (must be last) ──────────────────────────────────
  app.use(errorHandler);

  return app;
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
