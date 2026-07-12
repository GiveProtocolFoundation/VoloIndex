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

    const response = await this._fetch(`${this._baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this._apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

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
