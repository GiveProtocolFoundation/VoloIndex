/**
 * DB TLS config (DB_SSL / DB_SSL_CA) — unit tests (T2-G hardening)
 *
 * config.js is evaluated at import time, so each mode is exercised in a
 * subprocess with the env baked before import.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const INLINE_PEM = '-----BEGIN CERTIFICATE-----\\nMIIFAKE\\n-----END CERTIFICATE-----';

/** Import config in a subprocess with the given env; print db.ssl as JSON. */
const loadSsl = (env) => {
  const out = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `const { config } = await import('./src/server/config.js'); console.log(JSON.stringify(config.db.ssl));`,
  ], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  return JSON.parse(out.trim());
};

describe('db ssl config', () => {
  it('DB_SSL unset/false → no TLS', () => {
    assert.equal(loadSsl({}), false);
    assert.equal(loadSsl({ DB_SSL: 'false' }), false);
  });

  it('DB_SSL=true → CA-verified TLS', () => {
    assert.deepEqual(loadSsl({ DB_SSL: 'true' }), { rejectUnauthorized: true });
  });

  it('DB_SSL=true + DB_SSL_CA inline PEM → custom CA attached', () => {
    const ssl = loadSsl({ DB_SSL: 'true', DB_SSL_CA: INLINE_PEM });
    assert.equal(ssl.rejectUnauthorized, true);
    assert.ok(ssl.ca.includes('-----BEGIN CERTIFICATE-----'));
  });

  it('DB_SSL=no-verify in dev → unverified TLS (escape hatch)', () => {
    assert.deepEqual(loadSsl({ DB_SSL: 'no-verify' }), { rejectUnauthorized: false });
  });

  it('DB_SSL=no-verify in production → refused (fail-closed)', () => {
    assert.throws(
      () => loadSsl({
        DB_SSL: 'no-verify',
        NODE_ENV: 'production',
        ANTHROPIC_API_KEY: 'x',
        JWT_SECRET: 'x',
      }),
      /DB_SSL=no-verify is not allowed in production/,
    );
  });
});
