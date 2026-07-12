/**
 * Volo Index — P2a: Session Manager + Interviewer Tests
 *
 * Covers:
 * 1. AssessmentSession: lifecycle, transcript shape, dimension progress, serialization
 * 2. Anti-gaming guardrail: buildInterviewerSystemPrompt contains no rubric anchors
 * 3. runInterview() orchestration: happy path, early stop, turn budget, dimension order
 * 4. E2E dry run: MockLlmAdapter-driven interview → session transcript →
 *    extractSignals() (P1) → validator → scoreAssessment() (rubric v1.2)
 *
 * All tests use MockLlmAdapter only — no vendor SDK, no network.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AssessmentSession, SESSION_STATES,
  MockLlmAdapter,
  runInterview, buildInterviewerSystemPrompt, assertNoRubricLeakage,
  RUBRIC_ANCHOR_STRINGS, DEFAULT_MAX_TURNS_PER_DIM,
  extractSignals,
  validateSignals,
} from '../src/assessment/index.js';

import { scoreAssessment, RUBRIC_VERSION, DIMENSION_IDS } from '../src/scoring/index.js';

// ── Shared fixtures ──────────────────────────────────────────────────

const MOCK_QUESTION = 'Tell me about a time you designed a volunteer engagement strategy.';
const MOCK_CANDIDATE_RESPONSE =
  'In my current role I built a structured volunteer program that aligned roles to our theory of change and tracked quarterly outcomes.';

/**
 * A scripted interview LLM adapter: always returns the same question text,
 * keyed to any input (* fallback).
 */
function makeInterviewerMock() {
  return new MockLlmAdapter({ '*': MOCK_QUESTION });
}

/**
 * A synchronous mock candidate: always returns the same substantive response.
 * Returns null for a specific dimension if configured.
 *
 * @param {string|null} [endOnDim] - If set, return null when this dim is reached
 */
function makeCandidateMock(endOnDim = null) {
  return async (question, dimId) => {
    if (dimId === endOnDim) return null;
    return MOCK_CANDIDATE_RESPONSE;
  };
}

// ── 1. AssessmentSession: lifecycle ─────────────────────────────────

describe('AssessmentSession lifecycle', () => {
  it('starts in created state', () => {
    const s = new AssessmentSession({ id: 'sess-001', candidateId: 'cand-001' });
    assert.equal(s.status, 'created');
    assert.equal(s.startedAt, null);
    assert.equal(s.completedAt, null);
    assert.equal(s.abandonedAt, null);
  });

  it('transitions created → in_progress on start()', () => {
    const s = new AssessmentSession({ id: 'sess-002', candidateId: 'cand-001' });
    s.start();
    assert.equal(s.status, 'in_progress');
    assert.ok(s.startedAt);
    assert.ok(new Date(s.startedAt).getTime() > 0);
  });

  it('transitions in_progress → completed on complete()', () => {
    const s = new AssessmentSession({ id: 'sess-003', candidateId: 'cand-001' });
    s.start();
    s.complete();
    assert.equal(s.status, 'completed');
    assert.ok(s.completedAt);
  });

  it('transitions in_progress → abandoned on abandon()', () => {
    const s = new AssessmentSession({ id: 'sess-004', candidateId: 'cand-001' });
    s.start();
    s.abandon('candidate_ended');
    assert.equal(s.status, 'abandoned');
    assert.ok(s.abandonedAt);
    assert.equal(s.abandonReason, 'candidate_ended');
  });

  it('throws if start() called twice', () => {
    const s = new AssessmentSession({ id: 'sess-005', candidateId: 'cand-001' });
    s.start();
    assert.throws(() => s.start(), /Cannot start session in state: in_progress/);
  });

  it('throws if complete() called on created session', () => {
    const s = new AssessmentSession({ id: 'sess-006', candidateId: 'cand-001' });
    assert.throws(() => s.complete(), /Cannot complete session in state: created/);
  });

  it('throws if abandon() called on completed session', () => {
    const s = new AssessmentSession({ id: 'sess-007', candidateId: 'cand-001' });
    s.start();
    s.complete();
    assert.throws(() => s.abandon(), /Cannot abandon session in state: completed/);
  });

  it('throws on missing id or candidateId', () => {
    assert.throws(() => new AssessmentSession({ id: '', candidateId: 'x' }), /id must be/);
    assert.throws(() => new AssessmentSession({ id: 'x', candidateId: '' }), /candidateId must be/);
  });

  it('SESSION_STATES exports all four states', () => {
    assert.deepStrictEqual(SESSION_STATES, ['created', 'in_progress', 'completed', 'abandoned']);
  });
});

