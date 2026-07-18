/**
 * sendMagicLink adapter unit tests (GIV-708)
 *
 * Tests the Resend HTTP API integration in isolation:
 *   - no-op when RESEND_API_KEY is absent
 *   - correct POST shape when key is present
 *   - propagates errors on non-2xx Resend response
 *
 * Run: node --test test/server/email-adapter.test.js
 * (no --experimental-test-module-mocks needed — patches globalThis.fetch directly)
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { sendMagicLink } from '../../src/server/email.js';
import { config } from '../../src/server/config.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('sendMagicLink adapter (GIV-708)', () => {
  it('is a no-op when resendApiKey is empty', async () => {
    const orig = config.email.resendApiKey;
    config.email.resendApiKey = '';

    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return { ok: true }; };

    await sendMagicLink('user@example.com', 'https://voloindex.org/auth/verify?token=abc');
    assert.equal(fetchCalled, false, 'fetch must not be called when resendApiKey is empty');

    config.email.resendApiKey = orig;
  });

  it('POSTs to Resend API with correct shape', async () => {
    const orig = config.email.resendApiKey;
    const origFrom = config.email.from;
    config.email.resendApiKey = 're_test_key';
    config.email.from = 'login@voloindex.org';

    let capturedUrl, capturedOpts;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return { ok: true, status: 200, text: async () => '{"id":"abc"}' };
    };

    const to = 'recipient@example.com';
    const magicUrl = 'https://voloindex.org/auth/verify?token=deadbeef';

    await sendMagicLink(to, magicUrl);

    assert.equal(capturedUrl, 'https://api.resend.com/emails', 'must POST to Resend endpoint');
    assert.equal(capturedOpts.method, 'POST');
    assert.equal(capturedOpts.headers['Authorization'], 'Bearer re_test_key');
    assert.equal(capturedOpts.headers['Content-Type'], 'application/json');

    const body = JSON.parse(capturedOpts.body);
    assert.ok(body.from.includes('Volo Index'), 'from must include sender name "Volo Index"');
    assert.ok(body.from.includes('login@voloindex.org'), 'from must include the configured address');
    assert.deepEqual(body.to, [to], 'to must be wrapped in an array');
    assert.equal(body.subject, 'Sign in to Volo Index');
    assert.ok(body.text.includes(magicUrl), 'plain text must include the magic-link URL');
    assert.ok(body.html.includes(magicUrl), 'HTML must include the magic-link URL');
    assert.ok(!body.html.includes('<img'), 'HTML must not include any <img> tags (no tracking pixels)');

    config.email.resendApiKey = orig;
    config.email.from = origFrom;
  });

  it('throws EMAIL_SEND_FAILED on non-2xx Resend response', async () => {
    const orig = config.email.resendApiKey;
    config.email.resendApiKey = 're_test_key';

    globalThis.fetch = async () => ({
      ok: false,
      status: 422,
      text: async () => '{"message":"Invalid `to` field"}',
    });

    await assert.rejects(
      () => sendMagicLink('bad@example.com', 'https://voloindex.org/auth/verify?token=x'),
      (err) => {
        assert.ok(err.message.includes('422'), `error message should contain status; got: ${err.message}`);
        assert.equal(err.code, 'EMAIL_SEND_FAILED');
        assert.equal(err.statusCode, 502);
        return true;
      },
    );

    config.email.resendApiKey = orig;
  });

  it('includes the expiry note from config in both text and HTML', async () => {
    const orig = config.email.resendApiKey;
    const origTtl = config.auth.magicLinkTtlMinutes;
    config.email.resendApiKey = 're_test_key';
    config.auth.magicLinkTtlMinutes = 15;

    let body;
    globalThis.fetch = async (_url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 200, text: async () => '{}' };
    };

    await sendMagicLink('u@example.com', 'https://voloindex.org/auth/verify?token=y');

    assert.ok(body.text.includes('15'), 'text body should mention the TTL (15 minutes)');
    assert.ok(body.html.includes('15'), 'HTML body should mention the TTL (15 minutes)');

    config.email.resendApiKey = orig;
    config.auth.magicLinkTtlMinutes = origTtl;
  });
});
