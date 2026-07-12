#!/usr/bin/env node
/**
 * Volo Index — Assessment Dev Server (T2-B)
 *
 * Minimal HTTP server wrapping the Assessment Engine library for frontend
 * development. Implements the T2-A API contract (docs/API-CONTRACT-T2A.md)
 * so the web app can be developed and demoed without a production backend.
 *
 * NOT for production — T2-A delivers the production backend with Postgres,
 * real auth, rate limiting, and durable session storage.
 *
 * Usage:
 *   node src/web/dev-server.js                  # mock LLM (no API key needed)
 *   ANTHROPIC_API_KEY=sk-ant-... node src/web/dev-server.js   # real Sonnet 4.6
 *   PORT=8080 node src/web/dev-server.js        # custom port
 *
 * Opens: http://localhost:3000  (or ?mock=1 for the browser-side mock)
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { ChatInterviewController } from '../assessment/chat-controller.js';
import { AnthropicLlmAdapter } from '../assessment/anthropic-adapter.js';
import { LlmAdapter } from '../assessment/llm-adapter.js';
import { extractSignals } from '../assessment/extractor.js';
import { scoreAssessment } from '../scoring/engine.js';
import { DIMENSIONS } from '../scoring/config.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..', '..');
const PORT  = parseInt(process.env.PORT ?? '3000', 10);
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

// ── Dev mock LLM adapter ──────────────────────────────────────────────────────
//
// Used when ANTHROPIC_API_KEY is not set. Returns realistic interview questions
// based on which dimension is being asked about (detected from the user message
// "Generate the next question for topic: <dimension name>").

const INITIAL_QUESTIONS = {
  'Strategic Engagement Design':
    'Tell me about a time you designed a volunteer engagement program. What was your strategic approach and what did you aim to achieve?',
  'Recruitment, Matching & Onboarding':
    'Describe your process for recruiting volunteers for a specific initiative. What channels did you use and how did you match them to roles?',
  'Training, Development & Role Support':
    'Walk me through a training program you developed for volunteers. What did you identify as the key learning needs?',
  'Performance, Impact & Accountability':
    'How do you measure volunteer performance and program impact? Can you share a specific example?',
  'Recognition, Retention & Culture':
    'What strategies have you used to recognise and retain volunteers over time? What worked particularly well?',
  'Ethics, Equity & Advocacy':
    'Describe a situation where you had to address an ethical concern or equity issue in your volunteer program.',
};

const FOLLOWUP_TEMPLATE =
  'Can you give a more specific example from that experience? What was the situation, what did you do, and what was the outcome?';

class DevInterviewAdapter extends LlmAdapter {
  constructor() {
    super();
    /** @type {Map<string, number>} dimName → call count */
    this._calls = new Map();
  }

  async complete(messages) {
    // Simulate LLM latency
    await new Promise(r => setTimeout(r, 400 + Math.random() * 600));

    const userMsg = [...messages].reverse().find(m => m.role === 'user');
    const sysMsg  = messages.find(m => m.role === 'system');

    // Extract dimension name from user message: "Generate the next question for topic: D"
    const topicMatch = userMsg?.content?.match(/topic:\s*(.+)$/i);
    const dimName    = topicMatch?.[1]?.trim() ?? '';

    const callCount = this._calls.get(dimName) ?? 0;
    this._calls.set(dimName, callCount + 1);

    const isFollowUp = sysMsg?.content?.includes('Prior candidate response');

    const question = isFollowUp
      ? FOLLOWUP_TEMPLATE
      : (INITIAL_QUESTIONS[dimName] ?? `Tell me about your experience with ${dimName || 'this area'}.`);

    return { text: question, usage: { promptTokens: 80, completionTokens: 40 } };
  }
}

// ── Session entry ────────────────────────────────────────────────────────────
//
// Bridges the async event-driven ChatInterviewController to synchronous HTTP.
// Each session keeps a question buffer and a pending-resolve slot so that
// POST /turn can wait (long-poll) until the next question arrives from the LLM.