// ── 2. AssessmentSession: transcript + turns ─────────────────────────

describe('AssessmentSession transcript', () => {
  it('transcript getter returns AssessmentTranscript-compatible shape', () => {
    const s = new AssessmentSession({ id: 'sess-010', candidateId: 'cand-010' });
    s.start();
    const t = s.transcript;
    assert.equal(t.id, 'sess-010');
    assert.equal(t.candidateId, 'cand-010');
    assert.ok(t.startedAt);
    assert.ok(Array.isArray(t.turns));
  });

  it('appending turns updates turnCount and transcript.turns', () => {
    const s = new AssessmentSession({ id: 'sess-011', candidateId: 'cand-011' });
    s.start();
    s.appendTurn({ role: 'interviewer', content: 'Question 1', dimension: 'D1' });
    s.appendTurn({ role: 'candidate', content: 'Answer 1', dimension: 'D1' });
    assert.equal(s.turnCount, 2);
    assert.equal(s.transcript.turns.length, 2);
    assert.equal(s.transcript.turns[0].role, 'interviewer');
    assert.equal(s.transcript.turns[1].role, 'candidate');
  });

  it('transcript.turns is a defensive copy (no aliasing)', () => {
    const s = new AssessmentSession({ id: 'sess-012', candidateId: 'cand-012' });
    s.start();
    s.appendTurn({ role: 'interviewer', content: 'Q' });
    const turns1 = s.transcript.turns;
    s.appendTurn({ role: 'candidate', content: 'A' });
    assert.equal(turns1.length, 1, 'prior snapshot should not see new turns');
    assert.equal(s.transcript.turns.length, 2);
  });

  it('completedAt appears in transcript after complete()', () => {
    const s = new AssessmentSession({ id: 'sess-013', candidateId: 'cand-013' });
    s.start();
    s.appendTurn({ role: 'interviewer', content: 'Q' });
    s.appendTurn({ role: 'candidate', content: 'A' });
    s.complete();
    assert.ok(s.transcript.completedAt);
  });

  it('rejects invalid turn role', () => {
    const s = new AssessmentSession({ id: 'sess-014', candidateId: 'cand-014' });
    s.start();
    assert.throws(() => s.appendTurn({ role: 'moderator', content: 'X' }), /Invalid turn role/);
  });

  it('rejects empty turn content', () => {
    const s = new AssessmentSession({ id: 'sess-015', candidateId: 'cand-015' });
    s.start();
    assert.throws(() => s.appendTurn({ role: 'candidate', content: '' }), /content/);
  });
});

// ── 3. AssessmentSession: dimension progress ─────────────────────────

describe('AssessmentSession dimension progress', () => {
  it('all 6 dimensions start uncovered with 0 turns', () => {
    const s = new AssessmentSession({ id: 'sess-020', candidateId: 'cand-020' });
    for (const dimId of DIMENSION_IDS) {
      const p = s.getDimensionProgress(dimId);
      assert.equal(p.covered, false, `${dimId} should start uncovered`);
      assert.equal(p.turnCount, 0, `${dimId} should start with 0 turns`);
    }
    assert.deepStrictEqual(s.coveredDimensions, []);
  });

  it('markDimensionCovered + incrementDimensionTurns update state', () => {
    const s = new AssessmentSession({ id: 'sess-021', candidateId: 'cand-021' });
    s.markDimensionCovered('D1');
    s.incrementDimensionTurns('D1');
    s.incrementDimensionTurns('D1');
    const p = s.getDimensionProgress('D1');
    assert.equal(p.covered, true);
    assert.equal(p.turnCount, 2);
    assert.deepStrictEqual(s.coveredDimensions, ['D1']);
  });

  it('throws on unknown dimension', () => {
    const s = new AssessmentSession({ id: 'sess-022', candidateId: 'cand-022' });
    assert.throws(() => s.getDimensionProgress('D99'), /Unknown dimension/);
    assert.throws(() => s.markDimensionCovered('D99'), /Unknown dimension/);
    assert.throws(() => s.incrementDimensionTurns('D99'), /Unknown dimension/);
  });
});

