#!/usr/bin/env node
/**
 * Volo Index — Practice Mode Dev Server (T2-F)
 *
 * Lightweight HTTP server for the practice interview experience.
 * Serves web/play.html and handles practice session API routes
 * using the ChatInterviewController with practice-mode configuration
 * (single dimension, tighter $0.25 cost cap, ephemeral sessions).
 *
 * Usage:
 *   node src/web/practice-server.js                  # mock LLM (no API key)
 *   ANTHROPIC_API_KEY=sk-ant-... node src/web/practice-server.js   # real LLM
 *   PORT=8080 node src/web/practice-server.js        # custom port
 *
 * Opens: http://localhost:3000/play
 *
 * When T2-B's dev-server.js merges to main, these practice routes can be
 * integrated there. This server is standalone for now.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { ChatInterviewController } from '../assessment/chat-controller.js';
import { AnthropicLlmAdapter } from '../assessment/anthropic-adapter.js';
import { LlmAdapter } from '../assessment/llm-adapter.js';
import {
  PRACTICE_HARD_CAP,
  PRACTICE_TARGET_SPEND,
  PRACTICE_DEFAULT_DIMENSION,
  practiceDimensionOrder,
} from '../assessment/practice-config.js';
import { DIMENSIONS } from '../scoring/config.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..', '..');
const PORT  = parseInt(process.env.PORT ?? '3000', 10);
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

// ── Dev mock LLM adapter (practice-specific) ───────────────────────────────

const PRACTICE_INITIAL_QUESTIONS = {
  'Strategic Engagement Design':
    'Tell me about a time you designed or significantly shaped a volunteer engagement program. What was your strategic approach and what were you trying to achieve?',
  'Recruitment, Matching & Onboarding':
    'Describe your process for recruiting volunteers for a specific initiative or campaign. What channels and methods have you found most effective, and why?',
  'Training, Development & Role Support':
    'Walk me through a volunteer training program you developed or significantly improved. What learning needs did you identify, and how did you structure the experience?',
};

const PRACTICE_FOLLOWUP =
  'Can you share a more specific example from that experience? What was the situation, what actions did you take, and what was the result?';

class PracticeMockAdapter extends LlmAdapter {
  constructor() {
    super();
    this._calls = new Map();
  }

  async complete(messages) {
    await new Promise(r => setTimeout(r, 400 + Math.random() * 600));

    const sysMsg = messages.find(m => m.role === 'system');
    const isFollowUp = sysMsg?.content?.includes('Prior candidate response');

    // Extract dimension name from system prompt
    let dimName = '';
    const topicMatch = sysMsg?.content?.match(/Topic area:\s*(.+)/i);
    if (topicMatch) dimName = topicMatch[1].trim();

    const question = isFollowUp
      ? PRACTICE_FOLLOWUP
      : (PRACTICE_INITIAL_QUESTIONS[dimName] ?? `Tell me about your experience with ${dimName || 'this area'}.`);

    return { text: question, usage: { promptTokens: 80, completionTokens: 40 } };
  }
}

// ── Practice session entry ─────────────────────────────────────────────────

class PracticeSessionEntry {
  constructor(candidateName, dimensionId, useRealLlm) {
    this.sessionId     = randomUUID();
    this.candidateName = candidateName;
    this.dimensionId   = dimensionId;
    this._questionBuf  = [];
    this._pendingFn    = null;
    this._terminal     = false;

    const adapter = useRealLlm
      ? new AnthropicLlmAdapter({
          hardCap: PRACTICE_HARD_CAP,
          targetSpend: PRACTICE_TARGET_SPEND,
        })
      : new PracticeMockAdapter();

    this.ctrl = new ChatInterviewController({
      candidateId: this.sessionId,
      llmAdapter:  adapter,
      sessionId:   this.sessionId,
      interviewOpts: {
        dimensionOrder: practiceDimensionOrder(dimensionId),
      },
    });

    this.ctrl.on('question', (data) => this._push({
      question: data.question,
      dimension: data.dimension,
    }));
    this.ctrl.on('stateChange', ({ to }) => {
      if (['completed', 'abandoned', 'cost_capped'].includes(to)) {
        this._push(null);
      }
    });

    this.ctrl.begin();
  }

  _push(data) {
    if (this._pendingFn) {
      const fn = this._pendingFn;
      this._pendingFn = null;
      fn.resolve(data);
    } else if (data === null) {
      this._terminal = true;
    } else {
      this._questionBuf.push(data);
    }
  }

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

  toStatus() {
    return {
      sessionId:     this.sessionId,
      candidateName: this.candidateName,
      dimensionId:   this.dimensionId,
      state:         this.ctrl.state,
      messages:      this.ctrl.messages,
    };
  }
}

/** @type {Map<string, PracticeSessionEntry>} */
const store = new Map();

