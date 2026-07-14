/**
 * Volo Index — Error Handling Middleware (T2-A + GIV-670 Sentry)
 */

import { captureError } from '../sentry.js';

export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} [code]
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Express error-handling middleware.
 * Must be registered LAST (after all routes).
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';

  if (statusCode >= 500) {
    console.error('[error]', err.message, err.stack);
    captureError(err, { route: req.originalUrl || req.url, method: req.method });
  }

  res.status(statusCode).json({
    error: {
      code,
      message: statusCode < 500 ? err.message : 'Internal server error',
    },
  });
}
