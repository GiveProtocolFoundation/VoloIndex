/**
 * Interview controller wiring — end-to-end tests (GIV-640)
 *
 * Verifies that POST /start creates a ChatInterviewController, questions
 * arrive via SSE, POST /respond advances the interview, turns are persisted,
 * and cleanup happens on /complete and /abandon.
 *
 * Run: node --experimental-test-module-mocks --test test/server/interview-wiring.test.js
 */

import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── DB mock ───────────────────────────────────────────────────────────

const dbCalls = [];
const persistedTurns = [];
let sessionRow;

function resetDbState() {
  dbCalls.length = 0;
  persistedTurns.length = 0;
  sessionRow = {
    id: 'test-session-id',
    user_id: 'test-user-id',
    status: 'created',
    consent_given: true,
    consent_at: '2026-07-12T00:00:00.000Z',
    started_at: null,
    completed_at: null,
    abandoned_at: null,
    abandon_reason: null,
    dimension_progress: {},
    created_at: '2026-07-12T00:00:00.000Z',
    updated_at: '2026-07-12T00:00:00.000Z',
  };
}

async function mockQuery(text, params) {
  dbCalls.push({ text, params });

  if (text.includes('FROM sessions') && text.includes('SELECT')) {
    return { rows: [{ ...sessionRow }], rowCount: 1 };
  }
  if (text.includes('FROM users')) {
    return { rows: [{ id: 'test-user-id' }], rowCount: 1 };
  }
  if (text.includes('UPDATE sessions')) {
    if (text.includes("'in_progress'")) sessionRow = { ...sessionRow, status: 'in_progress', started_at: new Date().toISOString() };
    else if (text.includes("'completed'")) sessionRow = { ...sessionRow, status: 'completed', completed_at: new Date().toISOString() };
    else if (text.includes("'abandoned'")) sessionRow = { ...sessionRow, status: 'abandoned', abandoned_at: new Date().toISOString() };
    return { rows: [{ ...sessionRow }], rowCount: 1 };
  }
  if (text.includes('MAX(turn_index)')) {
    const maxIdx = persistedTurns.length > 0
      ? Math.max(...persistedTurns.map(t => t.turnIndex))
      : -1;
    return { rows: [{ max_idx: maxIdx }] };
  }
  if (text.includes('INSERT INTO transcript_turns')) {
    // Role is hardcoded in SQL ('interviewer' or 'candidate'), not in params
    const role = text.includes("'interviewer'") ? 'interviewer' : 'candidate';
    const content = role === 'interviewer' ? params[2] : params[2];
    const dimension = role === 'interviewer' ? (params[3] ?? null) : null;
    persistedTurns.push({ sessionId: params[0], turnIndex: params[1], role, content, dimension });
    return { rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

await mock.module('../../src/server/db.js', {
  exports: {
    query: mockQuery,
    withTransaction: async (fn) => fn({ query: mockQuery }),
    pool: { query: mockQuery, on: () => {}, end: async () => {} },
    getClient: async () => ({ query: mockQuery, release: () => {} }),
  },
});

const { createApp } = await import('../../src/server/index.js');
const { MockLlmAdapter } = await import('../../src/assessment/llm-adapter.js');
const { getActiveSessions, unregisterController } = await import('../../src/server/routes/chat.js');
const { createAccessToken } = await import('../../src/server/auth/jwt.js');

// ── Helpers ───────────────────────────────────────────────────────────

// Session routes are auth-gated (requireAuth + ownership); mint a token for
// the mocked session owner using the dev fallback secret.
const AUTH = {
  Authorization: `Bearer ${createAccessToken({ id: 'test-user-id', email: 'test@example.com' }, 'dev-jwt-secret-do-not-use-in-prod')}`,
};

function req(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const r = http.request({ hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...AUTH } }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function openSSE(server, path) {
  return new Promise((resolve) => {
    const { port } = server.address();
    const clientReq = http.get({ hostname: '127.0.0.1', port, path, headers: { Accept: 'text/event-stream', ...AUTH } }, (res) => {
      const events = [];
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          if (part.startsWith(':')) continue;
          const ev = {};
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) ev.event = line.slice(7);
            if (line.startsWith('data: ')) { try { ev.data = JSON.parse(line.slice(6)); } catch { ev.data = line.slice(6); } }
          }
          if (ev.event) events.push(ev);
        }
      });
      resolve({ events, destroy: () => clientReq.destroy() });
    });
  });
}

function poll(fn, ms = 5000) {
  return new Promise((resolve, reject) => {
    const end = Date.now() + ms;
    (function tick() {
      const r = fn();
      if (r) return resolve(r);
      if (Date.now() > end) return reject(new Error('poll timeout'));
      setTimeout(tick, 20);
    })();
  });
}

// ── Suite ─────────────────────────────────────────────────────────────

