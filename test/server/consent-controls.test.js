/**
 * Consent & rights controls — integration tests (GIV-736)
 *
 * Covers the three product controls that operationalise the GIV-733
 * controller decisions before real-user launch:
 *   1. Publication opt-in (P5): certificates private by default; public
 *      credentials API 404s without an active opt-in, 410s when revoked.
 *   2. Transcript redaction (D3): owner can remove candidate free-text
 *      from transcript_turns, the transcripts snapshot, and verbatim
 *      evidence quotes in score_results.
 *   3. 16+ age gate (D5): signup requires self-attestation.
 *
 * Run: node --experimental-test-module-mocks --test test/server/consent-controls.test.js
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAccessToken } from '../../src/server/auth/jwt.js';

// ── Mock DB ───────────────────────────────────────────────────────────

const CERT_ID    = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

const users = new Map();          // email → row
const certs = new Map();          // id → row
const sessions = new Map();       // id → row
let transcriptTurns = [];         // rows
let transcriptSnapshot = null;    // { transcript } or null
let scoreResult = null;           // row or null

function resetState() {
  users.clear();
  certs.clear();
  sessions.clear();

  users.set('existing@example.com', {
    id: 'user-123', email: 'existing@example.com', display_name: 'Existing User',
    email_verified: true, age_attested_at: null,
    entitlements: { plan: 'free', maxConcurrentSessions: 1, dailyAssessmentLimit: 3 },
  });

  certs.set(CERT_ID, {
    id: CERT_ID, session_id: SESSION_ID, user_id: 'user-123',
    holder_name: 'Existing User', overall_score: '6.20', overall_tier: 'Proficient',
    dimension_scores: { D1: { score: 6.5, tier: 'Proficient' } },
    rubric_version: '1.2', issued_at: '2026-07-20T00:00:00.000Z',
    revoked_at: null, revocation_reason: null,
    publication_consent_at: null, publication_consent_revoked_at: null,
  });

  sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: 'user-123', status: 'completed',
    consent_given: true, consent_at: '2026-07-19T00:00:00.000Z',
    started_at: null, completed_at: '2026-07-19T01:00:00.000Z',
    abandoned_at: null, abandon_reason: null, dimension_progress: {},
    created_at: '2026-07-19T00:00:00.000Z', updated_at: '2026-07-19T01:00:00.000Z',
  });

  transcriptTurns = [
    { session_id: SESSION_ID, turn_index: 0, role: 'interviewer', content: 'Tell me about your volunteering.', redacted_at: null },
    { session_id: SESSION_ID, turn_index: 1, role: 'candidate',   content: 'I organised a food drive. Also I have diabetes.', redacted_at: null },
    { session_id: SESSION_ID, turn_index: 2, role: 'interviewer', content: 'What was the outcome?', redacted_at: null },
    { session_id: SESSION_ID, turn_index: 3, role: 'candidate',   content: 'We fed 200 families over six months.', redacted_at: null },
  ];

  transcriptSnapshot = {
    transcript: {
      turns: transcriptTurns.map(t => ({ role: t.role, content: t.content })),
    },
  };

  scoreResult = {
    id: 'sr-1',
    session_id: SESSION_ID,
    signals: [{
      id: 'sig-D1-001', dimension: 'D1', type: 'S2',
      evidenceRef: { turnIndex: 1, spanText: 'I organised a food drive' },
      excerpt: 'I organised a food drive',
    }, {
      id: 'sig-D1-002', dimension: 'D1', type: 'S1',
      evidenceRef: { turnIndex: 3, spanText: 'We fed 200 families' },
      excerpt: 'We fed 200 families',
    }],
    details: { dropped: [{ evidenceRef: { turnIndex: 1, spanText: 'I have diabetes' } }] },
  };
}

async function mockQuery(text, params) {
  // ── users ──
  if (text.includes('SELECT id FROM users WHERE email')) {
    const u = users.get(params[0]);
    return { rows: u ? [{ id: u.id }] : [], rowCount: u ? 1 : 0 };
  }
  if (text.includes('INSERT INTO users') && text.includes('ON CONFLICT')) {
    let u = users.get(params[0]);
    if (!u) {
      u = { id: `user-${users.size + 1}`, email: params[0], display_name: null, email_verified: false, age_attested_at: null, entitlements: {} };
      users.set(params[0], u);
    }
    return { rows: [u], rowCount: 1 };
  }
  if (text.includes('UPDATE users SET age_attested_at')) {
    const u = users.get(params[0]);
    if (u && u.age_attested_at == null) u.age_attested_at = new Date().toISOString();
    return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
  }
  if (text.includes('INSERT INTO magic_link_tokens')) {
    return { rows: [], rowCount: 1 };
  }

  // ── certificates: owner lookup ──
  if (text.includes('FROM certificates WHERE id = $1 AND user_id = $2')) {
    const c = certs.get(params[0]);
    const hit = c && c.user_id === params[1];
    return { rows: hit ? [{ ...c }] : [], rowCount: hit ? 1 : 0 };
  }
  // ── certificates: publish ──
  if (text.includes('SET publication_consent_at = NOW()')) {
    const c = certs.get(params[0]);
    if (c) { c.publication_consent_at = new Date().toISOString(); c.publication_consent_revoked_at = null; }
    return { rows: c ? [{ ...c }] : [], rowCount: c ? 1 : 0 };
  }
  // ── certificates: unpublish ──
  if (text.includes('SET publication_consent_revoked_at = COALESCE')) {
    const c = certs.get(params[0]);
    if (c && c.publication_consent_revoked_at == null) c.publication_consent_revoked_at = new Date().toISOString();
    return { rows: c ? [{ ...c }] : [], rowCount: c ? 1 : 0 };
  }
  // ── public credentials join ──
  if (text.includes('FROM certificates c')) {
    const c = certs.get(params[0]);
    return { rows: c ? [{ ...c, publication_status: 'published' }] : [], rowCount: c ? 1 : 0 };
  }

  // ── sessions ──
  if (text.includes('FROM sessions WHERE id = $1')) {
    const s = sessions.get(params[0]);
    return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
  }

  // ── transcript_turns redaction ──
  if (text.includes('UPDATE transcript_turns') && text.includes('redacted_at IS NULL')) {
    const wanted = text.includes('ANY($3') ? new Set(params[2]) : null;
    const hit = [];
    for (const t of transcriptTurns) {
      if (t.session_id !== params[0] || t.role !== 'candidate' || t.redacted_at != null) continue;
      if (wanted && !wanted.has(t.turn_index)) continue;
      t.content = params[1];
      t.redacted_at = new Date().toISOString();
      hit.push({ turn_index: t.turn_index });
    }
    return { rows: hit, rowCount: hit.length };
  }

  // ── transcripts snapshot ──
  if (text.includes('SELECT transcript FROM transcripts')) {
    return transcriptSnapshot
      ? { rows: [{ transcript: transcriptSnapshot.transcript }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (text.includes('UPDATE transcripts SET transcript')) {
    if (transcriptSnapshot) transcriptSnapshot.transcript = JSON.parse(params[1]);
    return { rowCount: 1 };
  }

  // ── score_results scrub ──
  if (text.includes('SELECT id, signals, details FROM score_results')) {
    return scoreResult
      ? { rows: [{ id: scoreResult.id, signals: scoreResult.signals, details: scoreResult.details }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (text.includes('UPDATE score_results SET signals')) {
    if (scoreResult) {
      scoreResult.signals = JSON.parse(params[1]);
      scoreResult.details = params[2] == null ? null : JSON.parse(params[2]);
    }
    return { rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
}

await mock.module('../../src/server/db.js', {
  namedExports: {
    query: mockQuery,
    withTransaction: async (fn) => fn({ query: mockQuery }),
    pool: { query: mockQuery, on: () => {}, end: async () => {} },
    getClient: async () => ({ query: mockQuery, release: () => {} }),
  },
});

const { createApp } = await import('../../src/server/index.js');
const { scrubEvidenceQuotes, REDACTION_PLACEHOLDER } = await import('../../src/server/routes/sessions.js');
const { isPubliclyVisible } = await import('../../src/server/routes/certificates.js');

// ── Helpers ───────────────────────────────────────────────────────────

function req(server, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const hdrs = { 'Content-Type': 'application/json', ...headers };
    const r = http.request({ hostname: '127.0.0.1', port, path, method, headers: hdrs }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function authHeader(userId = 'user-123', email = 'existing@example.com') {
  const token = createAccessToken({ id: userId, email }, 'dev-jwt-secret-do-not-use-in-prod');
  return { Authorization: `Bearer ${token}` };
}

// ── Test suite ────────────────────────────────────────────────────────

describe('Consent & rights controls (GIV-736)', () => {
  let server;

  before(async () => {
    const app = createApp({
      transcriptStore: { save: async () => {}, load: async () => null, listIds: async () => [] },
    });
    await new Promise(r => { server = app.listen(0, r); });
  });

  after(async () => {
    await new Promise(r => server.close(r));
  });

  beforeEach(() => {
    resetState();
  });

  // ── 1. Publication opt-in ─────────────────────────────────────────

  describe('publication opt-in (P5)', () => {
    it('public credentials API 404s for a cert without an opt-in (default private)', async () => {
      const res = await req(server, 'GET', `/api/credentials/${CERT_ID}`);
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'CERT_NOT_FOUND');
    });

    it('publish requires explicit { consent: true }', async () => {
      const res = await req(server, 'POST', `/api/certificates/${CERT_ID}/publish`, {}, authHeader());
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'CONSENT_REQUIRED');
      // and the cert stayed private
      const pub = await req(server, 'GET', `/api/credentials/${CERT_ID}`);
      assert.equal(pub.status, 404);
    });

    it('owner opt-in makes the credential publicly resolvable', async () => {
      const res = await req(server, 'POST', `/api/certificates/${CERT_ID}/publish`, { consent: true }, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.cert.isPublic, true);
      assert.ok(res.body.cert.publicationConsentAt);

      const pub = await req(server, 'GET', `/api/credentials/${CERT_ID}`);
      assert.equal(pub.status, 200);
      assert.equal(pub.body.cert.holderName, 'Existing User');
      assert.equal(pub.body.cert.tier, 'Proficient');
    });

    it('public payload never contains email, user_id, session_id, or transcript', async () => {
      await req(server, 'POST', `/api/certificates/${CERT_ID}/publish`, { consent: true }, authHeader());
      const pub = await req(server, 'GET', `/api/credentials/${CERT_ID}`);
      const json = JSON.stringify(pub.body).toLowerCase();
      for (const banned of ['email', 'user_id', 'userid', 'session_id', 'sessionid', 'transcript', 'example.com']) {
        assert.ok(!json.includes(banned), `public payload leaked "${banned}": ${json}`);
      }
    });

    it('unpublish revokes the opt-in and the credential 404s again', async () => {
      await req(server, 'POST', `/api/certificates/${CERT_ID}/publish`, { consent: true }, authHeader());
      const res = await req(server, 'POST', `/api/certificates/${CERT_ID}/unpublish`, {}, authHeader());
      assert.equal(res.status, 200);
      assert.equal(res.body.cert.isPublic, false);

      const pub = await req(server, 'GET', `/api/credentials/${CERT_ID}`);
      assert.equal(pub.status, 404);
    });

    it('a revoked certificate returns 410 with no credential data', async () => {
      await req(server, 'POST', `/api/certificates/${CERT_ID}/publish`, { consent: true }, authHeader());
      certs.get(CERT_ID).revoked_at = new Date().toISOString();

      const pub = await req(server, 'GET', `/api/credentials/${CERT_ID}`);
      assert.equal(pub.status, 410);
      assert.equal(pub.body.error.code, 'CERT_REVOKED');
      assert.equal(pub.body.cert, undefined);
    });

    it('publish/unpublish are owner-only', async () => {
      const other = authHeader('user-999', 'attacker@example.com');
      const res = await req(server, 'POST', `/api/certificates/${CERT_ID}/publish`, { consent: true }, other);
      assert.equal(res.status, 404); // not found for non-owner — existence not confirmed
      const res2 = await req(server, 'POST', `/api/certificates/${CERT_ID}/unpublish`, {}, other);
      assert.equal(res2.status, 404);
    });

    it('publish on a revoked certificate is rejected', async () => {
      certs.get(CERT_ID).revoked_at = new Date().toISOString();
      const res = await req(server, 'POST', `/api/certificates/${CERT_ID}/publish`, { consent: true }, authHeader());
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'CERT_REVOKED');
    });

    it('isPubliclyVisible: default private, opt-in public, revocation wins', () => {
      assert.equal(isPubliclyVisible({ revoked_at: null, publication_consent_at: null, publication_consent_revoked_at: null }), false);
      assert.equal(isPubliclyVisible({ revoked_at: null, publication_consent_at: 'x', publication_consent_revoked_at: null }), true);
      assert.equal(isPubliclyVisible({ revoked_at: null, publication_consent_at: 'x', publication_consent_revoked_at: 'y' }), false);
      assert.equal(isPubliclyVisible({ revoked_at: 'z', publication_consent_at: 'x', publication_consent_revoked_at: null }), false);
    });
  });

  // ── 2. Transcript redaction ───────────────────────────────────────

  describe('transcript redaction (D3)', () => {
    it('redacts selected candidate turns everywhere the text is stored', async () => {
      const res = await req(server, 'POST', `/api/sessions/${SESSION_ID}/redact`, { turnIndexes: [1] }, authHeader());
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.redactedTurnIndexes, [1]);
      assert.equal(res.body.snapshotUpdated, true);
      assert.equal(res.body.scoreResultScrubbed, true);

      // per-turn row replaced
      assert.equal(transcriptTurns[1].content, REDACTION_PLACEHOLDER);
      assert.ok(transcriptTurns[1].redacted_at);
      // other turns untouched
      assert.equal(transcriptTurns[0].content, 'Tell me about your volunteering.');
      assert.equal(transcriptTurns[3].content, 'We fed 200 families over six months.');
      // snapshot replaced at same index
      assert.equal(transcriptSnapshot.transcript.turns[1].content, REDACTION_PLACEHOLDER);
      assert.equal(transcriptSnapshot.transcript.turns[3].content, 'We fed 200 families over six months.');
      // verbatim evidence quotes scrubbed for the redacted turn only
      assert.equal(scoreResult.signals[0].evidenceRef.spanText, REDACTION_PLACEHOLDER);
      assert.equal(scoreResult.signals[0].excerpt, REDACTION_PLACEHOLDER);
      assert.equal(scoreResult.signals[1].evidenceRef.spanText, 'We fed 200 families');
      assert.equal(scoreResult.signals[1].excerpt, 'We fed 200 families');
      // nested details scrubbed too
      assert.equal(scoreResult.details.dropped[0].evidenceRef.spanText, REDACTION_PLACEHOLDER);
    });

    it('all:true redacts every candidate turn, never interviewer turns', async () => {
      const res = await req(server, 'POST', `/api/sessions/${SESSION_ID}/redact`, { all: true }, authHeader());
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.redactedTurnIndexes, [1, 3]);
      assert.equal(transcriptTurns[0].content, 'Tell me about your volunteering.');
      assert.equal(transcriptTurns[2].content, 'What was the outcome?');
      assert.equal(transcriptTurns[1].content, REDACTION_PLACEHOLDER);
      assert.equal(transcriptTurns[3].content, REDACTION_PLACEHOLDER);
    });

    it('rejects requests without turnIndexes or all:true', async () => {
      const res = await req(server, 'POST', `/api/sessions/${SESSION_ID}/redact`, {}, authHeader());
      assert.equal(res.status, 400);
      const res2 = await req(server, 'POST', `/api/sessions/${SESSION_ID}/redact`, { turnIndexes: ['x'] }, authHeader());
      assert.equal(res2.status, 400);
    });

    it('is owner-only', async () => {
      const res = await req(server, 'POST', `/api/sessions/${SESSION_ID}/redact`, { all: true },
        authHeader('user-999', 'attacker@example.com'));
      assert.equal(res.status, 403);
      assert.equal(transcriptTurns[1].content, 'I organised a food drive. Also I have diabetes.');
    });

    it('scrubEvidenceQuotes only touches quotes for redacted turn indexes', () => {
      const signals = [
        { evidenceRef: { turnIndex: 5, spanText: 'keep me' }, excerpt: 'keep me' },
        { evidenceRef: { turnIndex: 7, spanText: 'remove me' }, excerpt: 'remove me' },
      ];
      scrubEvidenceQuotes(signals, new Set([7]));
      assert.equal(signals[0].evidenceRef.spanText, 'keep me');
      assert.equal(signals[0].excerpt, 'keep me');
      assert.equal(signals[1].evidenceRef.spanText, REDACTION_PLACEHOLDER);
      assert.equal(signals[1].excerpt, REDACTION_PLACEHOLDER);
    });
  });

  // ── 3. 16+ age gate ───────────────────────────────────────────────

  describe('16+ age gate (D5)', () => {
    it('rejects signup for a new email without the attestation', async () => {
      const res = await req(server, 'POST', '/auth/magic-link', { email: 'newuser@example.com' });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'AGE_ATTESTATION_REQUIRED');
      assert.equal(users.has('newuser@example.com'), false); // no user row created
    });

    it('creates the account and records the attestation when confirmed', async () => {
      const res = await req(server, 'POST', '/auth/magic-link', { email: 'newuser@example.com', ageAttested: true });
      assert.equal(res.status, 200);
      const u = users.get('newuser@example.com');
      assert.ok(u, 'user row created');
      assert.ok(u.age_attested_at, 'age_attested_at recorded');
    });

    it('does not lock out existing users who sign in without re-ticking', async () => {
      const res = await req(server, 'POST', '/auth/magic-link', { email: 'existing@example.com' });
      assert.equal(res.status, 200);
      assert.equal(users.get('existing@example.com').age_attested_at, null);
    });

    it('backfills the attestation for an existing user who ticks the box', async () => {
      const res = await req(server, 'POST', '/auth/magic-link', { email: 'existing@example.com', ageAttested: true });
      assert.equal(res.status, 200);
      assert.ok(users.get('existing@example.com').age_attested_at);
    });

    it('rejects a truthy-but-not-true attestation value', async () => {
      const res = await req(server, 'POST', '/auth/magic-link', { email: 'newuser2@example.com', ageAttested: 'yes' });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'AGE_ATTESTATION_REQUIRED');
    });
  });
});
