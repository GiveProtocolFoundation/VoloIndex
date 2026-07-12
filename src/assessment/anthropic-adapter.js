/**
 * Volo Index — Anthropic Claude LLM Adapter (P2b)
 *
 * Concrete LlmAdapter implementation using Anthropic Claude Sonnet 4.6.
 * Per-session cost tracking with hard cap ($2.00) and target warning ($0.50).
 *
 * Security posture:
 * - API key via ANTHROPIC_API_KEY env var only (never committed, never logged)
 * - Candidate/transcript content passed as user messages (data), never
 *   interpolated into system prompts (prompt-injection defence)
 */

import { LlmAdapter } from './llm-adapter.js';

// ── Pricing (Sonnet 4.6, per-token USD) ─────────────────────────────

const SONNET_INPUT_PRICE_PER_TOKEN  = 3.0 / 1_000_000;   // $3/MTok
const SONNET_OUTPUT_PRICE_PER_TOKEN = 15.0 / 1_000_000;   // $15/MTok

// ── Cost cap defaults ────────────────────────────────────────────────

const DEFAULT_TARGET_SPEND = 0.50;
const DEFAULT_HARD_CAP     = 2.00;

// ── Retry config ─────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES      = 3;
const RETRY_BASE_DELAY_MS      = 500;

/**
 * HTTP status codes that are transient infrastructure errors — safe to retry.
 * 4xx codes are NOT included: they indicate caller mistakes and must not be retried.
 */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 529]);

/** @param {number} ms */
async function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Error types ──────────────────────────────────────────────────────

export class CostCapExceededError extends Error {
  /**
   * @param {{ sessionSpend: number, hardCap: number, requestedInputTokens?: number }} detail
   */
  constructor(detail) {
    super(`Session cost cap exceeded: spent $${detail.sessionSpend.toFixed(4)} of $${detail.hardCap.toFixed(2)} hard cap`);
    this.name = 'CostCapExceededError';
    this.code = 'COST_CAP_EXCEEDED';
    this.sessionSpend = detail.sessionSpend;
    this.hardCap = detail.hardCap;
  }
}

export class AnthropicApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'AnthropicApiError';
    this.status = status;
    this.body = body;
  }
}

// ── Adapter ──────────────────────────────────────────────────────────

/**
 * Anthropic Claude adapter with per-session cost tracking.
 *
 * @extends LlmAdapter
 */
export class AnthropicLlmAdapter extends LlmAdapter {
  /**
   * @param {{
   *   apiKey?: string,
   *   model?: string,
   *   targetSpend?: number,
   *   hardCap?: number,
   *   baseUrl?: string,
   *   fetch?: typeof globalThis.fetch,
   *   maxRetries?: number,
   *   sleep?: (ms: number) => Promise<void>,
   * }} [opts]
   */
  constructor(opts = {}) {
    super();
    this._apiKey   = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this._model    = opts.model ?? 'claude-sonnet-4-6';
    this._targetSpend = opts.targetSpend ?? DEFAULT_TARGET_SPEND;
    this._hardCap     = opts.hardCap ?? DEFAULT_HARD_CAP;
    this._baseUrl     = opts.baseUrl ?? 'https://api.anthropic.com';
    this._fetch       = opts.fetch ?? globalThis.fetch;
    this._maxRetries  = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this._sleep       = opts.sleep ?? defaultSleep;

    if (!this._apiKey) {
      throw new Error('AnthropicLlmAdapter requires ANTHROPIC_API_KEY (env or constructor opt)');
    }

    // Per-session cost accounting
    this._totalInputTokens  = 0;
    this._totalOutputTokens = 0;
    this._totalSpend        = 0;
    this._targetWarningEmitted = false;
    this._calls = 0;
  }

  // ── Cost accessors ─────────────────────────────────────────────────

