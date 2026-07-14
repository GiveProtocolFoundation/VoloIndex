/**
 * Volo Index — JWT utilities (T2-C)
 *
 * Zero-dependency HMAC-SHA256 JWT implementation using Node's built-in crypto.
 * Tokens carry { sub, email, iat, exp } claims.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sign a JWT payload with HMAC-SHA256.
 * @param {Record<string, unknown>} payload
 * @param {string} secret
 * @returns {string}
 */
export function signJwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/**
 * Verify and decode a JWT.
 * @param {string} token
 * @param {string} secret
 * @returns {Record<string, unknown>} decoded payload
 * @throws {Error} on invalid/expired token
 */
export function verifyJwt(token, secret) {
  if (!token || typeof token !== 'string') throw new Error('missing token');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');

  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

  // Timing-safe comparison
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('invalid signature');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('token expired');
  }

  return payload;
}

/**
 * Create a user access token.
 * @param {{ id: string, email: string }} user
 * @param {string} secret
 * @param {number} [ttlSeconds=86400] default 24 hours
 * @returns {string}
 */
export function createAccessToken(user, secret, ttlSeconds = 86400) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: user.id,
    email: user.email,
    iat: now,
    exp: now + ttlSeconds,
  }, secret);
}
