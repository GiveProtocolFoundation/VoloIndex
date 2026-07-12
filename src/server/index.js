/**
 * Volo Index — HTTP Server (T2-A)
 *
 * Express application wiring: middleware → routes → error handler.
 * Starts listening only when run directly (not when imported for testing).
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { apiLimiter } from './middleware/rate-limit.js';
import { errorHandler } from './middleware/error-handler.js';
import { PostgresTranscriptStore } from './stores/postgres-transcript-store.js';

// Routes
import healthRoutes from './routes/health.js';
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

  // ── Routes ────────────────────────────────────────────────────────
  app.use('/api', healthRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/sessions', chatRoutes);
  app.use('/api/results', resultRoutes);
  app.use('/api/publication', publicationRoutes);

  const store = transcriptStore || new PostgresTranscriptStore({ pool });
  app.use('/api/transcripts', createTranscriptRoutes(store));

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
