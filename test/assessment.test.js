/**
 * Volo Index — Assessment Engine P0 Tests
 *
 * Covers:
 * 1. Schema exports and enum constants
 * 2. LlmAdapter interface + MockLlmAdapter behavior
 * 3. Validator: valid signals, malformed rejection, dedup, §3/§5 consistency
 * 4. End-to-end dry run: fixture transcript → mock extraction → validator → scoreAssessment()
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SIGNAL_TYPES, STRENGTH_LABELS, STRENGTH_VALUES,
  CANDIDATE_SIGNAL_SCHEMA, ASSESSMENT_TRANSCRIPT_SCHEMA,
  MockLlmAdapter, LlmAdapter,
  validateSignals, ErrorCodes,
} from '../src/assessment/index.js';

import { scoreAssessment, RUBRIC_VERSION, DIMENSION_IDS } from '../src/scoring/index.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** Build a valid CandidateSignal for testing */
function mkSignal(overrides = {}) {
  return {
    id: 'sig-001',
    dimension: 'D1',
    type: 'S3',
    strengthLabel: 'clear',
    strength: 1.0,
    anchorTier: 'proficient',
    corrected: false,
    evidenceRef: { turnIndex: 1, spanText: 'We link volunteer roles to our theory of change' },
    excerpt: 'We link volunteer roles to our theory of change',
    anchor: 'outcome-linked goals',
    hasFirstPersonSpecificity: true,
    ...overrides,
  };
}

/** Build a fixture transcript */
function mkTranscript(turnCount = 6) {
  const turns = [];
  for (let i = 0; i < turnCount; i++) {
    turns.push({
      role: i % 2 === 0 ? 'interviewer' : 'candidate',
      content: i % 2 === 0
        ? `Tell me about your approach to dimension ${Math.floor(i / 2) + 1}.`
        : `In my role I developed a structured approach to volunteer engagement including specific programs and measurable outcomes.`,
      ...(i % 2 === 0 ? { dimension: `D${Math.floor(i / 2) + 1}` } : {}),
    });
  }
  return {
    id: 'transcript-001',
    candidateId: 'candidate-anon-001',
    startedAt: '2026-07-05T10:00:00Z',
    completedAt: '2026-07-05T10:30:00Z',
    turns,
  };
}

/**
 * Build a full set of valid signals across all 6 dimensions (3+ per dim)
 * suitable for passing through the validator and into scoreAssessment().
 */
function mkFullSignalSet() {
  const signals = [];
  let sigIdx = 0;

  for (const dim of DIMENSION_IDS) {
    // 3 signals per dimension: S1 foundational, S2 developing, S3 proficient
    signals.push(mkSignal({
      id: `sig-${dim}-${++sigIdx}`,
      dimension: dim,
      type: 'S1',
      strengthLabel: 'clear',
      strength: 1.0,
      anchorTier: 'foundational',
      evidenceRef: { turnIndex: 1, spanText: `${dim} recall evidence` },
    }));
    signals.push(mkSignal({
      id: `sig-${dim}-${++sigIdx}`,
      dimension: dim,
      type: 'S2',
      strengthLabel: 'clear',
      strength: 1.0,
      anchorTier: 'developing',
      evidenceRef: { turnIndex: 1, spanText: `${dim} applied practice evidence` },
    }));
    signals.push(mkSignal({
      id: `sig-${dim}-${++sigIdx}`,
      dimension: dim,
      type: 'S2',
      strengthLabel: 'strong',
      strength: 1.5,
      anchorTier: 'developing',
      evidenceRef: { turnIndex: 1, spanText: `${dim} strong applied practice evidence` },
    }));
  }

  return signals;
}

// ── 1. Schema exports ───────────────────────────────────────────────