class SessionEntry {
  /**
   * @param {string} candidateName
   * @param {boolean} useRealLlm
   */
  constructor(candidateName, useRealLlm) {
    this.sessionId     = randomUUID();
    this.candidateName = candidateName;
    this._questionBuf  = [];   // buffered questions not yet consumed
    this._pendingFn    = null; // resolve/reject for in-flight waitForQuestion()
    this._terminal     = false;

    const adapter = useRealLlm ? new AnthropicLlmAdapter() : new DevInterviewAdapter();
    this._adapter = adapter;

    this.ctrl = new ChatInterviewController({
      candidateId: this.sessionId,
      llmAdapter:  adapter,
      sessionId:   this.sessionId,
    });

    // Wire controller events → question buffer
    this.ctrl.on('question',     (data)    => this._push({ question: data.question, dimension: data.dimension }));
    this.ctrl.on('stateChange',  ({ to })  => {
      if (['completed', 'abandoned', 'cost_capped'].includes(to)) {
        this._push(null); // terminal signal
      }
    });

    this.ctrl.begin(); // → consent_pending
  }

  /** Push a question (or null for terminal) into the buffer / waiting promise. */
  _push(data) {
    if (this._pendingFn) {
      const fn = this._pendingFn;
      this._pendingFn = null;
      fn.resolve(data);
    } else {
      if (data === null) {
        this._terminal = true;
      } else {
        this._questionBuf.push(data);
      }
    }
  }

  /**
   * Wait for the next question from the LLM (or null on terminal state).
   * Long-polls for up to timeoutMs ms; rejects on timeout.
   * @param {number} [timeoutMs=90000]
   * @returns {Promise<{question:string,dimension:string}|null>}
   */
  waitForQuestion(timeoutMs = 90_000) {
    if (this._questionBuf.length > 0) return Promise.resolve(this._questionBuf.shift());
    if (this._terminal) return Promise.resolve(null);

    return new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this._pendingFn = null;
          reject(new Error('Timeout waiting for LLM question (>90s)'));
        }
      }, timeoutMs);

      this._pendingFn = {
        resolve: (v) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(v);
          }
        },
      };
    });
  }

  /**
   * Run extractSignals + scoreAssessment on the completed session transcript.
   * Returns null if extraction/scoring fails (non-fatal for the response).
   */
  async computeScore() {
    const transcript = this.ctrl.session?.transcript;
    if (!transcript || !Array.isArray(transcript.turns) || transcript.turns.length === 0) return null;

    try {
      const extraction = await extractSignals(transcript, this._adapter);

      // Group signals by dimension for scoreAssessment
      const byDim = Object.fromEntries(DIMENSIONS.map(d => [d.id, []]));
      for (const sig of extraction.signals) {
        if (byDim[sig.dimension]) byDim[sig.dimension].push(sig);
      }

      const result = scoreAssessment({ dimensions: byDim });

      // Reshape to T2-B contract shape
      return {
        overall: result.overall,
        dimensions: result.dimensions.map(d => ({
          id:                 d.id,
          name:               d.name,
          score:              d.insufficientEvidence ? null : d.score,
          tier:               d.insufficientEvidence ? null : d.tier,
          insufficientEvidence: d.insufficientEvidence,
        })),
        rubricVersion:     result.rubricVersion,
        publicationStatus: 'pending_review', // D5: always pending in dev server
      };
    } catch (err) {
      console.error('[dev-server] Score computation failed:', err.message);
      return null;
    }
  }

  toStatus() {
    return {
      sessionId:        this.sessionId,
      candidateName:    this.candidateName,
      state:            this.ctrl.state,
      typing:           this.ctrl.typing,
      messages:         this.ctrl.messages,
      currentDimension: this.ctrl.currentDimension,
    };
  }
}

