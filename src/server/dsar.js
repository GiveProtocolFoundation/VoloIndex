/**
 * Volo Index — DSAR Erasure Module (GIV-737 / GIV-743)
 *
 * eraseUser(db, userId): single transaction that erases all personal data
 * for a user while preserving pseudonymised financial records (Art. 6(1)(c)
 * 7-year carve-out). Used by self-serve account delete, internal DSAR
 * execution, and R7 inactivity purge.
 *
 * @module dsar
 */

import { createHash } from 'node:crypto';

/**
 * Erase all personal data for a user in a single transaction.
 *
 * Order matters — FK cascades handle most child rows when sessions are
 * deleted, but credits_ledger needs explicit pseudonymisation first.
 *
 * Idempotent: erasing an already-erased user is a no-op.
 *
 * @param {import('pg').Pool} db
 * @param {string} userId - UUID of the user to erase
 * @returns {Promise<{ erased: boolean, alreadyErased: boolean }>}
 */
export async function eraseUser(db, userId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Check if user exists and is not already erased
    const { rows: [user] } = await client.query(
      'SELECT id, email, erased_at FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );

    if (!user) {
      await client.query('ROLLBACK');
      throw new Error(`User not found: ${userId}`);
    }

    if (user.erased_at) {
      await client.query('ROLLBACK');
      return { erased: true, alreadyErased: true };
    }

    // 1. Delete sessions — FK cascades remove transcript_turns, transcripts,
    //    score_results, certificates, publication_queue.
    //    credits_ledger.session_id is ON DELETE SET NULL (migration 003).
    await client.query(
      'DELETE FROM sessions WHERE user_id = $1',
      [userId],
    );

    // 2. Delete auth_sessions, daily_usage
    await client.query(
      'DELETE FROM auth_sessions WHERE user_id = $1',
      [userId],
    );
    await client.query(
      'DELETE FROM daily_usage WHERE user_id = $1',
      [userId],
    );

    // 3. Delete magic_link_tokens by email
    await client.query(
      'DELETE FROM magic_link_tokens WHERE email = $1',
      [user.email],
    );

    // 4. Financial carve-out: pseudonymise credits_ledger rows.
    //    Rows survive for the 7-year Art. 6(1)(c) retention period with
    //    an immutable subject_key for audit reconciliation.
    const subjectKey = createHash('sha256').update(userId).digest('hex');
    await client.query(
      'UPDATE credits_ledger SET subject_key = $2, user_id = NULL WHERE user_id = $1',
      [userId, subjectKey],
    );

    // 5. Tombstone the user row (do NOT hard-delete — keeps ledger
    //    subject_key provenance and prevents email-uniqueness races).
    await client.query(
      `UPDATE users SET
        email = $2,
        display_name = NULL,
        email_verified = FALSE,
        entitlements = '{"plan":"free","maxConcurrentSessions":1,"dailyAssessmentLimit":3}'::jsonb,
        age_attested_at = NULL,
        erased_at = NOW(),
        updated_at = NOW()
      WHERE id = $1`,
      [userId, `erased+${userId}@invalid.voloindex.org`],
    );

    await client.query('COMMIT');
    return { erased: true, alreadyErased: false };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* already rolled back */ });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Export a user's personal data as an Art. 15/20 JSON bundle.
 *
 * @param {import('pg').Pool} db
 * @param {string} userId
 * @returns {Promise<object>} JSON-serialisable data bundle
 */
export async function exportUserData(db, userId) {
  const { rows: [user] } = await db.query(
    `SELECT id, email, display_name, email_verified, email_verified_at,
            entitlements, age_attested_at, created_at, updated_at,
            last_active_at, erased_at
     FROM users WHERE id = $1`,
    [userId],
  );

  if (!user) throw new Error(`User not found: ${userId}`);

  const { rows: sessions } = await db.query(
    `SELECT id, status, consent_given, consent_at, started_at, completed_at,
            abandoned_at, abandon_reason, dimension_progress, created_at, updated_at
     FROM sessions WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );

  const sessionIds = sessions.map(s => s.id);

  let transcriptTurns = [];
  let transcripts = [];
  let scoreResults = [];
  let certificates = [];

  if (sessionIds.length > 0) {
    ({ rows: transcriptTurns } = await db.query(
      `SELECT session_id, turn_index, role, content, dimension, redacted_at, created_at
       FROM transcript_turns WHERE session_id = ANY($1::uuid[]) ORDER BY session_id, turn_index`,
      [sessionIds],
    ));

    ({ rows: transcripts } = await db.query(
      `SELECT session_id, candidate_id, consent_given, consent_at, transcript, saved_at
       FROM transcripts WHERE session_id = ANY($1::uuid[])`,
      [sessionIds],
    ));

    ({ rows: scoreResults } = await db.query(
      `SELECT id, session_id, signals, dimension_scores, overall_score, overall_tier,
              details, rubric_version, created_at
       FROM score_results WHERE session_id = ANY($1::uuid[])`,
      [sessionIds],
    ));

    ({ rows: certificates } = await db.query(
      `SELECT id, session_id, holder_name, overall_score, overall_tier,
              dimension_scores, rubric_version, issued_at, revoked_at, revocation_reason,
              publication_consent_at, publication_consent_revoked_at
       FROM certificates WHERE session_id = ANY($1::uuid[])`,
      [sessionIds],
    ));
  }

  const { rows: creditsLedger } = await db.query(
    `SELECT id, delta, reason, session_id, provider_ref, created_at
     FROM credits_ledger WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );

  return {
    exportedAt: new Date().toISOString(),
    user,
    sessions,
    transcriptTurns: transcriptTurns.map(t => ({
      ...t,
      content: t.redacted_at ? '[Redacted]' : t.content,
    })),
    transcripts,
    scoreResults,
    certificates,
    creditsLedger,
  };
}