// ── 4. AssessmentSession: serialization ─────────────────────────────

describe('AssessmentSession serialization', () => {
  it('round-trips through toJSON / fromJSON', () => {
    const s = new AssessmentSession({ id: 'sess-030', candidateId: 'cand-030' });
    s.start();
    s.appendTurn({ role: 'interviewer', content: 'Q1', dimension: 'D1' });
    s.appendTurn({ role: 'candidate', content: 'A1', dimension: 'D1' });
    s.markDimensionCovered('D1');
    s.incrementDimensionTurns('D1');

    const json = JSON.stringify(s.toJSON());
    const restored = AssessmentSession.fromJSON(JSON.parse(json));

    assert.equal(restored.id, 'sess-030');
    assert.equal(restored.candidateId, 'cand-030');
    assert.equal(restored.status, 'in_progress');
    assert.equal(restored.turnCount, 2);
    assert.equal(restored.transcript.turns[0].content, 'Q1');
    assert.equal(restored.getDimensionProgress('D1').covered, true);
    assert.equal(restored.getDimensionProgress('D1').turnCount, 1);
  });

  it('fromJSON handles abandoned sessions', () => {
    const s = new AssessmentSession({ id: 'sess-031', candidateId: 'cand-031' });
    s.start();
    s.abandon('test_reason');
    const restored = AssessmentSession.fromJSON(s.toJSON());
    assert.equal(restored.status, 'abandoned');
    assert.equal(restored.abandonReason, 'test_reason');
    assert.ok(restored.abandonedAt);
  });

  it('fromJSON throws on non-object', () => {
    assert.throws(() => AssessmentSession.fromJSON(null), /Cannot deserialize/);
    assert.throws(() => AssessmentSession.fromJSON('string'), /Cannot deserialize/);
  });
});

// ── 5. Anti-gaming guardrail ─────────────────────────────────────────

describe('Anti-gaming guardrail: prompt contains no rubric anchors', () => {
  it('buildInterviewerSystemPrompt for all dims × turns contains no RUBRIC_ANCHOR_STRINGS', () => {
    for (const dimId of DIMENSION_IDS) {
      for (let turn = 0; turn < 3; turn++) {
        const prior = turn > 0 ? ['some prior candidate answer text'] : [];
        const prompt = buildInterviewerSystemPrompt(dimId, turn, prior);
        for (const anchor of RUBRIC_ANCHOR_STRINGS) {
          assert.ok(
            !prompt.includes(anchor),
            `Rubric anchor "${anchor}" found in prompt for ${dimId} turn ${turn}:\n${prompt}`,
          );
        }
      }
    }
  });

  it('assertNoRubricLeakage passes on clean prompt', () => {
    const clean = 'Tell me about a time you supported volunteer engagement and retention.';
    assert.doesNotThrow(() => assertNoRubricLeakage(clean));
  });

  it('assertNoRubricLeakage throws when signal-type code is present', () => {
    const leaky = 'Please provide evidence of S2-level applied practice.';
    assert.throws(() => assertNoRubricLeakage(leaky), /Rubric leakage detected/);
    assert.throws(() => assertNoRubricLeakage(leaky), /S2/);
  });

  it('assertNoRubricLeakage throws on signal type description phrase', () => {
    const leaky = 'We are looking for Applied Practice examples from the candidate.';
    assert.throws(() => assertNoRubricLeakage(leaky), /Rubric leakage detected/);
    assert.throws(() => assertNoRubricLeakage(leaky), /Applied Practice/);
  });

  it('RUBRIC_ANCHOR_STRINGS includes S1–S6 and §3 description keywords', () => {
    for (const code of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) {
      assert.ok(RUBRIC_ANCHOR_STRINGS.includes(code), `${code} should be in RUBRIC_ANCHOR_STRINGS`);
    }
    assert.ok(RUBRIC_ANCHOR_STRINGS.includes('Recall/Recognition'));
    assert.ok(RUBRIC_ANCHOR_STRINGS.includes('Applied Practice'));
    assert.ok(RUBRIC_ANCHOR_STRINGS.includes('Reflective Practice'));
  });
});

// ── 6. runInterview() orchestration ─────────────────────────────────