  get totalInputTokens()  { return this._totalInputTokens; }
  get totalOutputTokens() { return this._totalOutputTokens; }
  get totalSpend()        { return this._totalSpend; }
  get hardCap()           { return this._hardCap; }
  get targetSpend()       { return this._targetSpend; }
  get targetWarningEmitted() { return this._targetWarningEmitted; }
  get callCount()         { return this._calls; }

  // ── Interface implementation ───────────────────────────────────────

  /**
   * @param {import('./llm-adapter.js').LlmMessage[]} messages
   * @param {import('./llm-adapter.js').LlmCompletionOpts} [opts]
   * @returns {Promise<import('./llm-adapter.js').LlmCompletionResult>}
   */
  async complete(messages, opts = {}) {
    // Enforce hard cap BEFORE making the call
    if (this._totalSpend >= this._hardCap) {
      throw new CostCapExceededError({
        sessionSpend: this._totalSpend,
        hardCap: this._hardCap,
      });
    }

    const { system, apiMessages } = this._convertMessages(messages);

    const body = {
      model: this._model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0,
      messages: apiMessages,
    };

    if (system) {
      body.system = system;
    }

    const fetchOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this._apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    };

    const response = await this._fetchWithRetry(`${this._baseUrl}/v1/messages`, fetchOpts);

    if (!response.ok) {
      let errBody;
      try { errBody = await response.text(); } catch { errBody = ''; }
      throw new AnthropicApiError(
        `Anthropic API returned ${response.status}`,
        { status: response.status, body: errBody },
      );
    }

    const data = await response.json();

    // Extract text from content blocks
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const usage = {
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    };

    // Update session cost accounting
    this._totalInputTokens  += usage.promptTokens;
    this._totalOutputTokens += usage.completionTokens;
    this._totalSpend += (usage.promptTokens * SONNET_INPUT_PRICE_PER_TOKEN)
                      + (usage.completionTokens * SONNET_OUTPUT_PRICE_PER_TOKEN);
    this._calls++;

    // Emit target warning (once)
    if (!this._targetWarningEmitted && this._totalSpend >= this._targetSpend) {
      this._targetWarningEmitted = true;
    }

    // Check hard cap AFTER the call (prevent subsequent calls)
    if (this._totalSpend >= this._hardCap) {
      // The call itself succeeded but the session should not make further calls.
      // Return this result; the next call will throw CostCapExceededError.
    }

    return { text, usage };
  }

  // ── Internal helpers ───────────────────────────────────────────────

  /**
   * Fetch with bounded exponential-backoff retries on transient 5xx errors.
   * Network errors (fetch throws) are also retried.
   * 4xx errors are never retried — they are caller mistakes.
   *
   * @param {string} url
   * @param {object} fetchOpts
   * @returns {Promise<Response>}  The last response (ok or not); caller checks .ok
   */
  async _fetchWithRetry(url, fetchOpts) {
    let lastResponse;

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
        await this._sleep(delayMs);
      }

      let resp;
      try {
        resp = await this._fetch(url, fetchOpts);
      } catch (networkErr) {
        // Transient network-level failure (DNS, TCP reset, etc.)
        if (attempt >= this._maxRetries) throw networkErr;
        continue;
      }

      // Success
      if (resp.ok) return resp;

      // 4xx — caller mistake, never retry
      if (!RETRYABLE_STATUSES.has(resp.status)) return resp;

      // Retryable 5xx
      lastResponse = resp;
      if (attempt >= this._maxRetries) break;
      // else loop continues
    }

    return lastResponse;
  }

  /**
   * Convert LlmMessage[] (system/user/assistant roles) to Anthropic API format.
   * Anthropic expects system as a top-level param, messages are user/assistant only.
   */
  _convertMessages(messages) {
    let system = null;
    const apiMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Concatenate multiple system messages (shouldn't happen, but safe)
        system = system ? `${system}\n\n${msg.content}` : msg.content;
      } else {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    return { system, apiMessages };
  }
}
