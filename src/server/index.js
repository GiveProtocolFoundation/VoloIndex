/**
 * Volo Index — HTTP Server (T2-A + T2-C auth)
 *
 * Express application wiring: middleware → routes → error handler.
 * Starts listening only when run directly (not when imported for testing).
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { apiLimiter } from './middleware/rate-limit.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { PostgresTranscriptStore } from './stores/postgres-transcript-store.js';

// Routes
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import sessionRoutes from './routes/sessions.js';
import chatRoutes from './routes/chat.js';
import resultRoutes from './routes/results.js';
import publicationRoutes from './routes/publication.js';
import { createTranscriptRoutes } from './routes/transcripts.js';

// ── App factory ───────────────────────────────────────────────────────

export function createApp({ transcriptStore } = {}) {
  const app = express();

  // ── Global middleware ─────────────────────────────────────────────
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));
  app.use(apiLimiter);

  // ── Public routes (no auth required) ──────────────────────────────
  app.use('/api', healthRoutes);
  app.use('/auth', authRoutes);

  // ── Protected routes (require auth) ───────────────────────────────
  app.use('/api/sessions', requireAuth, sessionRoutes);
  app.use('/api/sessions', requireAuth, chatRoutes);
  app.use('/api/results', requireAuth, resultRoutes);

  const store = transcriptStore || new PostgresTranscriptStore({ pool });
  app.use('/api/transcripts', requireAuth, createTranscriptRoutes(store));

  // ── Internal routes (QA/ops — no user auth, separate access control) ─
  app.use('/api/publication', publicationRoutes);

  // ── QA review UI (internal) ─────────────────────────────────────
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
  app.get('/qa/review', (_req, res) => {
    res.sendFile(path.join(webDir, 'qa-review.html'));
  });

  // ── Error handler (must be last) ──────────────────────────────────
  app.use(errorHandler);

  return app;
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
