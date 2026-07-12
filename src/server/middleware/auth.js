/**
 * Volo Index — Auth Middleware (T2-C)
 *
 * requireAuth: validates Bearer JWT, sets req.user = { id, email }.
 * requireOwnership: verifies the authenticated user owns the session.
 * requireInternal: validates X-Internal-Key header for server-only endpoints.
 */

import { verifyJwt } from '../auth/jwt.js';
import { config } from '../config.js';
import { query } from '../db.js';

/**
 * Require a valid Bearer JWT on the request.
 * Sets req.user = { id, email } on success.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'AUTH_REQUIRED', message: 'Authentication required — include Authorization: Bearer <token>' },
    });
  }

  try {
    const token = header.slice(7);
    const payload = verifyJwt(token, config.auth.jwtSecret);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    const message = err.message === 'token expired'
      ? 'Token expired — request a new sign-in link'
      : 'Invalid token';
    return res.status(401).json({
      error: { code: 'INVALID_TOKEN', message },
    });
  }
}

/**
 * Middleware factory: verify the authenticated user owns the session at req.params[paramName].
 * Must be used AFTER requireAuth.
 *
 * @param {string} [paramName='id'] — the route param holding the session ID
 */
export function requireSessionOwnership(paramName = 'id') {
  return async (req, res, next) => {
    try {
      const sessionId = req.params[paramName];
      const { rows } = await query(
        'SELECT user_id FROM sessions WHERE id = $1',
        [sessionId],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' },
        });
      }

      if (rows[0].user_id !== req.user.id) {
        return res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'You do not own this session' },
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Require X-Internal-Key header matching the configured server internal key.
 * Used for server-only endpoints (e.g. interviewer-turn persistence).
 */
export function requireInternal(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== config.auth.internalKey) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'This endpoint is server-internal only' },
    });
  }
  next();
}
