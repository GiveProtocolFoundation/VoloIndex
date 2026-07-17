/**
 * Rate-limit client-IP keying — unit + regression tests (GIV-698)
 *
 * Verifies that the keyGenerator extracts client IP from trusted proxy headers
 * (CF-Connecting-IP → Fly-Client-IP → req.ip) so rate limits work behind
 * Cloudflare and Fly proxy.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from '../../src/server/middleware/rate-limit.js';

describe('clientIp (rate-limit keyGenerator)', () => {
  it('prefers CF-Connecting-IP when present', () => {
    const req = {
      headers: { 'cf-connecting-ip': '1.2.3.4', 'fly-client-ip': '5.6.7.8' },
      ip: '10.0.0.1',
    };
    assert.equal(clientIp(req), '1.2.3.4');
  });

  it('falls back to Fly-Client-IP when CF header is absent', () => {
    const req = {
      headers: { 'fly-client-ip': '5.6.7.8' },
      ip: '10.0.0.1',
    };
    assert.equal(clientIp(req), '5.6.7.8');
  });

  it('falls back to req.ip when no proxy headers are present', () => {
    const req = {
      headers: {},
      ip: '192.168.1.1',
    };
    assert.equal(clientIp(req), '192.168.1.1');
  });

  it('ignores empty-string CF-Connecting-IP', () => {
    const req = {
      headers: { 'cf-connecting-ip': '', 'fly-client-ip': '5.6.7.8' },
      ip: '10.0.0.1',
    };
    assert.equal(clientIp(req), '5.6.7.8');
  });

  it('ignores empty-string Fly-Client-IP', () => {
    const req = {
      headers: { 'fly-client-ip': '' },
      ip: '192.168.1.1',
    };
    assert.equal(clientIp(req), '192.168.1.1');
  });
});