describe('runInterview() orchestration', () => {
  it('happy path: completes session after one Q&A per dimension (maxTurnsPerDimension=1)', async () => {
    const session = new AssessmentSession({ id: 'iv-001', candidateId: 'cand-iv-001' });
    session.start();

    const result = await runInterview(
      session,
      makeInterviewerMock(),
      makeCandidateMock(),
      { maxTurnsPerDimension: 1 },
    );

    assert.equal(result.status, 'completed');
    assert.ok(result.completedAt);

    // Each dimension: 1 interviewer turn + 1 candidate turn = 2 turns per dim × 6 dims = 12
    assert.equal(result.turnCount, 12);

    // All 6 dimensions covered
    assert.equal(result.coveredDimensions.length, 6);

    // Transcript valid for P1 extractSignals()
    const t = result.transcript;
    assert.equal(t.turns.length, 12);
    assert.ok(t.turns.every(turn => turn.role === 'interviewer' || turn.role === 'candidate'));
  });

  it('candidate-end signal → session abandoned, no more dims processed', async () => {
    const session = new AssessmentSession({ id: 'iv-002', candidateId: 'cand-iv-002' });
    session.start();

    // Candidate ends on D2
    const result = await runInterview(
      session,
      makeInterviewerMock(),
      makeCandidateMock('D2'),
      { maxTurnsPerDimension: 1 },
    );

    assert.equal(result.status, 'abandoned');
    assert.equal(result.abandonReason, 'candidate_ended');

    // D1 completed (Q+A), D2 got question but candidate returned null
    // Turn structure: D1-Q, D1-A, D2-Q (then null → abandoned before appending D2-A)
    assert.equal(result.turnCount, 3);
    assert.equal(result.coveredDimensions.length, 1); // D1 only
    assert.deepStrictEqual(result.coveredDimensions, ['D1']);
  });

  it('throws if session is not in_progress', async () => {
    const session = new AssessmentSession({ id: 'iv-003', candidateId: 'cand-iv-003' });
    // session is still 'created'
    await assert.rejects(
      () => runInterview(session, makeInterviewerMock(), makeCandidateMock()),
      /Session must be in_progress/,
    );
  });

  it('throws if session is not an AssessmentSession', async () => {
    await assert.rejects(
      () => runInterview({}, makeInterviewerMock(), makeCandidateMock()),
      /session must be an AssessmentSession/,
    );
  });

  it('respects custom dimensionOrder', async () => {
    const session = new AssessmentSession({ id: 'iv-004', candidateId: 'cand-iv-004' });
    session.start();

    const result = await runInterview(
      session,
      makeInterviewerMock(),
      makeCandidateMock(),
      { maxTurnsPerDimension: 1, dimensionOrder: ['D3', 'D5'] },
    );

    assert.equal(result.status, 'completed');
    // 2 dims × 2 turns = 4 total turns
    assert.equal(result.turnCount, 4);
    // turns should be tagged with D3 then D5 in order
    assert.equal(result.transcript.turns[0].dimension, 'D3');
    assert.equal(result.transcript.turns[2].dimension, 'D5');
  });

  it('LLM is called once per dimension (one interviewer turn, coverage met)', async () => {
    const session = new AssessmentSession({ id: 'iv-005', candidateId: 'cand-iv-005' });
    session.start();

    const mock = makeInterviewerMock();
    await runInterview(
      session,
      mock,
      makeCandidateMock(),
      { maxTurnsPerDimension: 2 }, // max=2 but coverage met after turn 1
    );

    // Coverage met after 1 substantive response per dim → LLM called exactly 6 times
    assert.equal(mock.calls.length, 6, 'LLM called once per dimension (coverage met early-stops)');
  });

  it('DEFAULT_MAX_TURNS_PER_DIM is 2', () => {
    assert.equal(DEFAULT_MAX_TURNS_PER_DIM, 2);
  });
});

// ── 7. E2E dry run: interview → extractSignals → validator → scoreAssessment() ──

