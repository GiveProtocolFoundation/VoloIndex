/**
 * Retention purge engine tests (GIV-742)
 *
 * Covers: R1–R6 steps with rows inside/outside retention windows,
 * R3 excerpt-scrub assertion (score_results signals/details),
 * dry-run mode, and the steps array pluggability for R7.
 *
 * Run: node --experimental-test-module-mocks --test test/server/retention.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runRetention, steps } from '../../src/server/retention.js';

// ── In-memory tables ────────────────────────────────────────────────

let magicLinkTokens, authSessions, transcriptTurns, scoreResults,
    certificates, publicationQueue, dailyUsage, transcripts;

function resetTables() {
  magicLinkTokens = [];
  authSessions = [];
  transcriptTurns = [];
  scoreResults = [];
  certificates = [];
  publicationQueue = [];
  dailyUsage = [];
  transcripts = [];
}

function ago(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function future(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ── Mock pool ───────────────────────────────────────────────────────

function createMockPool() {
  function createClient() {
    const client = {
      async query(sql, params) {
        return handleQuery(sql, params);
      },
      release() { /* no-op */ },
    };
    return client;
  }

  return {
    async connect() {
      return createClient();
    },
  };
}

function handleQuery(sql, params) {
  const text = sql.replace(/\s+/g, ' ').trim();

  // Transaction control
  if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
    return { rows: [], rowCount: 0 };
  }

  // R1: magic_link_tokens
  if (text.includes('FROM magic_link_tokens') && text.includes('COUNT')) {
    const c = magicLinkTokens.filter(t => t.expires_at < new Date() || t.used_at != null).length;
    return { rows: [{ c }] };
  }
  if (text.includes('DELETE FROM magic_link_tokens')) {
    const before = magicLinkTokens.length;
    magicLinkTokens = magicLinkTokens.filter(t => t.expires_at >= new Date() && t.used_at == null);
    return { rowCount: before - magicLinkTokens.length };
  }

  // R2: auth_sessions
  if (text.includes('FROM auth_sessions') && text.includes('COUNT')) {
    const c = authSessions.filter(s => s.expires_at < new Date() || s.revoked_at != null).length;
    return { rows: [{ c }] };
  }
  if (text.includes('DELETE FROM auth_sessions')) {
    const before = authSessions.length;
    authSessions = authSessions.filter(s => s.expires_at >= new Date() && s.revoked_at == null);
    return { rowCount: before - authSessions.length };
  }

  // R3: score_results sessions older than 90 days
  if (text.includes('FROM score_results sr') && text.includes('90 days')) {
    const rows = scoreResults
      .filter(sr => sr.created_at < ago(90))
      .map(sr => ({ session_id: sr.session_id }));
    return { rows };
  }
  if (text.includes('COUNT') && text.includes('transcript_turns') && text.includes('ANY')) {
    const ids = params[0];
    const c = transcriptTurns.filter(t => ids.includes(t.session_id)).length;
    return { rows: [{ c }] };
  }
  if (text.includes('DELETE FROM transcript_turns') && text.includes('ANY')) {
    const ids = params[0];
    const before = transcriptTurns.length;
    transcriptTurns = transcriptTurns.filter(t => !ids.includes(t.session_id));
    return { rowCount: before - transcriptTurns.length };
  }
  if (text.includes('SELECT id, signals, details FROM score_results') && text.includes('ANY')) {
    const ids = params[0];
    const rows = scoreResults.filter(sr => ids.includes(sr.session_id));
    return { rows: rows.map(r => ({ id: r.id, signals: r.signals, details: r.details })) };
  }
  if (text.includes('UPDATE score_results SET signals')) {
    const id = params[0];
    const sr = scoreResults.find(r => r.id === id);
    if (sr) {
      sr.signals = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
      sr.details = params[2] == null ? null : (typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2]);
    }
    return { rowCount: sr ? 1 : 0 };
  }

  // R4: revoked certificates
  if (text.includes('FROM certificates c') && text.includes('revoked_at') && text.includes('30 days')) {
    const rows = certificates
      .filter(c => c.revoked_at != null && c.revoked_at < ago(30))
      .map(c => ({ id: c.id, session_id: c.session_id }));
    return { rows };
  }
  if (text.includes('DELETE FROM publication_queue') && text.includes('ANY')) {
    const ids = params[0];
    const before = publicationQueue.length;
    publicationQueue = publicationQueue.filter(pq => !ids.includes(pq.session_id));
    return { rowCount: before - publicationQueue.length };
  }
  if (text.includes('DELETE FROM score_results') && text.includes('ANY')) {
    const ids = params[0];
    const before = scoreResults.length;
    scoreResults = scoreResults.filter(sr => !ids.includes(sr.session_id));
    return { rowCount: before - scoreResults.length };
  }
  if (text.includes('DELETE FROM transcripts') && text.includes('ANY')) {
    const ids = params[0];
    const before = transcripts.length;
    transcripts = transcripts.filter(t => !ids.includes(t.session_id));
    return { rowCount: before - transcripts.length };
  }
  if (text.includes('DELETE FROM certificates') && text.includes('ANY')) {
    const ids = params[0];
    const before = certificates.length;
    certificates = certificates.filter(c => !ids.includes(c.id));
    return { rowCount: before - certificates.length };
  }

  // R5: daily_usage
  if (text.includes('FROM daily_usage') && text.includes('COUNT') && text.includes('13 months')) {
    const c = dailyUsage.filter(d => d.usage_date < ago(13 * 30)).length;
    return { rows: [{ c }] };
  }
  if (text.includes('DELETE FROM daily_usage') && text.includes('13 months')) {
    const before = dailyUsage.length;
    dailyUsage = dailyUsage.filter(d => d.usage_date >= ago(13 * 30));
    return { rowCount: before - dailyUsage.length };
  }

  // R6: publication_queue hygiene
  if (text.includes('FROM publication_queue pq') && text.includes('publication_consent_revoked_at')) {
    const revokedCertSessionIds = new Set(
      certificates.filter(c => c.publication_consent_revoked_at != null).map(c => c.session_id),
    );
    const rows = publicationQueue
      .filter(pq => revokedCertSessionIds.has(pq.session_id))
      .map(pq => ({ session_id: pq.session_id }));
    return { rows };
  }

  return { rows: [], rowCount: 0 };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('retention purge engine', () => {
  beforeEach(() => {
    resetTables();
  });

  describe('R1 — expired/used magic_link_tokens', () => {
    it('deletes expired tokens', async () => {
      magicLinkTokens.push(
        { id: '1', expires_at: ago(1), used_at: null },
        { id: '2', expires_at: future(1), used_at: null },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R1, 1);
      assert.equal(magicLinkTokens.length, 1);
      assert.equal(magicLinkTokens[0].id, '2');
    });

    it('deletes used tokens', async () => {
      magicLinkTokens.push(
        { id: '1', expires_at: future(1), used_at: new Date() },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R1, 1);
      assert.equal(magicLinkTokens.length, 0);
    });

    it('keeps valid unexpired tokens', async () => {
      magicLinkTokens.push(
        { id: '1', expires_at: future(1), used_at: null },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R1, 0);
      assert.equal(magicLinkTokens.length, 1);
    });
  });

  describe('R2 — expired/revoked auth_sessions', () => {
    it('deletes expired sessions', async () => {
      authSessions.push(
        { id: '1', expires_at: ago(1), revoked_at: null },
        { id: '2', expires_at: future(1), revoked_at: null },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R2, 1);
      assert.equal(authSessions.length, 1);
    });

    it('deletes revoked sessions', async () => {
      authSessions.push(
        { id: '1', expires_at: future(1), revoked_at: new Date() },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R2, 1);
    });

    it('keeps active sessions', async () => {
      authSessions.push(
        { id: '1', expires_at: future(1), revoked_at: null },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R2, 0);
    });
  });

  describe('R3 — 90-day transcript_turns + score_results scrub', () => {
    it('deletes turns for sessions scored >90 days ago', async () => {
      scoreResults.push(
        { id: 'sr-1', session_id: 'sess-old', created_at: ago(91), signals: {}, details: null },
      );
      transcriptTurns.push(
        { session_id: 'sess-old', turn_index: 0, content: 'hello' },
        { session_id: 'sess-old', turn_index: 1, content: 'world' },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R3, 2);
      assert.equal(transcriptTurns.length, 0);
    });

    it('keeps turns for sessions scored <90 days ago', async () => {
      scoreResults.push(
        { id: 'sr-1', session_id: 'sess-recent', created_at: ago(30), signals: {}, details: null },
      );
      transcriptTurns.push(
        { session_id: 'sess-recent', turn_index: 0, content: 'hello' },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R3, 0);
      assert.equal(transcriptTurns.length, 1);
    });

    it('scrubs spanText and excerpt from score_results signals/details', async () => {
      const signals = [
        { dimension: 'planning', evidenceRef: { turnIndex: 0 }, excerpt: 'verbatim quote', score: 3 },
        { dimension: 'recruiting', turnIndex: 1, spanText: 'another quote', score: 4 },
      ];
      const details = {
        summary: 'good',
        refs: [{ turnIndex: 2, spanText: 'detail quote' }],
      };
      scoreResults.push({
        id: 'sr-1',
        session_id: 'sess-old',
        created_at: ago(91),
        signals: JSON.parse(JSON.stringify(signals)),
        details: JSON.parse(JSON.stringify(details)),
      });
      transcriptTurns.push(
        { session_id: 'sess-old', turn_index: 0, content: 'x' },
      );

      await runRetention(createMockPool());

      const sr = scoreResults.find(r => r.id === 'sr-1');
      assert.equal(sr.signals[0].excerpt, '[Removed — retention policy]');
      assert.equal(sr.signals[0].score, 3);
      assert.equal(sr.signals[1].spanText, '[Removed — retention policy]');
      assert.equal(sr.signals[1].score, 4);
      assert.equal(sr.details.refs[0].spanText, '[Removed — retention policy]');
      assert.equal(sr.details.summary, 'good');
    });

    it('handles null details gracefully', async () => {
      scoreResults.push({
        id: 'sr-1', session_id: 'sess-old', created_at: ago(91),
        signals: [], details: null,
      });
      const results = await runRetention(createMockPool());
      assert.equal(results.R3, 0);
      const sr = scoreResults.find(r => r.id === 'sr-1');
      assert.equal(sr.details, null);
    });
  });

  describe('R4 — revoked certificates after 30-day grace', () => {
    it('deletes certificates revoked >30 days ago with all dependants', async () => {
      certificates.push(
        { id: 'cert-1', session_id: 'sess-1', revoked_at: ago(31) },
      );
      scoreResults.push(
        { id: 'sr-1', session_id: 'sess-1', created_at: ago(10), signals: {}, details: null },
      );
      transcripts.push({ session_id: 'sess-1' });
      publicationQueue.push({ session_id: 'sess-1' });

      const results = await runRetention(createMockPool());
      assert.equal(results.R4, 1);
      assert.equal(certificates.length, 0);
      assert.equal(scoreResults.length, 0);
      assert.equal(transcripts.length, 0);
      assert.equal(publicationQueue.length, 0);
    });

    it('keeps certificates revoked <30 days ago', async () => {
      certificates.push(
        { id: 'cert-1', session_id: 'sess-1', revoked_at: ago(10) },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R4, 0);
      assert.equal(certificates.length, 1);
    });

    it('keeps unrevoked certificates', async () => {
      certificates.push(
        { id: 'cert-1', session_id: 'sess-1', revoked_at: null },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R4, 0);
      assert.equal(certificates.length, 1);
    });
  });

  describe('R5 — daily_usage older than 13 months', () => {
    it('deletes usage rows older than 13 months', async () => {
      dailyUsage.push(
        { user_id: 'u1', usage_date: ago(400) },
        { user_id: 'u1', usage_date: ago(10) },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R5, 1);
      assert.equal(dailyUsage.length, 1);
    });

    it('keeps recent usage rows', async () => {
      dailyUsage.push(
        { user_id: 'u1', usage_date: ago(30) },
      );
      const results = await runRetention(createMockPool());
      assert.equal(results.R5, 0);
      assert.equal(dailyUsage.length, 1);
    });
  });

  describe('R6 — publication_queue hygiene for consent-revoked certs', () => {
    it('removes queue rows for certs with revoked publication consent', async () => {
      certificates.push(
        { id: 'cert-1', session_id: 'sess-1', revoked_at: null, publication_consent_revoked_at: new Date() },
      );
      publicationQueue.push({ session_id: 'sess-1' });

      const results = await runRetention(createMockPool());
      assert.equal(results.R6, 1);
      assert.equal(publicationQueue.length, 0);
    });

    it('keeps queue rows for certs without consent revocation', async () => {
      certificates.push(
        { id: 'cert-1', session_id: 'sess-1', revoked_at: null, publication_consent_revoked_at: null },
      );
      publicationQueue.push({ session_id: 'sess-1' });

      const results = await runRetention(createMockPool());
      assert.equal(results.R6, 0);
      assert.equal(publicationQueue.length, 1);
    });
  });

  describe('dry-run mode', () => {
    it('counts but does not delete', async () => {
      magicLinkTokens.push({ id: '1', expires_at: ago(1), used_at: null });
      authSessions.push({ id: '1', expires_at: ago(1), revoked_at: null });

      const results = await runRetention(createMockPool(), { dryRun: true });
      assert.equal(results.R1, 1);
      assert.equal(results.R2, 1);
      assert.equal(magicLinkTokens.length, 1, 'tokens should not be deleted in dry run');
      assert.equal(authSessions.length, 1, 'sessions should not be deleted in dry run');
    });
  });

  describe('steps array pluggability', () => {
    it('steps array is exported and has R1–R7', () => {
      const names = steps.map(s => s.name);
      assert.deepEqual(names, ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']);
    });

    it('each step has name, description, and run function', () => {
      for (const step of steps) {
        assert.ok(typeof step.name === 'string');
        assert.ok(typeof step.description === 'string');
        assert.ok(typeof step.run === 'function');
      }
    });
  });

  describe('step failure surfacing', () => {
    it('a throwing step reports -1 and does not abort later steps', async () => {
      steps.push({
        name: 'R-FAIL',
        description: 'always throws',
        async run() { throw new Error('boom'); },
      });
      steps.push({
        name: 'R-AFTER',
        description: 'runs after the failure',
        async run() { return 0; },
      });
      try {
        const results = await runRetention(createMockPool());
        assert.equal(results['R-FAIL'], -1);
        assert.equal(results['R-AFTER'], 0);
      } finally {
        steps.pop();
        steps.pop();
      }
    });
  });

  describe('empty tables', () => {
    it('all steps return 0 on empty tables', async () => {
      const results = await runRetention(createMockPool());
      for (const key of Object.keys(results)) {
        assert.equal(results[key], 0, `${key} should return 0 on empty tables`);
      }
    });
  });
});