describe('Interview controller wiring (GIV-640)', () => {
  let server, adapter;
  const toClean = [];

  before(async () => {
    adapter = new MockLlmAdapter({ '*': 'Tell me about a time you designed a volunteer programme.' });
    const app = createApp({
      transcriptStore: { save: async () => {}, load: async () => null, listIds: async () => [] },
      llmAdapterFactory: () => adapter,
    });
    await new Promise(r => { server = app.listen(0, r); });
  });

  after(async () => {
    toClean.forEach(fn => { try { fn(); } catch {} });
    // Force-clear any remaining active sessions so the process can exit
    for (const key of getActiveSessions().keys()) {
      unregisterController(key);
    }
    await new Promise(r => server.close(r));
  });

  beforeEach(() => {
    resetDbState();
    adapter._calls.length = 0;
    for (const key of getActiveSessions().keys()) {
      unregisterController(key);
    }
  });

  afterEach(() => {
    while (toClean.length) { try { toClean.pop()(); } catch {} }
    // Clean up any controllers that tests didn't clean
    for (const key of getActiveSessions().keys()) {
      unregisterController(key);
    }
  });

  it('POST /start registers a ChatInterviewController and calls the LLM', async () => {
    const res = await req(server, 'POST', '/api/sessions/test-session-id/start');
    assert.equal(res.status, 200);
    assert.equal(res.body.session.status, 'in_progress');

    const entry = getActiveSessions().get('test-session-id');
    assert.ok(entry?.controller, 'controller should be registered');
    assert.equal(entry.controller.state, 'interviewing');

    await poll(() => adapter.calls.length >= 1);
    assert.ok(adapter.calls[0].messages.some(m => m.content?.includes('volunteer management')));
  });

  it('SSE receives interviewerTurn after /start', async () => {
    sessionRow.status = 'in_progress';
    const sse = await openSSE(server, '/api/sessions/test-session-id/stream');
    toClean.push(sse.destroy);
    await poll(() => sse.events.find(e => e.event === 'connected'));

    sessionRow.status = 'created';
    await req(server, 'POST', '/api/sessions/test-session-id/start');

    await poll(() => sse.events.find(e => e.event === 'interviewerTurn'));
    const turn = sse.events.find(e => e.event === 'interviewerTurn');
    assert.ok(turn.data.content);
    assert.equal(turn.data.turnIndex, 0);
  });

  it('POST /respond feeds text to controller → second interviewerTurn via SSE', async () => {
    sessionRow.status = 'in_progress';
    const sse = await openSSE(server, '/api/sessions/test-session-id/stream');
    toClean.push(sse.destroy);
    await poll(() => sse.events.find(e => e.event === 'connected'));

    sessionRow.status = 'created';
    await req(server, 'POST', '/api/sessions/test-session-id/start');
    await poll(() => sse.events.find(e => e.event === 'interviewerTurn'));

    const entry = getActiveSessions().get('test-session-id');
    await poll(() => entry.controller.awaitingResponse);

    sessionRow.status = 'in_progress';
    const res = await req(server, 'POST', '/api/sessions/test-session-id/respond', {
      text: 'I designed a structured volunteer engagement programme covering recruitment, training, and retention.',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'accepted');

    await poll(() => sse.events.filter(e => e.event === 'interviewerTurn').length >= 2);
  });

  it('interviewer turns are persisted to transcript_turns', async () => {
    await req(server, 'POST', '/api/sessions/test-session-id/start');
    await poll(() => persistedTurns.some(t => t.role === 'interviewer'));

    const t = persistedTurns.find(t => t.role === 'interviewer');
    assert.equal(t.sessionId, 'test-session-id');
    assert.ok(t.content.length > 0);
  });

  it('POST /complete unregisters the controller', async () => {
    await req(server, 'POST', '/api/sessions/test-session-id/start');
    await poll(() => getActiveSessions().has('test-session-id'));

    sessionRow.status = 'in_progress';
    await req(server, 'POST', '/api/sessions/test-session-id/complete');
    assert.ok(!getActiveSessions().has('test-session-id'));
  });

  it('POST /abandon unregisters the controller', async () => {
    await req(server, 'POST', '/api/sessions/test-session-id/start');
    await poll(() => getActiveSessions().has('test-session-id'));

    sessionRow.status = 'in_progress';
    await req(server, 'POST', '/api/sessions/test-session-id/abandon', { reason: 'test' });
    assert.ok(!getActiveSessions().has('test-session-id'));
  });

  it('registerController preserves pre-connected SSE listeners', async () => {
    sessionRow.status = 'in_progress';
    const sse = await openSSE(server, '/api/sessions/test-session-id/stream');
    toClean.push(sse.destroy);
    await poll(() => sse.events.find(e => e.event === 'connected'));

    const entry = getActiveSessions().get('test-session-id');
    assert.equal(entry.listeners.size, 1);
    assert.equal(entry.controller, null);

    sessionRow.status = 'created';
    await req(server, 'POST', '/api/sessions/test-session-id/start');

    const updated = getActiveSessions().get('test-session-id');
    assert.ok(updated.controller);
    assert.equal(updated.listeners.size, 1, 'listener preserved');

    await poll(() => sse.events.find(e => e.event === 'interviewerTurn'));
  });
});