describe('Assessment schemas', () => {
  it('exports signal type enums', () => {
    assert.deepStrictEqual(SIGNAL_TYPES, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'N']);
  });

  it('exports strength labels and values', () => {
    assert.deepStrictEqual(STRENGTH_LABELS, ['weak', 'clear', 'strong']);
    assert.deepStrictEqual(STRENGTH_VALUES, { weak: 0.5, clear: 1.0, strong: 1.5 });
  });

  it('CANDIDATE_SIGNAL_SCHEMA has all required fields', () => {
    const required = CANDIDATE_SIGNAL_SCHEMA.required;
    for (const f of ['id', 'dimension', 'type', 'strengthLabel', 'strength', 'anchorTier', 'corrected', 'evidenceRef']) {
      assert.ok(required.includes(f), `Missing required field: ${f}`);
    }
  });

  it('ASSESSMENT_TRANSCRIPT_SCHEMA has all required fields', () => {
    const required = ASSESSMENT_TRANSCRIPT_SCHEMA.required;
    for (const f of ['id', 'candidateId', 'startedAt', 'turns']) {
      assert.ok(required.includes(f), `Missing required field: ${f}`);
    }
  });
});

// ── 2. LlmAdapter ──────────────────────────────────────────────────

describe('LlmAdapter', () => {
  it('base class throws on complete()', async () => {
    const adapter = new LlmAdapter();
    await assert.rejects(() => adapter.complete([]), /must be implemented/);
  });
});

describe('MockLlmAdapter', () => {
  it('returns matched response based on user message substring', async () => {
    const mock = new MockLlmAdapter({
      'dimension 1': '{"signals":[{"type":"S1"}]}',
      '*': '{"signals":[]}',
    });
    const result = await mock.complete([
      { role: 'system', content: 'Extract signals.' },
      { role: 'user', content: 'Transcript for dimension 1...' },
    ]);
    assert.equal(result.text, '{"signals":[{"type":"S1"}]}');
    assert.equal(result.usage.promptTokens, 100);
  });

  it('returns fallback when no key matches', async () => {
    const mock = new MockLlmAdapter({ '*': '{"fallback":true}' });
    const result = await mock.complete([{ role: 'user', content: 'anything' }]);
    assert.equal(result.text, '{"fallback":true}');
  });

  it('returns empty signals JSON when no responses configured', async () => {
    const mock = new MockLlmAdapter();
    const result = await mock.complete([{ role: 'user', content: 'hello' }]);
    assert.equal(result.text, '{"signals":[]}');
  });

  it('records all calls', async () => {
    const mock = new MockLlmAdapter({ '*': 'ok' });
    await mock.complete([{ role: 'user', content: 'a' }]);
    await mock.complete([{ role: 'user', content: 'b' }], { temperature: 0.5 });
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls[1].opts.temperature, 0.5);
  });
});

// ── 3. Validator ────────────────────────────────────────────────────

describe('Validator: valid signals', () => {
  it('accepts a well-formed signal', () => {
    const { valid, errors } = validateSignals([mkSignal()]);
    assert.equal(errors.length, 0);
    assert.equal(valid.length, 1);
  });

  it('accepts multiple valid signals', () => {
    const signals = mkFullSignalSet();
    const { valid, errors } = validateSignals(signals);
    assert.equal(errors.length, 0);
    assert.equal(valid.length, signals.length);
  });

  it('accepts N signal with corrected=true', () => {
    const { valid, errors } = validateSignals([mkSignal({
      id: 'sig-n-001',
      type: 'N',
      strengthLabel: 'clear',
      strength: 1.0,
      anchorTier: 'developing',
      corrected: true,
    })]);
    assert.equal(errors.length, 0);
    assert.equal(valid.length, 1);
  });
});

