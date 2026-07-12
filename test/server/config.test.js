/**
 * Server config — unit tests (T2-A)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../src/server/config.js';

describe('server config', () => {
  it('has sensible defaults', () => {
    assert.equal(typeof config.port, 'number');
    assert.ok(config.port > 0);
    assert.equal(typeof config.db.connectionString, 'string');
    assert.ok(config.db.max > 0);
    assert.ok(config.rateLimit.windowMs > 0);
    assert.ok(config.rateLimit.maxRequests > 0);
    assert.ok(config.rateLimit.chatWindowMs > 0);
    assert.ok(config.rateLimit.chatMaxRequests > 0);
    assert.ok(Array.isArray(config.corsOrigins));
  });

  it('parses DB connection string', () => {
    assert.ok(config.db.connectionString.startsWith('postgresql://'));
  });
});
