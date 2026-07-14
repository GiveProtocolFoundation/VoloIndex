/**
 * Volo Index — Magic-link authentication (T2-C)
 *
 * Generates one-time magic-link tokens, stores hashed in Postgres,
 * verifies on click, and issues a JWT access token.
 *
 * Email is abstracted: in dev mode, logs the link to console.
 * Production wiring to a transactional email provider (Postmark/SendGrid)
 * is a T2-G ops concern.
 */

import { randomBytes, createHash } from 'node:crypto';
import { query } from '../db.js';
import { createAccessToken } from './jwt.js';
import { config } from '../config.js';

const MAGIC_LINK_TTL_MS = config.auth.magicLinkTtlMinutes * 60 * 1000;

/**
 * Hash a raw token for DB storage (SHA-256, hex).
 * @param {string} rawToken
 * @returns {string}
 */
export function hashToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Request a magic link for the given email.
 * Creates or finds the user, generates a token, stores it, and "sends" it.
 *
 * @param {string} email
 * @param {string} baseUrl - e.g. 'https://voloindex.org'
 * @returns {Promise<{ message: string }>}
 */
export async function requestMagicLink(email, baseUrl) {
  const normalised = email.toLowerCase().trim();

  // Upsert user
  const { rows } = await query(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
     RETURNING id, email, display_name, email_verified, entitlements`,
    [normalised],
  );
  const user = rows[0];

  // Generate token
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

  await query(
    `INSERT INTO magic_link_tokens (email, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [normalised, tokenHash, expiresAt.toISOString()],
  );

  // Build link
  const magicLink = `${baseUrl}/auth/verify?token=${rawToken}`;

  // Send (dev: console, prod: email provider)
  if (config.env === 'production' && config.auth.emailProvider) {
    // Production email sending — pluggable via config.auth.sendEmail
    await config.auth.sendEmail({
      to: normalised,
      subject: 'Sign in to Volo Index',
      text: `Click to sign in (expires in ${config.auth.magicLinkTtlMinutes} minutes):\n\n${magicLink}\n\nIf you didn't request this, ignore this email.`,
      html: `<p>Click to sign in (expires in ${config.auth.magicLinkTtlMinutes} minutes):</p><p><a href="${magicLink}">Sign in to Volo Index</a></p><p>If you didn't request this, ignore this email.</p>`,
    });
  } else {
    console.log(`[auth] magic link for ${normalised}: ${magicLink}`);
  }

  return { message: 'Check your email for a sign-in link' };
}

/**
 * Verify a magic-link token and return an access token.
 *
 * @param {string} rawToken
 * @returns {Promise<{ accessToken: string, user: object }>}
 * @throws {Error} on invalid/expired/used token
 */
export async function verifyMagicLink(rawToken) {
  const tokenHash = hashToken(rawToken);

  // Find the token
  const { rows } = await query(
    `SELECT id, email, expires_at, used_at
     FROM magic_link_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  );

  if (rows.length === 0) {
    throw Object.assign(new Error('Invalid or expired sign-in link'), { statusCode: 401, code: 'INVALID_TOKEN' });
  }

  const record = rows[0];

  if (record.used_at) {
    throw Object.assign(new Error('This sign-in link has already been used'), { statusCode: 401, code: 'TOKEN_USED' });
  }

  if (new Date(record.expires_at) < new Date()) {
    throw Object.assign(new Error('This sign-in link has expired — request a new one'), { statusCode: 401, code: 'TOKEN_EXPIRED' });
  }

  // Mark as used (atomically, to prevent replay)
  const { rowCount } = await query(
    `UPDATE magic_link_tokens SET used_at = NOW()
     WHERE id = $1 AND used_at IS NULL`,
    [record.id],
  );
  if (rowCount === 0) {
    throw Object.assign(new Error('This sign-in link has already been used'), { statusCode: 401, code: 'TOKEN_USED' });
  }

  // Fetch or update user as verified
  const { rows: userRows } = await query(
    `UPDATE users SET email_verified = TRUE, email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
     WHERE email = $1
     RETURNING id, email, display_name, email_verified, entitlements`,
    [record.email],
  );

  const user = userRows[0];

  // Issue JWT
  const accessToken = createAccessToken(
    { id: user.id, email: user.email },
    config.auth.jwtSecret,
    config.auth.jwtTtlSeconds,
  );

  return {
    accessToken,
    expiresIn: config.auth.jwtTtlSeconds,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      emailVerified: user.email_verified,
      entitlements: user.entitlements,
    },
  };
}
