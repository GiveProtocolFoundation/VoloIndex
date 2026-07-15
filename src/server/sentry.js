/**
 * Volo Index — Sentry Integration (GIV-670)
 *
 * Initialises @sentry/node when SENTRY_DSN is set. Local dev and tests
 * run with SENTRY_DSN unset and pay zero cost — every export is a no-op.
 *
 * Release identifier comes from RELEASE_SHA (injected at Docker build
 * time) so Sentry events are tagged to a specific deploy.
 */

import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN || '';

/** true when Sentry is actually wired up */
export const sentryEnabled = dsn.length > 0;

if (sentryEnabled) {
  Sentry.init({
    dsn,
    release: process.env.RELEASE_SHA || 'unknown',
    // SENTRY_ENVIRONMENT distinguishes staging from prod (both run NODE_ENV=production).
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',

    // Keep breadcrumbs but strip request bodies (may contain transcript PII).
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
      }
      return event;
    },
  });
}

/**
 * Capture an error to Sentry (no-op when DSN is unset).
 * @param {Error} err
 * @param {Record<string, string>} [context] - flat key/value pairs attached as extra context
 */
export function captureError(err, context) {
  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureException(err);
  });
}
