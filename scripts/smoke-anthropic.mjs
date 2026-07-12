#!/usr/bin/env node
/**
 * Volo Index — Anthropic adapter smoke test (manual, requires ANTHROPIC_API_KEY)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/smoke-anthropic.mjs
 *
 * This script is NOT run in CI. It verifies that the AnthropicLlmAdapter
 * can successfully call the Anthropic Messages API end-to-end.
 */

import { AnthropicLlmAdapter } from '../src/assessment/anthropic-adapter.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('⏭  ANTHROPIC_API_KEY not set — skipping smoke test.');
  process.exit(0);
}

console.log('🔌 Smoke-testing AnthropicLlmAdapter (claude-sonnet-4-6)...\n');

const adapter = new AnthropicLlmAdapter();

// Simple extraction-style call (temperature 0, short response)
const result = await adapter.complete(
  [
    { role: 'system', content: 'You are a JSON-only responder. Return {"ok":true}.' },
    { role: 'user', content: 'Respond with valid JSON only.' },
  ],
  { temperature: 0, maxTokens: 64 },
);

console.log('Response text:', result.text);
console.log('Usage:', result.usage);
console.log(`Session spend: $${adapter.totalSpend.toFixed(6)}`);
console.log(`Target warning emitted: ${adapter.targetWarningEmitted}`);

// Verify JSON parseable
try {
  JSON.parse(result.text);
  console.log('\n✅ Smoke test PASSED — valid JSON returned, adapter functional.');
} catch {
  console.log('\n⚠️  Response was not valid JSON (non-critical for smoke test).');
  console.log('✅ Smoke test PASSED — adapter successfully called the API.');
}
