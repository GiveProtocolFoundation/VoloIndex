/**
 * Volo Index — P3 Publication Queue Tests (D5)
 *
 * Covers:
 * 1. enqueue: pending_review hold before spotCheckThreshold
 * 2. release: QA approval, agreement tracking
 * 3. Auto-publish: enabled once spotCheckThreshold + agreementThreshold met
 * 4. Edge cases: duplicate, wrong-status release, non-boolean argument
 * 5. JSON round-trip persistence
 * 6. Counter and agreementRate determinism
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PublicationQueue } from '../src/assessment/publication-queue.js';

// ── Helpers ───────────────────────────────────────────────────────────

let _sid = 0;
function newSessionId() { return `sess-${++_sid}`; }

const DUMMY_SCORE = { overall: { score: 6.5, tier: 'proficient', incomplete: false }, dimensions: [] };

function makeQueue(opts = {}) {
  return new PublicationQueue(opts);
}

// ── 1. Basic enqueue ─────────────────────────────────────────────────

describe('PublicationQueue: enqueue', () => {
  it('new entry is pending_review before spotCheckThreshold reached', () => {
    const q = makeQueue({ spotCheckThreshold: 3 });
    const sid = newSessionId();
    const entry = q.enqueue({ sessionId: sid, candidateId: 'cand-x', scoreResult: DUMMY_SCORE });
    assert.equal(entry.status, 'pending_review');
    assert.equal(entry.sessionId, sid);
    assert.ok(entry.enqueuedAt);
    assert.equal(entry.releasedAt, null);
    assert.equal(entry.agreedWithExtractor, null);
  });

  it('pendingCount increments on enqueue', () => {
    const q = makeQueue({ spotCheckThreshold: 10 });
    assert.equal(q.pendingCount, 0);
    q.enqueue({ sessionId: newSessionId(), candidateId: 'c', scoreResult: DUMMY_SCORE });
    q.enqueue({ sessionId: newSessionId(), candidateId: 'c', scoreResult: DUMMY_SCORE });
    assert.equal(q.pendingCount, 2);
  });

  it('throws on duplicate sessionId', () => {
    const q = makeQueue();
    const sid = newSessionId();
    q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
    assert.throws(
      () => q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE }),
      /already in the queue/,
    );
  });

  it('throws on missing sessionId', () => {
    const q = makeQueue();
    assert.throws(
      () => q.enqueue({ sessionId: '', candidateId: 'c', scoreResult: DUMMY_SCORE }),
      /sessionId/,
    );
  });

  it('throws on missing scoreResult', () => {
    const q = makeQueue();
    assert.throws(
      () => q.enqueue({ sessionId: newSessionId(), candidateId: 'c', scoreResult: null }),
      /scoreResult/,
    );
  });
});

// ── 2. QA release ───────────────────────────────────────────────────

describe('PublicationQueue: release', () => {
  it('release publishes the entry and records agreement verdict', () => {
    const q = makeQueue({ spotCheckThreshold: 5 });
    const sid = newSessionId();
    q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });

    const released = q.release(sid, { agreedWithExtractor: true });
    assert.equal(released.status, 'published');
    assert.equal(released.agreedWithExtractor, true);
    assert.ok(released.releasedAt);
  });

  it('release increments reviewedCount and agreementCount on agree', () => {
    const q = makeQueue({ spotCheckThreshold: 5 });
    const sid = newSessionId();
    q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
    q.release(sid, { agreedWithExtractor: true });

    assert.equal(q.reviewedCount, 1);
    assert.equal(q.agreementCount, 1);
  });

  it('release increments reviewedCount but not agreementCount on disagree', () => {
    const q = makeQueue({ spotCheckThreshold: 5 });
    const sid = newSessionId();
    q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
    q.release(sid, { agreedWithExtractor: false });

    assert.equal(q.reviewedCount, 1);
    assert.equal(q.agreementCount, 0);
  });

  it('throws if sessionId not found', () => {
    const q = makeQueue();
    assert.throws(() => q.release('no-such-session', { agreedWithExtractor: true }), /not found/);
  });

  it('throws if entry not in pending_review', () => {
    const q = makeQueue({ spotCheckThreshold: 1, agreementThreshold: 0 });
    const sid = newSessionId();
    q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
    q.release(sid, { agreedWithExtractor: true }); // publishes; auto-publish also flips
    // Try to release again
    assert.throws(() => q.release(sid, { agreedWithExtractor: true }), /not pending_review/);
  });

  it('throws if agreedWithExtractor is not boolean', () => {
    const q = makeQueue();
    const sid = newSessionId();
    q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
    assert.throws(
      () => q.release(sid, { agreedWithExtractor: 'yes' }),
      /boolean/,
    );
  });
});

// ── 3. Auto-publish threshold ─────────────────────────────────────────

describe('PublicationQueue: auto-publish threshold (D5)', () => {
  it('autoPublishEnabled starts false', () => {
    const q = makeQueue();
    assert.equal(q.autoPublishEnabled, false);
  });

  it('auto-publish enables after spotCheckThreshold reviews at 100% agreement', () => {
    const q = makeQueue({ spotCheckThreshold: 3, agreementThreshold: 0.95 });

    for (let i = 0; i < 3; i++) {
      const sid = newSessionId();
      q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
      q.release(sid, { agreedWithExtractor: true });
    }

    assert.equal(q.reviewedCount, 3);
    assert.equal(q.agreementRate, 1.0);
    assert.equal(q.autoPublishEnabled, true);
  });

  it('does NOT flip auto-publish if agreement rate below threshold', () => {
    const q = makeQueue({ spotCheckThreshold: 2, agreementThreshold: 0.95 });

    const sid1 = newSessionId();
    q.enqueue({ sessionId: sid1, candidateId: 'c', scoreResult: DUMMY_SCORE });
    q.release(sid1, { agreedWithExtractor: true });

    const sid2 = newSessionId();
    q.enqueue({ sessionId: sid2, candidateId: 'c', scoreResult: DUMMY_SCORE });
    q.release(sid2, { agreedWithExtractor: false }); // 50% agreement

    assert.equal(q.reviewedCount, 2);
    assert.equal(q.agreementRate, 0.5);
    assert.equal(q.autoPublishEnabled, false);
  });

  it('does NOT flip if reviewed count below spotCheckThreshold', () => {
    const q = makeQueue({ spotCheckThreshold: 5, agreementThreshold: 0.8 });

    for (let i = 0; i < 4; i++) {
      const sid = newSessionId();
      q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
      q.release(sid, { agreedWithExtractor: true });
    }

    assert.equal(q.reviewedCount, 4);
    assert.equal(q.autoPublishEnabled, false);
  });

  it('once auto-publish enabled, new enqueue is immediately published', () => {
    const q = makeQueue({ spotCheckThreshold: 2, agreementThreshold: 0.5 });

    // Reach threshold
    for (let i = 0; i < 2; i++) {
      const sid = newSessionId();
      q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
      q.release(sid, { agreedWithExtractor: true });
    }
    assert.equal(q.autoPublishEnabled, true);

    // Next enqueue should be auto-published
    const newSid = newSessionId();
    const entry = q.enqueue({ sessionId: newSid, candidateId: 'c', scoreResult: DUMMY_SCORE });
    assert.equal(entry.status, 'published');
    assert.ok(entry.releasedAt);
  });
});

// ── 4. Agreement rate arithmetic ─────────────────────────────────────

describe('PublicationQueue: agreementRate', () => {
  it('returns 0 when no reviews', () => {
    const q = makeQueue();
    assert.equal(q.agreementRate, 0);
  });

  it('correct fraction with mixed verdicts', () => {
    const q = makeQueue({ spotCheckThreshold: 100 });

    for (let i = 0; i < 9; i++) {
      const sid = newSessionId();
      q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
      q.release(sid, { agreedWithExtractor: true });
    }
    const sid = newSessionId();
    q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
    q.release(sid, { agreedWithExtractor: false });

    assert.equal(q.reviewedCount, 10);
    assert.equal(q.agreementCount, 9);
    assert.ok(Math.abs(q.agreementRate - 0.9) < 0.001);
  });
});

// ── 5. getEntry ──────────────────────────────────────────────────────

describe('PublicationQueue: getEntry', () => {
  it('returns snapshot of existing entry', () => {
    const q = makeQueue();
    const sid = newSessionId();
    q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
    const entry = q.getEntry(sid);
    assert.equal(entry.sessionId, sid);
    assert.equal(entry.status, 'pending_review');
  });

  it('returns null for unknown sessionId', () => {
    const q = makeQueue();
    assert.equal(q.getEntry('unknown'), null);
  });
});

// ── 6. JSON round-trip ───────────────────────────────────────────────

describe('PublicationQueue: JSON round-trip', () => {
  it('toJSON / fromJSON preserves all state', () => {
    const q = makeQueue({ spotCheckThreshold: 3, agreementThreshold: 0.9 });
    const sid1 = newSessionId();
    const sid2 = newSessionId();

    q.enqueue({ sessionId: sid1, candidateId: 'c', scoreResult: DUMMY_SCORE });
    q.release(sid1, { agreedWithExtractor: true });
    q.enqueue({ sessionId: sid2, candidateId: 'c', scoreResult: DUMMY_SCORE });

    const json = q.toJSON();
    const q2 = PublicationQueue.fromJSON(json);

    assert.equal(q2.reviewedCount, q.reviewedCount);
    assert.equal(q2.agreementCount, q.agreementCount);
    assert.equal(q2.autoPublishEnabled, q.autoPublishEnabled);
    assert.equal(q2.pendingCount, q.pendingCount);
    assert.equal(q2.publishedCount, q.publishedCount);
    assert.equal(q2.spotCheckThreshold, 3);
    assert.equal(q2.agreementThreshold, 0.9);
  });

  it('fromJSON throws on non-object', () => {
    assert.throws(() => PublicationQueue.fromJSON(null), /must be an object/);
  });

  it('fromJSON handles missing fields gracefully', () => {
    const q = PublicationQueue.fromJSON({});
    assert.equal(q.reviewedCount, 0);
    assert.equal(q.autoPublishEnabled, false);
  });
});

// ── 7. Published count ───────────────────────────────────────────────

describe('PublicationQueue: publishedCount', () => {
  it('increments after each QA release', () => {
    const q = makeQueue({ spotCheckThreshold: 10 });
    assert.equal(q.publishedCount, 0);

    const sid = newSessionId();
    q.enqueue({ sessionId: sid, candidateId: 'c', scoreResult: DUMMY_SCORE });
    q.release(sid, { agreedWithExtractor: true });
    assert.equal(q.publishedCount, 1);
    assert.equal(q.pendingCount, 0);
  });
});