describe('E2E dry run: MockLlmAdapter interview → extractSignals → scoreAssessment()', () => {
  it('full pipeline produces a valid scored assessment from an interview session', async () => {
    // ── Step 1: Run structured interview ────────────────────────────

    const session = new AssessmentSession({
      id: 'e2e-session-001',
      candidateId: 'cand-e2e-001',
    });
    session.start();

    // Mock candidate gives a substantive answer every time
    const candidateAnswer =
      'I have led programs that align volunteer roles to our mission and produce measurable community outcomes.';

    const interviewResult = await runInterview(
      session,
      makeInterviewerMock(),
      async () => candidateAnswer,
      { maxTurnsPerDimension: 1 },
    );

    assert.equal(interviewResult.status, 'completed');
    const transcript = interviewResult.transcript;
    assert.ok(Array.isArray(transcript.turns));
    assert.equal(transcript.turns.length, 12); // 6 dims × 2 turns each (Q + A)

    // ── Step 2: Build extraction signals anchored to interview transcript ──

    // Candidate turns are at indices 1, 3, 5, 7, 9, 11 (every odd index)
    const candidateTurnIndices = transcript.turns
      .map((t, i) => [t, i])
      .filter(([t]) => t.role === 'candidate')
      .map(([, i]) => i);
    assert.equal(candidateTurnIndices.length, 6);

    // Build 3 signals per dimension referencing actual candidate turn content
    function mkSig(id, dim, type, strength, strengthLabel, anchorTier, turnIndex) {
      return {
        id,
        dimension: dim,
        type,
        strengthLabel,
        strength,
        anchorTier,
        corrected: false,
        evidenceRef: { turnIndex, spanText: 'I have led programs' },
        excerpt: 'I have led programs',
        hasFirstPersonSpecificity: true,
      };
    }

    const extractedSignals = [];
    DIMENSION_IDS.forEach((dim, di) => {
      const turnIdx = candidateTurnIndices[di];
      // S1/S2/S3 have different types → unique dedup keys even with same spanText
      extractedSignals.push(mkSig(`sig-${dim}-1`, dim, 'S1', 1.0, 'clear', 'foundational', turnIdx));
      extractedSignals.push(mkSig(`sig-${dim}-2`, dim, 'S2', 1.0, 'clear', 'developing', turnIdx));
      extractedSignals.push(mkSig(`sig-${dim}-3`, dim, 'S3', 1.5, 'strong', 'proficient', turnIdx));
    });

    // ── Step 3: Mock extraction LLM returns pre-built signals ────────

    const extractionMock = new MockLlmAdapter({
      '*': JSON.stringify({ signals: extractedSignals }),
    });

    const extractionResult = await extractSignals(transcript, extractionMock);

    assert.equal(extractionResult.transcriptId, 'e2e-session-001');
    assert.ok(Array.isArray(extractionResult.signals));
    assert.equal(extractionResult.signals.length, extractedSignals.length,
      `Expected ${extractedSignals.length} signals, got ${extractionResult.signals.length}. ` +
      `Dropped: ${JSON.stringify(extractionResult.dropped)}, ` +
      `Errors: ${JSON.stringify(extractionResult.validationErrors)}`);

    // ── Step 4: Validate signals ─────────────────────────────────────

    const { valid, errors: validationErrors } = validateSignals(
      extractionResult.signals,
      transcript,
    );
    assert.equal(validationErrors.length, 0,
      `Validation errors: ${JSON.stringify(validationErrors)}`);
    assert.equal(valid.length, extractedSignals.length);

    // ── Step 5: Score via existing rubric v1.2 engine ────────────────

    const dimensions = {};
    for (const dimId of DIMENSION_IDS) dimensions[dimId] = [];
    for (const sig of valid) {
      dimensions[sig.dimension].push({
        id: sig.id,
        type: sig.type,
        strength: sig.strength,
        anchorTier: sig.anchorTier,
        excerpt: sig.excerpt ?? sig.evidenceRef.spanText,
        anchor: sig.anchor,
        hasFirstPersonSpecificity: sig.hasFirstPersonSpecificity ?? true,
        corrected: sig.corrected,
      });
    }

    const result = scoreAssessment({ dimensions });

    // ── Assertions ───────────────────────────────────────────────────

    assert.equal(result.rubricVersion, RUBRIC_VERSION);
    assert.equal(result.dimensions.length, 6);

    for (const dim of result.dimensions) {
      assert.equal(dim.insufficientEvidence, false,
        `${dim.id} should not be insufficient (3 signals per dim)`);
      assert.ok(typeof dim.score === 'number');
      assert.ok(dim.score >= 1.0 && dim.score <= 10.0, `${dim.id} score ${dim.score} out of range`);
    }

    assert.equal(typeof result.overall.score, 'number');
    assert.equal(result.overall.incomplete, false);
    assert.ok(typeof result.overall.tier === 'string');
  });
});