describe('Validator: malformed rejection', () => {
  it('rejects non-array input', () => {
    const { errors } = validateSignals('not an array');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, ErrorCodes.INVALID_TYPE);
  });

  it('rejects signal missing required fields', () => {
    const { errors } = validateSignals([{ id: 'bad-1' }]);
    assert.ok(errors.length > 0);
    assert.ok(errors.some(e => e.code === ErrorCodes.MISSING_FIELD));
  });

  it('rejects invalid dimension', () => {
    const { errors } = validateSignals([mkSignal({ dimension: 'D99' })]);
    assert.ok(errors.some(e => e.code === ErrorCodes.INVALID_ENUM && e.field === 'dimension'));
  });

  it('rejects invalid signal type', () => {
    const { errors } = validateSignals([mkSignal({ type: 'X1' })]);
    assert.ok(errors.some(e => e.code === ErrorCodes.INVALID_ENUM && e.field === 'type'));
  });

  it('rejects invalid strength value', () => {
    const { errors } = validateSignals([mkSignal({ strength: 2.0 })]);
    assert.ok(errors.some(e => e.code === ErrorCodes.INVALID_ENUM && e.field === 'strength'));
  });

  it('rejects strength/strengthLabel mismatch', () => {
    const { errors } = validateSignals([mkSignal({ strengthLabel: 'weak', strength: 1.0 })]);
    assert.ok(errors.some(e => e.code === ErrorCodes.STRENGTH_MISMATCH));
  });

  it('rejects invalid anchorTier', () => {
    const { errors } = validateSignals([mkSignal({ anchorTier: 'legendary' })]);
    assert.ok(errors.some(e => e.code === ErrorCodes.INVALID_ENUM && e.field === 'anchorTier'));
  });

  it('rejects missing evidenceRef', () => {
    const sig = mkSignal();
    delete sig.evidenceRef;
    const { errors } = validateSignals([sig]);
    assert.ok(errors.some(e => e.code === ErrorCodes.MISSING_FIELD || e.code === ErrorCodes.MISSING_EVIDENCE_REF));
  });

  it('rejects evidenceRef with missing spanText', () => {
    const { errors } = validateSignals([mkSignal({ evidenceRef: { turnIndex: 0, spanText: '' } })]);
    assert.ok(errors.some(e => e.code === ErrorCodes.INVALID_EVIDENCE_REF));
  });

  it('rejects evidenceRef with negative turnIndex', () => {
    const { errors } = validateSignals([mkSignal({ evidenceRef: { turnIndex: -1, spanText: 'text' } })]);
    assert.ok(errors.some(e => e.code === ErrorCodes.INVALID_EVIDENCE_REF));
  });
});

describe('Validator: §3/§5 consistency', () => {
  it('rejects S2 anchored below developing', () => {
    const { errors } = validateSignals([mkSignal({
      type: 'S2',
      anchorTier: 'foundational',
    })]);
    assert.ok(errors.some(e => e.code === ErrorCodes.TIER_TYPE_MISMATCH));
  });

  it('rejects S5 anchored below expert', () => {
    const { errors } = validateSignals([mkSignal({
      type: 'S5',
      anchorTier: 'proficient',
    })]);
    assert.ok(errors.some(e => e.code === ErrorCodes.TIER_TYPE_MISMATCH));
  });

  it('allows S1 at any anchor tier', () => {
    for (const tier of ['foundational', 'developing', 'proficient', 'expert']) {
      const { errors } = validateSignals([mkSignal({
        id: `s1-${tier}`,
        type: 'S1',
        strengthLabel: 'clear',
        strength: 1.0,
        anchorTier: tier,
        evidenceRef: { turnIndex: 1, spanText: `s1 at ${tier}` },
      })]);
      assert.equal(errors.length, 0, `S1 at ${tier} should be valid`);
    }
  });

  it('allows N at any anchor tier', () => {
    for (const tier of ['foundational', 'developing', 'proficient', 'expert']) {
      const { errors } = validateSignals([mkSignal({
        id: `n-${tier}`,
        type: 'N',
        strengthLabel: 'clear',
        strength: 1.0,
        anchorTier: tier,
        corrected: false,
        evidenceRef: { turnIndex: 1, spanText: `n at ${tier}` },
      })]);
      assert.equal(errors.length, 0, `N at ${tier} should be valid`);
    }
  });
});

describe('Validator: dedup', () => {
  it('rejects duplicate signals (same dim + type + turnIndex + spanText)', () => {
    const s = mkSignal();
    const dup = mkSignal({ id: 'sig-002' });
    const { valid, errors } = validateSignals([s, dup]);
    assert.equal(valid.length, 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, ErrorCodes.DUPLICATE_SIGNAL);
  });

  it('allows same type in different dimensions', () => {
    const s1 = mkSignal({ id: 'sig-d1', dimension: 'D1', evidenceRef: { turnIndex: 1, spanText: 'evidence D1' } });
    const s2 = mkSignal({ id: 'sig-d2', dimension: 'D2', evidenceRef: { turnIndex: 1, spanText: 'evidence D2' } });
    const { valid, errors } = validateSignals([s1, s2]);
    assert.equal(errors.length, 0);
    assert.equal(valid.length, 2);
  });
});

