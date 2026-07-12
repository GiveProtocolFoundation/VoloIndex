/**
 * Volo Index — AnthropicLlmAdapter unit tests (P2b)
 *
 * Tests cost accounting, hard cap, target warning, message conversion,
 * and error handling using a stubbed fetch transport (no live API calls).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AnthropicLlmAdapter,
  CostCapExceededError,
  AnthropicApiError,
} from '../src/assessment/anthropic-adapter.js';

// ── Helpers: stubbed fetch ────────────────────────────────────────────

/**
 * Creates a fake fetch that returns a canned Anthropic Messages API response.
 * @param {{ text?: string, inputTokens?: number, outputTokens?: number }} [overrides]
 */
function stubFetch({ text = '{"signals":[]}', inputTokens = 100, outputTokens = 50 } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => ({
        id: 'msg_stub',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text }],
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }),
    };
  };
  fn.calls = calls;
  return fn;
}

function stubFetchError(status, body = 'error') {
  return async () => ({
    ok: false,
    status,
    text: async () => body,
  });
}

function makeAdapter(opts = {}) {
  return new AnthropicLlmAdapter({
    apiKey: 'sk-test-key',
    fetch: opts.fetch ?? stubFetch(),
    ...opts,
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AnthropicLlmAdapter', () => {
  describe('constructor', () => {
    it('throws if no API key available', () => {
      const origEnv = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        assert.throws(
          () => new AnthropicLlmAdapter({ fetch: stubFetch() }),
          /ANTHROPIC_API_KEY/,
        );
      } finally {
        if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      }
    });

    it('accepts API key from constructor', () => {
      const adapter = makeAdapter();
      assert.equal(adapter.totalSpend, 0);
      assert.equal(adapter.callCount, 0);
    });
  });

  describe('complete()', () => {
    it('returns text and usage from Anthropic response', async () => {
      const fetch = stubFetch({ text: 'hello', inputTokens: 200, outputTokens: 80 });
      const adapter = makeAdapter({ fetch });

      const result = await adapter.complete([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Say hello.' },
      ]);

      assert.equal(result.text, 'hello');
      assert.equal(result.usage.promptTokens, 200);
      assert.equal(result.usage.completionTokens, 80);
    });

    it('converts system messages to top-level system param', async () => {
      const fetch = stubFetch();
      const adapter = makeAdapter({ fetch });

      await adapter.complete([
        { role: 'system', content: 'System prompt.' },
        { role: 'user', content: 'User message.' },
        { role: 'assistant', content: 'Prev response.' },
        { role: 'user', content: 'Follow-up.' },
      ]);

      const body = JSON.parse(fetch.calls[0].opts.body);
      assert.equal(body.system, 'System prompt.');
      assert.deepEqual(body.messages, [
        { role: 'user', content: 'User message.' },
        { role: 'assistant', content: 'Prev response.' },
        { role: 'user', content: 'Follow-up.' },
      ]);
    });

    it('passes temperature and maxTokens from opts', async () => {
      const fetch = stubFetch();
      const adapter = makeAdapter({ fetch });

      await adapter.complete(
        [{ role: 'user', content: 'test' }],
        { temperature: 0.7, maxTokens: 2048 },
      );

      const body = JSON.parse(fetch.calls[0].opts.body);
      assert.equal(body.temperature, 0.7);
      assert.equal(body.max_tokens, 2048);
    });

    it('uses correct model and headers', async () => {
      const fetch = stubFetch();
      const adapter = makeAdapter({ fetch, model: 'claude-sonnet-4-6' });

      await adapter.complete([{ role: 'user', content: 'test' }]);

      const { url, opts } = fetch.calls[0];
      assert.match(url, /\/v1\/messages$/);
      assert.equal(opts.headers['x-api-key'], 'sk-test-key');
      assert.equal(opts.headers['anthropic-version'], '2023-06-01');

      const body = JSON.parse(opts.body);
      assert.equal(body.model, 'claude-sonnet-4-6');
    });

    it('throws AnthropicApiError on non-OK response', async () => {
      const adapter = makeAdapter({ fetch: stubFetchError(429, 'rate limited') });

      await assert.rejects(
        () => adapter.complete([{ role: 'user', content: 'test' }]),
        (err) => {
          assert(err instanceof AnthropicApiError);
          assert.equal(err.status, 429);
          assert.equal(err.body, 'rate limited');
          return true;
        },
      );
    });
  });

  describe('cost tracking', () => {
    // Sonnet 4.6: $3/MTok input, $15/MTok output
    const INPUT_PRICE  = 3.0 / 1_000_000;
    const OUTPUT_PRICE = 15.0 / 1_000_000;

    it('accumulates tokens and spend across calls', async () => {
      const fetch = stubFetch({ inputTokens: 1000, outputTokens: 500 });
      const adapter = makeAdapter({ fetch });

      await adapter.complete([{ role: 'user', content: 'call 1' }]);
      assert.equal(adapter.totalInputTokens, 1000);
      assert.equal(adapter.totalOutputTokens, 500);
      assert.equal(adapter.callCount, 1);

      const expectedSpend1 = 1000 * INPUT_PRICE + 500 * OUTPUT_PRICE;
      assert.ok(Math.abs(adapter.totalSpend - expectedSpend1) < 1e-10);

      await adapter.complete([{ role: 'user', content: 'call 2' }]);
      assert.equal(adapter.totalInputTokens, 2000);
      assert.equal(adapter.totalOutputTokens, 1000);
      assert.equal(adapter.callCount, 2);

      const expectedSpend2 = expectedSpend1 * 2;
      assert.ok(Math.abs(adapter.totalSpend - expectedSpend2) < 1e-10);
    });

    it('emits target warning when spend reaches $0.50', async () => {
      // Need enough tokens for $0.50+ in one call:
      // $0.50 = N_in * $3/M + N_out * $15/M
      // Let's use 100k input + 20k output = $0.30 + $0.30 = $0.60
      const fetch = stubFetch({ inputTokens: 100_000, outputTokens: 20_000 });
      const adapter = makeAdapter({ fetch, targetSpend: 0.50 });

      assert.equal(adapter.targetWarningEmitted, false);
      await adapter.complete([{ role: 'user', content: 'big call' }]);
      assert.equal(adapter.targetWarningEmitted, true);
    });

    it('does not emit target warning below threshold', async () => {
      const fetch = stubFetch({ inputTokens: 100, outputTokens: 50 });
      const adapter = makeAdapter({ fetch, targetSpend: 0.50 });

      await adapter.complete([{ role: 'user', content: 'small call' }]);
      assert.equal(adapter.targetWarningEmitted, false);
    });
  });

  describe('hard cap enforcement', () => {
    it('throws CostCapExceededError when cap already reached', async () => {
      // First call: use enough tokens to exceed a $0.01 cap
      // 1000 input + 500 output = $0.003 + $0.0075 = $0.0105
      const fetch = stubFetch({ inputTokens: 1000, outputTokens: 500 });
      const adapter = makeAdapter({ fetch, hardCap: 0.01 });

      // First call succeeds (puts us over the cap)
      await adapter.complete([{ role: 'user', content: 'first' }]);
      assert.ok(adapter.totalSpend >= 0.01);

      // Second call should be refused immediately
      await assert.rejects(
        () => adapter.complete([{ role: 'user', content: 'second' }]),
        (err) => {
          assert(err instanceof CostCapExceededError);
          assert.equal(err.code, 'COST_CAP_EXCEEDED');
          assert.ok(err.sessionSpend >= 0.01);
          assert.equal(err.hardCap, 0.01);
          return true;
        },
      );

      // Verify the second call was never sent to the API
      assert.equal(fetch.calls.length, 1);
    });

    it('allows the call that first exceeds the cap (graceful session end)', async () => {
      // Cap at $0.01 — a single call with 1000in/500out ($0.0105) should succeed
      const fetch = stubFetch({ inputTokens: 1000, outputTokens: 500 });
      const adapter = makeAdapter({ fetch, hardCap: 0.01 });

      const result = await adapter.complete([{ role: 'user', content: 'ok' }]);
      assert.equal(result.text, '{"signals":[]}');
      // But the adapter now knows it's over cap
      assert.ok(adapter.totalSpend >= adapter.hardCap);
    });

    it('CostCapExceededError prevents partial/unscored sessions', async () => {
      // Simulate a session where extractor calls adapter multiple times
      const fetch = stubFetch({ inputTokens: 5000, outputTokens: 2000 });
      const adapter = makeAdapter({ fetch, hardCap: 0.05 });

      // Should allow first call ($0.015 + $0.03 = $0.045)
      await adapter.complete([{ role: 'user', content: 'extraction pass 1' }]);
      assert.ok(adapter.totalSpend < adapter.hardCap);

      // Second call pushes past cap ($0.09 total) but completes
      await adapter.complete([{ role: 'user', content: 'extraction pass 2' }]);
      assert.ok(adapter.totalSpend >= adapter.hardCap);

      // Third call is refused
      await assert.rejects(
        () => adapter.complete([{ role: 'user', content: 'no more' }]),
        (err) => err instanceof CostCapExceededError,
      );
    });
  });

  describe('drop-in compatibility', () => {
    it('implements LlmAdapter interface (same complete() signature and result shape)', async () => {
      const fetch = stubFetch({ text: '{"signals":[]}', inputTokens: 50, outputTokens: 25 });
      const adapter = makeAdapter({ fetch });

      const result = await adapter.complete(
        [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'usr' },
        ],
        { temperature: 0, maxTokens: 4096 },
      );

      // Same shape as MockLlmAdapter returns
      assert.equal(typeof result.text, 'string');
      assert.equal(typeof result.usage.promptTokens, 'number');
      assert.equal(typeof result.usage.completionTokens, 'number');
    });
  });
});