// ── HTTP helpers ───────────────────────────────────────────────────────────

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

// ── Route handler ──────────────────────────────────────────────────────────

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

  // ── Static: serve practice page ────────────────────────────────────────
  if (method === 'GET' && (path === '/' || path === '/play' || path === '/play.html')) {
    try {
      const html = await readFile(join(ROOT, 'web', 'play.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      return errOut(res, 'web/play.html not found — run from repo root', 404);
    }
  }

  // Serve assets
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

  // ── Practice API routes ────────────────────────────────────────────────
  try {
    // POST /api/practice-sessions — create practice session
    if (method === 'POST' && path === '/api/practice-sessions') {
      const body = await readBody(req);
      const name = String(body.candidateName ?? '').trim().slice(0, 100);
      if (!name) return errOut(res, 'candidateName is required');
      const dimId = String(body.dimension ?? PRACTICE_DEFAULT_DIMENSION);

      const entry = new PracticeSessionEntry(name, dimId, HAS_KEY);
      store.set(entry.sessionId, entry);

      // Grant consent immediately (ephemeral — no transcript retention)
      entry.ctrl.grantConsent();
      const q = await entry.waitForQuestion();

      console.log(`[practice] created ${entry.sessionId} dim=${dimId} name="${name}"`);

      if (!q) {
        return jsonOut(res, {
          sessionId: entry.sessionId,
          question: null,
          dimension: dimId,
          done: true,
        }, 201);
      }

      return jsonOut(res, {
        sessionId: entry.sessionId,
        question: q.question,
        dimension: q.dimension,
        done: false,
      }, 201);
    }

    // Match practice session routes: /api/practice-sessions/:id[/sub]
    const m = path.match(/^\/api\/practice-sessions\/([^/]+)(\/[^/]+)?$/);
    if (!m) return errOut(res, 'Not found', 404);

    const sessionId = m[1];
    const sub       = m[2] ?? '';
    const entry     = store.get(sessionId);
    if (!entry) return errOut(res, 'Practice session not found', 404);

    // GET /api/practice-sessions/:id
    if (method === 'GET' && sub === '') {
      return jsonOut(res, entry.toStatus());
    }

    // POST /api/practice-sessions/:id/turn
    if (method === 'POST' && sub === '/turn') {
      if (entry.ctrl.state !== 'interviewing') {
        return errOut(res, `Cannot submit turn in state: ${entry.ctrl.state}`, 409);
      }
      const body = await readBody(req);
      const response = String(body.response ?? '').trim();
      if (!response) return errOut(res, 'response is required');

      entry.ctrl.submitResponse(response);
      const q = await entry.waitForQuestion();

      if (!q) {
        console.log(`[practice] ${sessionId} complete`);
        // No scoring for practice — just return done
        return jsonOut(res, {
          question: null,
          dimension: null,
          done: true,
          messages: entry.ctrl.messages,
        });
      }

      console.log(`[practice] ${sessionId} next question [${q.dimension}]`);
      return jsonOut(res, {
        question: q.question,
        dimension: q.dimension,
        done: false,
      });
    }

    return errOut(res, 'Not found', 404);

  } catch (err) {
    console.error('[practice-server] Error:', err.message);
    const status = err.message.includes('Timeout') ? 504 : 500;
    return errOut(res, err.message, status);
  }
});

server.listen(PORT, () => {
  const llmLabel = HAS_KEY ? 'Anthropic Claude Sonnet 4.6 (real)' : 'PracticeMockAdapter (mock)';
  console.log('\n  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
  console.log('  \u2502  Volo Index \u2014 Practice Mode Server (T2-F)          \u2502');
  console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');
  console.log(`\n  URL:      http://localhost:${PORT}/play`);
  console.log(`  LLM:      ${llmLabel}`);
  console.log(`  Cost cap: $${PRACTICE_HARD_CAP.toFixed(2)} (practice mode)`);
  console.log(`  Demo:     http://localhost:${PORT}/play?mode=mock  (browser mock)`);
  console.log('\n  Press Ctrl+C to stop\n');
});
