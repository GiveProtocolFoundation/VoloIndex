/**
 * Volo Index — P3 Consent + Transcript Store Tests
 *
 * Covers:
 * 1. AssessmentSession: consent enforcement (D4) — cannot start without consent
 * 2. TranscriptStore interface: InMemoryTranscriptStore save/load/listIds
 * 3. FileTranscriptStore: file-backed persistence (using OS temp dir)
 * 4. ASSESSMENT_ENGINE_ENABLED flag defaults to false
 * 5. Session serialization round-trips consent state correctly
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AssessmentSession } from '../src/assessment/session.js';
import {
  TranscriptStore,
  InMemoryTranscriptStore,
  FileTranscriptStore,
} from '../src/assessment/consent-store.js';
import { ASSESSMENT_ENGINE_ENABLED } from '../src/scoring/config.js';

// ── 1. Go-live flag ────────────────────────────────────────────────────

describe('ASSESSMENT_ENGINE_ENABLED flag', () => {
  it('defaults to false (gate closed until QA + HoData sign-off)', () => {
    assert.equal(ASSESSMENT_ENGINE_ENABLED, false);
  });
});

// ── 2. AssessmentSession consent enforcement ──────────────────────────

describe('AssessmentSession: consent required before start (D4)', () => {
  it('throws if start() called without consent', () => {
    const session = new AssessmentSession({ id: 'sess-001', candidateId: 'cand-001' });
    assert.throws(
      () => session.start(),
      /consent.*D4|D4.*consent/i,
    );
  });

  it('starts successfully after recordConsent()', () => {
    const session = new AssessmentSession({ id: 'sess-002', candidateId: 'cand-002' });
    session.recordConsent();
    assert.equal(session.consentGiven, true);
    assert.ok(session.consentAt, 'consentAt should be set');
    session.start();
    assert.equal(session.status, 'in_progress');
  });

  it('consentGiven is false by default', () => {
    const session = new AssessmentSession({ id: 'sess-003', candidateId: 'cand-003' });
    assert.equal(session.consentGiven, false);
    assert.equal(session.consentAt, null);
  });

  it('recordConsent() throws in non-created states', () => {
    const session = new AssessmentSession({ id: 'sess-004', candidateId: 'cand-004' });
    session.recordConsent();
    session.start();
    assert.throws(
      () => session.recordConsent(),
      /Cannot record consent in state/,
    );
  });

  it('toJSON round-trip preserves consentGiven and consentAt', () => {
    const session = new AssessmentSession({ id: 'sess-005', candidateId: 'cand-005' });
    session.recordConsent();
    const snap = session.toJSON();
    assert.equal(snap.consentGiven, true);
    assert.ok(snap.consentAt);

    const restored = AssessmentSession.fromJSON(snap);
    assert.equal(restored.consentGiven, true);
    assert.equal(restored.consentAt, snap.consentAt);
  });

  it('fromJSON with missing consentGiven defaults to false', () => {
    const session = new AssessmentSession({ id: 'sess-006', candidateId: 'cand-006' });
    const snap = session.toJSON();
    delete snap.consentGiven;
    delete snap.consentAt;

    const restored = AssessmentSession.fromJSON(snap);
    assert.equal(restored.consentGiven, false);
    assert.equal(restored.consentAt, null);
  });

  it('restored session without consent cannot be started', () => {
    const session = new AssessmentSession({ id: 'sess-007', candidateId: 'cand-007' });
    const snap = session.toJSON(); // consentGiven: false
    const restored = AssessmentSession.fromJSON(snap);
    assert.throws(() => restored.start(), /consent.*D4|D4.*consent/i);
  });
});

// ── 3. InMemoryTranscriptStore ────────────────────────────────────────

const VALID_RECORD = {
  sessionId: 'sess-mem-001',
  candidateId: 'cand-anon-001',
  consentGiven: true,
  consentAt: '2026-07-12T10:00:00Z',
  transcript: {
    id: 'sess-mem-001',
    candidateId: 'cand-anon-001',
    startedAt: '2026-07-12T10:00:00Z',
    turns: [{ role: 'interviewer', content: 'Tell me about your work.' }],
  },
};

describe('InMemoryTranscriptStore', () => {
  it('save and load round-trip', async () => {
    const store = new InMemoryTranscriptStore();
    await store.save(VALID_RECORD);
    const loaded = await store.load(VALID_RECORD.sessionId);
    assert.equal(loaded.sessionId, VALID_RECORD.sessionId);
    assert.equal(loaded.consentGiven, true);
    assert.deepStrictEqual(loaded.transcript, VALID_RECORD.transcript);
  });

  it('load returns null for unknown sessionId', async () => {
    const store = new InMemoryTranscriptStore();
    const result = await store.load('nonexistent');
    assert.equal(result, null);
  });

  it('listIds returns all saved sessionIds', async () => {
    const store = new InMemoryTranscriptStore();
    await store.save({ ...VALID_RECORD, sessionId: 'a' });
    await store.save({ ...VALID_RECORD, sessionId: 'b' });
    const ids = await store.listIds();
    assert.ok(ids.includes('a'));
    assert.ok(ids.includes('b'));
    assert.equal(ids.length, 2);
  });

  it('size reflects stored count', async () => {
    const store = new InMemoryTranscriptStore();
    assert.equal(store.size, 0);
    await store.save(VALID_RECORD);
    assert.equal(store.size, 1);
  });

  it('throws if consentGiven is false (D4 invariant)', async () => {
    const store = new InMemoryTranscriptStore();
    await assert.rejects(
      () => store.save({ ...VALID_RECORD, consentGiven: false }),
      /consentGiven.*true|D4/,
    );
  });

  it('throws if consentGiven is missing', async () => {
    const store = new InMemoryTranscriptStore();
    const rec = { ...VALID_RECORD };
    delete rec.consentGiven;
    await assert.rejects(() => store.save(rec), /consentGiven|D4/);
  });

  it('throws if sessionId is missing', async () => {
    const store = new InMemoryTranscriptStore();
    await assert.rejects(
      () => store.save({ ...VALID_RECORD, sessionId: '' }),
      /sessionId/,
    );
  });

  it('throws if transcript is missing', async () => {
    const store = new InMemoryTranscriptStore();
    await assert.rejects(
      () => store.save({ ...VALID_RECORD, transcript: null }),
      /transcript/,
    );
  });

  it('save stamps savedAt if not provided', async () => {
    const store = new InMemoryTranscriptStore();
    const rec = { ...VALID_RECORD };
    delete rec.savedAt;
    await store.save(rec);
    const loaded = await store.load(rec.sessionId);
    assert.ok(loaded.savedAt, 'savedAt should be set by store');
  });

  it('TranscriptStore base class throws on all methods', async () => {
    const base = new TranscriptStore();
    await assert.rejects(() => base.save({}), /must be implemented/);
    await assert.rejects(() => base.load('x'), /must be implemented/);
    await assert.rejects(() => base.listIds(), /must be implemented/);
  });
});

// ── 4. FileTranscriptStore ────────────────────────────────────────────

describe('FileTranscriptStore', () => {
  let tmpDir;

  it('save and load round-trip', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'volo-test-'));
    const store = new FileTranscriptStore({ dir: tmpDir });
    await store.save(VALID_RECORD);
    const loaded = await store.load(VALID_RECORD.sessionId);
    assert.equal(loaded.sessionId, VALID_RECORD.sessionId);
    assert.equal(loaded.consentGiven, true);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('load returns null for unknown session', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'volo-test-'));
    const store = new FileTranscriptStore({ dir: tmpDir });
    const r = await store.load('no-such-session');
    assert.equal(r, null);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('listIds returns saved sessions', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'volo-test-'));
    const store = new FileTranscriptStore({ dir: tmpDir });
    await store.save({ ...VALID_RECORD, sessionId: 'file-a' });
    await store.save({ ...VALID_RECORD, sessionId: 'file-b' });
    const ids = await store.listIds();
    assert.ok(ids.includes('file-a'));
    assert.ok(ids.includes('file-b'));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refuses to store without consent (D4)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'volo-test-'));
    const store = new FileTranscriptStore({ dir: tmpDir });
    await assert.rejects(
      () => store.save({ ...VALID_RECORD, consentGiven: false }),
      /consentGiven|D4/,
    );
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws without dir option', () => {
    assert.throws(() => new FileTranscriptStore({}), /dir/);
  });

  it('path sanitizes session IDs to prevent traversal', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'volo-test-'));
    const store = new FileTranscriptStore({ dir: tmpDir });
    // sessionId with path traversal chars should be sanitized, not throw
    const rec = { ...VALID_RECORD, sessionId: '../../../etc/passwd' };
    await store.save(rec);
    // Should load back by the same (traversal-attempted) sessionId
    const loaded = await store.load(rec.sessionId);
    assert.ok(loaded, 'should load the sanitized record');
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
