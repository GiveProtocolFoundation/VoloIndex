/**
 * AppError + errorHandler — unit tests (T2-A)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, errorHandler } from '../../src/server/middleware/error-handler.js';

describe('AppError', () => {
  it('creates an error with statusCode and code', () => {
    const err = new AppError('Not found', 404, 'NOT_FOUND');
    assert.equal(err.message, 'Not found');
    assert.equal(err.statusCode, 404);
    assert.equal(err.code, 'NOT_FOUND');
    assert.ok(err instanceof Error);
  });

  it('defaults to 500 and INTERNAL_ERROR', () => {
    const err = new AppError('boom');
    assert.equal(err.statusCode, 500);
    assert.equal(err.code, 'INTERNAL_ERROR');
  });
});

describe('errorHandler', () => {
  it('sends 4xx errors with their message', () => {
    const err = new AppError('Bad input', 400, 'BAD_INPUT');
    let sentStatus, sentBody;
    const res = {
      status(code) { sentStatus = code; return this; },
      json(body) { sentBody = body; },
    };

    errorHandler(err, {}, res, () => {});

    assert.equal(sentStatus, 400);
    assert.equal(sentBody.error.code, 'BAD_INPUT');
    assert.equal(sentBody.error.message, 'Bad input');
  });

  it('masks 5xx error messages', () => {
    const err = new AppError('db connection leaked password');
    let sentBody;
    const res = {
      status() { return this; },
      json(body) { sentBody = body; },
    };

    errorHandler(err, {}, res, () => {});

    assert.equal(sentBody.error.message, 'Internal server error');
  });
});