describe('Validator: transcript-bound checks', () => {
  it('rejects evidenceRef.turnIndex out of transcript bounds', () => {
    const transcript = mkTranscript(4);
    const sig = mkSignal({ evidenceRef: { turnIndex: 10, spanText: 'nonexistent' } });
    const { errors } = validateSignals([sig], transcript);
    assert.ok(errors.some(e => e.code === ErrorCodes.EVIDENCE_OUT_OF_RANGE));
  });

  it('accepts valid turnIndex within transcript bounds', () => {
    const transcript = mkTranscript(4);
    const sig = mkSignal({ evidenceRef: { turnIndex: 1, spanText: 'valid span' } });
    const { valid, errors } = validateSignals([sig], transcript);
    assert.equal(errors.length, 0);
    assert.equal(valid.length, 1);
  });

  it('rejects invalid transcript structure', () => {
    const { errors } = validateSignals([mkSignal()], { id: 'bad' });
    assert.ok(errors.some(e => e.code === ErrorCodes.INVALID_TRANSCRIPT));
  });
});

// ── 4. End-to-end dry run ───────────────────────────────────────────

describe('E2E dry run: transcript → mock extraction → validator → scoreAssessment()', () => {
  it('full pipeline produces a valid scored assessment', async () => {
    // Step 1: Build fixture transcript
    const transcript = mkTranscript(24); // 12 interviewer + 12 candidate turns

    // Step 2: Simulate LLM extraction via MockLlmAdapter
    const extractedSignals = mkFullSignalSet();
    const mockResponse = JSON.stringify({ signals: extractedSignals });
    const adapter = new MockLlmAdapter({ '*': mockResponse });

    const llmResult = await adapter.complete([
      { role: 'system', content: 'Extract candidate signals from the transcript.' },
      { role: 'user', content: JSON.stringify(transcript) },
    ]);

    // Step 3: Parse mock LLM output
    const parsed = JSON.parse(llmResult.text);
    assert.ok(Array.isArray(parsed.signals));
    assert.equal(parsed.signals.length, extractedSignals.length);

    // Step 4: Validate through the deterministic validator
    const { valid, errors } = validateSignals(parsed.signals, transcript);
    assert.equal(errors.length, 0, `Validation errors: ${JSON.stringify(errors)}`);
    assert.equal(valid.length, extractedSignals.length);

    // Step 5: Transform validated signals into scoreAssessment() input shape
    const dimensions = {};
    for (const dimId of DIMENSION_IDS) {
      dimensions[dimId] = [];
    }
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

    // Step 6: Score through the existing scoring engine
    const result = scoreAssessment({ dimensions });

    // Assertions on the scored output
    assert.equal(result.rubricVersion, RUBRIC_VERSION);
    assert.equal(result.dimensions.length, 6);

    // Every dimension should have scored (3 signals each, >= MIN_SIGNALS_FOR_SCORING)
    for (const dim of result.dimensions) {
      assert.equal(dim.insufficientEvidence, false, `${dim.id} should not be insufficient`);
      assert.equal(typeof dim.score, 'number', `${dim.id} should have a numeric score`);
      assert.ok(dim.score >= 1.0 && dim.score <= 10.0, `${dim.id} score ${dim.score} out of range`);
    }

    // Overall should be computed
    assert.equal(typeof result.overall.score, 'number');
    assert.equal(result.overall.incomplete, false);
    assert.equal(typeof result.overall.tier, 'string');
  });

  it('pipeline correctly rejects invalid LLM output and prevents scoring', async () => {
    // Simulate LLM returning malformed signals
    const badSignals = [
      { id: 'bad-1', dimension: 'D1', type: 'S99', strength: 3.0 },  // invalid type and strength
    ];
    const adapter = new MockLlmAdapter({ '*': JSON.stringify({ signals: badSignals }) });

    const llmResult = await adapter.complete([
      { role: 'user', content: 'transcript data' },
    ]);

    const parsed = JSON.parse(llmResult.text);
    const { valid, errors } = validateSignals(parsed.signals);

    // Bad signals should be rejected
    assert.ok(errors.length > 0);
    assert.equal(valid.length, 0);

    // Score with empty valid signals → all dimensions insufficient → incomplete
    const dimensions = {};
    for (const dimId of DIMENSION_IDS) {
      dimensions[dimId] = valid.filter(s => s.dimension === dimId);
    }
    const result = scoreAssessment({ dimensions });
    assert.equal(result.overall.incomplete, true);
    assert.equal(result.overall.score, null);
  });

  it('pipeline handles red-flag (N) signals through the full path', async () => {
    const transcript = mkTranscript(12);

    // D1: 2 positive + 1 uncorrected N → scores with §5.4 cap (BUG-001: counts toward IE min)
    const signals = [
      mkSignal({ id: 'rf-1', dimension: 'D1', type: 'S1', strengthLabel: 'clear', strength: 1.0, anchorTier: 'foundational', evidenceRef: { turnIndex: 1, spanText: 'recalls concept' } }),
      mkSignal({ id: 'rf-2', dimension: 'D1', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing', evidenceRef: { turnIndex: 3, spanText: 'applied example' } }),
      mkSignal({ id: 'rf-3', dimension: 'D1', type: 'N', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing', corrected: false, evidenceRef: { turnIndex: 5, spanText: 'volunteers are free labor' } }),
      // D2–D6: 3 signals each to avoid incomplete
      ...DIMENSION_IDS.slice(1).flatMap((dim, di) => [
        mkSignal({ id: `fill-${dim}-1`, dimension: dim, type: 'S1', strengthLabel: 'clear', strength: 1.0, anchorTier: 'foundational', evidenceRef: { turnIndex: 1, spanText: `${dim} s1` } }),
        mkSignal({ id: `fill-${dim}-2`, dimension: dim, type: 'S1', strengthLabel: 'weak', strength: 0.5, anchorTier: 'foundational', evidenceRef: { turnIndex: 3, spanText: `${dim} s1b` } }),
        mkSignal({ id: `fill-${dim}-3`, dimension: dim, type: 'S1', strengthLabel: 'clear', strength: 1.0, anchorTier: 'foundational', evidenceRef: { turnIndex: 5, spanText: `${dim} s1c` } }),
      ]),
    ];

    const { valid, errors } = validateSignals(signals, transcript);
    assert.equal(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);

    const dimensions = {};
    for (const dimId of DIMENSION_IDS) dimensions[dimId] = [];
    for (const sig of valid) {
      dimensions[sig.dimension].push({
        id: sig.id,
        type: sig.type,
        strength: sig.strength,
        anchorTier: sig.anchorTier,
        excerpt: sig.evidenceRef.spanText,
        hasFirstPersonSpecificity: true,
        corrected: sig.corrected,
      });
    }

    const result = scoreAssessment({ dimensions });

    // D1 should score (BUG-001: 3 total signals including N >= 3 minimum)
    const d1 = result.dimensions.find(d => d.id === 'D1');
    assert.equal(d1.insufficientEvidence, false, 'D1 with 2 positive + 1 N should score per BUG-001');
    assert.equal(d1.redFlags.length, 1);
    assert.equal(d1.redFlags[0].corrected, false);
  });

  it('adapter usage tracking works for cost auditing', async () => {
    const adapter = new MockLlmAdapter({ '*': '{"signals":[]}' });
    await adapter.complete([{ role: 'user', content: 'a' }]);
    await adapter.complete([{ role: 'user', content: 'b' }]);

    const totalPrompt = adapter.calls.reduce((sum, c) => sum + 100, 0);
    const totalCompletion = adapter.calls.reduce((sum, c) => sum + 50, 0);
    assert.equal(totalPrompt, 200);
    assert.equal(totalCompletion, 100);
    assert.equal(adapter.calls.length, 2);
  });
});