/** @type {Map<string, SessionEntry>} */
const store = new Map();

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function jsonOut(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function errOut(res, message, status = 400) {
  jsonOut(res, { error: message }, status);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const path   = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // ── Static: serve web app ─────────────────────────────────────────────
  if (method === 'GET' && (path === '/' || path === '/app.html')) {
    try {
      const html = await readFile(join(ROOT, 'web', 'app.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      return errOut(res, 'web/app.html not found — run from repo root', 404);
    }
  }

  // Serve Assets/* at /assets/*
  if (method === 'GET' && path.startsWith('/assets/')) {
    const name = path.slice('/assets/'.length);
    const ext  = name.split('.').pop();
    const mime = { svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon' }[ext] ?? 'application/octet-stream';
    try {
      const data = await readFile(join(ROOT, 'Assets', name));
      res.writeHead(200, { 'Content-Type': mime });
      return res.end(data);
    } catch {
      return errOut(res, 'Not found', 404);
    }
  }

  // ── API routes ────────────────────────────────────────────────────────
  try {
    // POST /api/sessions — create session
    if (method === 'POST' && path === '/api/sessions') {
      const body = await readBody(req);
      const name = String(body.candidateName ?? '').trim().slice(0, 100);
      if (!name) return errOut(res, 'candidateName is required');
      const entry = new SessionEntry(name, HAS_KEY);
      store.set(entry.sessionId, entry);
      console.log(`[session] created ${entry.sessionId} name="${name}"`);
      return jsonOut(res, { sessionId: entry.sessionId, state: 'consent_pending' }, 201);
    }

    // Match session-scoped paths: /api/sessions/:id[/sub]
    const m = path.match(/^\/api\/sessions\/([^/]+)(\/[^/]+)?$/);
    if (!m) return errOut(res, 'Not found', 404);

    const sessionId = m[1];
    const sub       = m[2] ?? '';
    const entry     = store.get(sessionId);
    if (!entry) return errOut(res, 'Session not found', 404);

    // GET /api/sessions/:id
    if (method === 'GET' && sub === '') {
      return jsonOut(res, entry.toStatus());
    }

    // POST /api/sessions/:id/consent
    if (method === 'POST' && sub === '/consent') {
      if (entry.ctrl.state !== 'consent_pending') {
        return errOut(res, `Cannot grant consent in state: ${entry.ctrl.state}`, 409);
      }
      const body = await readBody(req);
      if (body.grant === false) {
        entry.ctrl.declineConsent();
        return jsonOut(res, { state: 'abandoned', question: null, dimension: null });
      }
      console.log(`[session] ${sessionId} consent granted — waiting for first question`);
      entry.ctrl.grantConsent();
      const q = await entry.waitForQuestion();
      if (!q) {
        return jsonOut(res, { state: entry.ctrl.state, question: null, dimension: null });
      }
      console.log(`[session] ${sessionId} first question delivered [${q.dimension}]`);
      return jsonOut(res, { state: 'interviewing', question: q.question, dimension: q.dimension });
    }

    // POST /api/sessions/:id/turn
    if (method === 'POST' && sub === '/turn') {
      if (entry.ctrl.state !== 'interviewing') {
        return errOut(res, `Cannot submit turn in state: ${entry.ctrl.state}`, 409);
      }
      const body     = await readBody(req);
      const response = String(body.response ?? '').trim();
      if (!response) return errOut(res, 'response is required');

      entry.ctrl.submitResponse(response);
      const q = await entry.waitForQuestion();

      if (!q) {
        // Terminal — compute score if completed
        const state = entry.ctrl.state;
        console.log(`[session] ${sessionId} terminal: ${state}`);
        const score = state === 'completed' ? await entry.computeScore() : null;
        return jsonOut(res, { state, question: null, dimension: null, score, messages: entry.ctrl.messages });
      }

      console.log(`[session] ${sessionId} next question [${q.dimension}]`);
      return jsonOut(res, { state: 'interviewing', question: q.question, dimension: q.dimension });
    }

    return errOut(res, 'Not found', 404);

  } catch (err) {
    console.error('[dev-server] Error:', err.message);
    const status = err.message.includes('Timeout') ? 504 : 500;
    return errOut(res, err.message, status);
  }
});

server.listen(PORT, () => {
  const llmLabel = HAS_KEY ? 'Anthropic Claude Sonnet 4.6 (real)' : 'DevInterviewAdapter (mock — no API key)';
  console.log('\n  ┌─────────────────────────────────────────────────────┐');
  console.log('  │  Volo Index Assessment — Dev Server                  │');
  console.log('  └─────────────────────────────────────────────────────┘');
  console.log(`\n  URL:  http://localhost:${PORT}`);
  console.log(`  LLM:  ${llmLabel}`);
  console.log(`  Demo: http://localhost:${PORT}/?mock=1  (browser mock, no server calls)`);
  console.log('\n  Press Ctrl+C to stop\n');
});
