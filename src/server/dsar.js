/**
 * Volo Index — DSAR Erasure Module (GIV-737 / GIV-753)
 *
 * Single shared eraseUser(db, userId) implementation per CTO design doc §3.
 * Used by: self-serve DELETE /api/account, internal DSAR endpoint, and R7.
 *
 * @module dsar
 */

import { createHash } from 'node:crypto';
import { withTransaction } from './db.js';

/**
 * Erase a user's personal data while preserving financial records.
 *
 * All in one transaction; idempotent (erasing an already-erased user is a no-op).
 * Order matters — see design doc §3.
 *
 * @param {import('pg').Pool} db
 * @param {string} userId
 * @returns {Promise<{erased: boolean, alreadyErased: boolean}>}
 */
export async function eraseUser(db, userId) {
  return withTransaction(async (client) => {
    // Check if already erased (idempotent)
    const { rows: [user] } = await client.query(
      'SELECT id, email, erased_at FROM users WHERE id = $1',
      [userId],
    );

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    if (user.erased_at) {
      return { erased: true, alreadyErased: true };
    }

    // 1. Delete sessions → FK cascades remove transcript_turns, transcripts,
    //    score_results, certificates, publication_queue.
    //    (credits_ledger.session_id is already ON DELETE SET NULL.)
    await client.query(
      'DELETE FROM sessions WHERE user_id = $1',
      [userId],
    );

    // 2. Delete auth_sessions, daily_usage, and magic_link_tokens (by email).
    await client.query(
      'DELETE FROM auth_sessions WHERE user_id = $1',
      [userId],
    );
    await client.query(
      'DELETE FROM daily_usage WHERE user_id = $1',
      [userId],
    );
    await client.query(
      'DELETE FROM magic_link_tokens WHERE email = $1',
      [user.email],
    );

    // 3. Financial carve-out (Art. 6(1)(c)): pseudonymise credits_ledger rows.
    //    Transaction rows survive for 7-year retention, now with subject_key
    //    instead of user_id.
    const subjectKey = createHash('sha256').update(userId).digest('hex');
    await client.query(
      `UPDATE credits_ledger
       SET subject_key = $2, user_id = NULL
       WHERE user_id = $1`,
      [userId, subjectKey],
    );

    // 4. Tombstone the user row (do NOT hard-delete).
    await client.query(
      `UPDATE users SET
         email = $2,
         display_name = NULL,
         email_verified = FALSE,
         entitlements = '{"plan":"free","maxConcurrentSessions":1,"dailyAssessmentLimit":3}',
         age_attested_at = NULL,
         erased_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [userId, `erased+${userId}@invalid.voloindex.org`],
    );

    return { erased: true, alreadyErased: false };
  });
}

/**
 * Find a user ID by email.
 *
 * @param {import('pg').Pool} db
 * @param {string} email
 * @returns {Promise<string|null>}
 */
export async function findUserIdByEmail(db, email) {
  const { rows } = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [email],
  );
  return rows.length > 0 ? rows[0].id : null;
}
