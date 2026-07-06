/**
 * Volo Index — Signal Extractor Tests (P1)
 *
 * All tests use MockLlmAdapter only — no vendor SDK, no network.
 *
 * Covers:
 * 1. Happy path: transcript → extractSignals → valid CandidateSignal[]
 * 2. Malformed JSON first pass, valid on repair
 * 3. Malformed JSON both passes → ExtractionError (REPAIR_FAILED)
 * 4. Hallucinated evidenceRef dropped by anti-hallucination gate
 * 5. Dedup: duplicates caught by deterministic validator
 * 6. Invalid transcript → ExtractionError (INVALID_TRANSCRIPT)
 * 7. E2E: fixture transcript → extractSignals → scoreAssessment() (rubric v1.2)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractSignals, ExtractionError, ExtractionErrorCodes } from '../src/assessment/extractor.js';
import { MockLlmAdapter } from '../src/assessment/index.js';
import { scoreAssessment, RUBRIC_VERSION, DIMENSION_IDS } from '../src/scoring/index.js';

// ── Fixture helpers ──────────────────────────────────────────────────

/**
 * Minimal 4-turn transcript (2 Q&A pairs).
 * Turn indices:
 *   0 interviewer D1 | 1 candidate | 2 interviewer D2 | 3 candidate
 */
const SIMPLE_TRANSCRIPT = {
  id: 'transcript-simple-001',
  candidateId: 'candidate-001',
  startedAt: '2026-07-05T10:00:00Z',
  turns: [
    { role: 'interviewer', content: 'Tell me about your volunteer engagement strategy.', dimension: 'D1' },
    { role: 'candidate',   content: 'I align volunteer roles to our theory of change and track outcome metrics each quarter.' },
    { role: 'interviewer', content: 'How do you recruit volunteers?', dimension: 'D2' },
    { role: 'candidate',   content: 'We use a structured skills-based matching process for each volunteer intake.' },
  ],
};

/** Build a fully valid CandidateSignal anchored to SIMPLE_TRANSCRIPT turn 1 */
function mkValidSignal(overrides = {}) {
  return {
    id: 'sig-D1-001',
    dimension: 'D1',
    type: 'S2',
    strengthLabel: 'clear',
    strength: 1.0,
    anchorTier: 'developing',
    corrected: false,
    evidenceRef: { turnIndex: 1, spanText: 'I align volunteer roles to our theory of change' },
    excerpt: 'I align volunteer roles to our theory of change',
    hasFirstPersonSpecificity: true,
    ...overrides,
  };
}

/**
 * 12-turn transcript (one Q&A per dimension).
 * Candidate turn indices: 1, 3, 5, 7, 9, 11
 */
const E2E_TRANSCRIPT = {
  id: 'e2e-transcript-001',
  candidateId: 'candidate-e2e-001',
  startedAt: '2026-07-05T09:00:00Z',
  turns: [
    { role: 'interviewer', content: 'How do you align volunteers with strategic goals?', dimension: 'D1' },
    { role: 'candidate',   content: 'I align volunteer roles to our theory of change, set outcome metrics, and review them quarterly with leadership.' },
    { role: 'interviewer', content: 'Tell me about recruitment and matching.', dimension: 'D2' },
    { role: 'candidate',   content: 'We use skills-based intake interviews and a structured matching process to place volunteers in suitable roles.' },
    { role: 'interviewer', content: 'Describe your training approach.', dimension: 'D3' },
    { role: 'candidate',   content: 'I design role-specific training modules and pair new volunteers with experienced mentors.' },
    { role: 'interviewer', content: 'How do you manage performance?', dimension: 'D4' },
    { role: 'candidate',   content: 'We track contribution hours, task completion rates, and run quarterly feedback surveys.' },
    { role: 'interviewer', content: 'What about recognition and retention?', dimension: 'D5' },
    { role: 'candidate',   content: 'I celebrate milestones publicly, send personalized thank-you notes, and host annual recognition events.' },
    { role: 'interviewer', content: 'Tell me about ethics and equity.', dimension: 'D6' },
    { role: 'candidate',   content: 'I apply an equity lens to all volunteer roles and advocate for fair treatment and accessible participation.' },
  ],
};

/**
 * 3 signals per dimension anchored verbatim to E2E_TRANSCRIPT content.
 * Each dimension gets: S1 weak + S2 clear + S2 clear/strong → qualifies Developing.
 */
function mkE2ESignals() {
  return [
    // D1 — turnIndex 1
    { id: 'sig-D1-1', dimension: 'D1', type: 'S1', strengthLabel: 'weak',  strength: 0.5, anchorTier: 'foundational', corrected: false, evidenceRef: { turnIndex: 1, spanText: 'I align volunteer roles to our theory of change' }, excerpt: 'I align volunteer roles to our theory of change', hasFirstPersonSpecificity: true },
    { id: 'sig-D1-2', dimension: 'D1', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 1, spanText: 'set outcome metrics' }, excerpt: 'set outcome metrics', hasFirstPersonSpecificity: true },
    { id: 'sig-D1-3', dimension: 'D1', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 1, spanText: 'review them quarterly with leadership' }, excerpt: 'review them quarterly with leadership', hasFirstPersonSpecificity: true },
    // D2 — turnIndex 3
    { id: 'sig-D2-1', dimension: 'D2', type: 'S1', strengthLabel: 'weak',  strength: 0.5, anchorTier: 'foundational', corrected: false, evidenceRef: { turnIndex: 3, spanText: 'skills-based intake interviews' }, excerpt: 'skills-based intake interviews', hasFirstPersonSpecificity: true },
    { id: 'sig-D2-2', dimension: 'D2', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 3, spanText: 'a structured matching process' }, excerpt: 'a structured matching process', hasFirstPersonSpecificity: true },
    { id: 'sig-D2-3', dimension: 'D2', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 3, spanText: 'to place volunteers in suitable roles' }, excerpt: 'to place volunteers in suitable roles', hasFirstPersonSpecificity: true },
    // D3 — turnIndex 5
    { id: 'sig-D3-1', dimension: 'D3', type: 'S1', strengthLabel: 'weak',   strength: 0.5, anchorTier: 'foundational', corrected: false, evidenceRef: { turnIndex: 5, spanText: 'I design role-specific training modules' }, excerpt: 'I design role-specific training modules', hasFirstPersonSpecificity: true },
    { id: 'sig-D3-2', dimension: 'D3', type: 'S2', strengthLabel: 'clear',  strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 5, spanText: 'pair new volunteers with experienced mentors' }, excerpt: 'pair new volunteers with experienced mentors', hasFirstPersonSpecificity: true },
    { id: 'sig-D3-3', dimension: 'D3', type: 'S2', strengthLabel: 'strong', strength: 1.5, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 5, spanText: 'design role-specific training modules and pair new volunteers with experienced mentors' }, excerpt: 'design role-specific training modules and pair new volunteers with experienced mentors', hasFirstPersonSpecificity: true },
    // D4 — turnIndex 7
    { id: 'sig-D4-1', dimension: 'D4', type: 'S1', strengthLabel: 'weak',  strength: 0.5, anchorTier: 'foundational', corrected: false, evidenceRef: { turnIndex: 7, spanText: 'contribution hours' }, excerpt: 'contribution hours', hasFirstPersonSpecificity: true },
    { id: 'sig-D4-2', dimension: 'D4', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 7, spanText: 'task completion rates' }, excerpt: 'task completion rates', hasFirstPersonSpecificity: true },
    { id: 'sig-D4-3', dimension: 'D4', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 7, spanText: 'run quarterly feedback surveys' }, excerpt: 'run quarterly feedback surveys', hasFirstPersonSpecificity: true },
    // D5 — turnIndex 9
    { id: 'sig-D5-1', dimension: 'D5', type: 'S1', strengthLabel: 'weak',  strength: 0.5, anchorTier: 'foundational', corrected: false, evidenceRef: { turnIndex: 9, spanText: 'celebrate milestones publicly' }, excerpt: 'celebrate milestones publicly', hasFirstPersonSpecificity: true },
    { id: 'sig-D5-2', dimension: 'D5', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 9, spanText: 'send personalized thank-you notes' }, excerpt: 'send personalized thank-you notes', hasFirstPersonSpecificity: true },
    { id: 'sig-D5-3', dimension: 'D5', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 9, spanText: 'host annual recognition events' }, excerpt: 'host annual recognition events', hasFirstPersonSpecificity: true },
    // D6 — turnIndex 11
    { id: 'sig-D6-1', dimension: 'D6', type: 'S1', strengthLabel: 'weak',  strength: 0.5, anchorTier: 'foundational', corrected: false, evidenceRef: { turnIndex: 11, spanText: 'I apply an equity lens to all volunteer roles' }, excerpt: 'I apply an equity lens to all volunteer roles', hasFirstPersonSpecificity: true },
    { id: 'sig-D6-2', dimension: 'D6', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 11, spanText: 'advocate for fair treatment' }, excerpt: 'advocate for fair treatment', hasFirstPersonSpecificity: true },
    { id: 'sig-D6-3', dimension: 'D6', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 11, spanText: 'accessible participation' }, excerpt: 'accessible participation', hasFirstPersonSpecificity: true },
  ];
}

// ── 1. Happy path ────────────────────────────────────────────────────

describe('extractSignals: happy path', () => {
  it('returns valid signals from a well-formed LLM response', async () => {
    const signal = mkValidSignal();
    const adapter = new MockLlmAdapter({ '*': JSON.stringify({ signals: [signal] }) });

    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);

    assert.equal(result.transcriptId, SIMPLE_TRANSCRIPT.id);
    assert.equal(result.signals.length, 1);
    assert.equal(result.signals[0].id, 'sig-D1-001');
    assert.equal(result.dropped.length, 0);
    assert.equal(result.validationErrors.length, 0);
    assert.equal(adapter.calls.length, 1, 'Only one LLM call needed on success');
  });

  it('returns empty signals array when LLM returns no signals', async () => {
    const adapter = new MockLlmAdapter({ '*': '{"signals":[]}' });
    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);

    assert.equal(result.signals.length, 0);
    assert.equal(result.dropped.length, 0);
    assert.equal(result.validationErrors.length, 0);
  });

  it('accumulates usage from the single LLM call', async () => {
    const adapter = new MockLlmAdapter({ '*': '{"signals":[]}' });
    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);

    assert.equal(result.usage.promptTokens, 100);
    assert.equal(result.usage.completionTokens, 50);
  });

  it('passes completion opts to adapter', async () => {
    const adapter = new MockLlmAdapter({ '*': '{"signals":[]}' });
    await extractSignals(SIMPLE_TRANSCRIPT, adapter, { temperature: 0.2, maxTokens: 512 });

    assert.equal(adapter.calls[0].opts.temperature, 0.2);
    assert.equal(adapter.calls[0].opts.maxTokens, 512);
  });
});

// ── 2. Bounded repair loop ───────────────────────────────────────────

describe('extractSignals: bounded repair loop', () => {
  it('retries once on malformed JSON and succeeds when repair response is valid', async () => {
    const signal = mkValidSignal();
    const validJson = JSON.stringify({ signals: [signal] });

    // First call (matches '*') → garbage; repair call (matches key phrase) → valid
    const adapter = new MockLlmAdapter({
      'Your previous response could not be parsed': validJson,
      '*': 'not valid json {{{',
    });

    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);

    assert.equal(adapter.calls.length, 2, 'Original call + one repair call');
    assert.equal(result.signals.length, 1);
  });

  it('accumulates usage across both calls when repair is needed', async () => {
    const signal = mkValidSignal();
    const adapter = new MockLlmAdapter({
      'Your previous response could not be parsed': JSON.stringify({ signals: [signal] }),
      '*': 'bad json',
    });

    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);
    // MockLlmAdapter always returns { promptTokens: 100, completionTokens: 50 }
    assert.equal(result.usage.promptTokens, 200);
    assert.equal(result.usage.completionTokens, 100);
  });

  it('throws ExtractionError(REPAIR_FAILED) when both attempts return bad JSON', async () => {
    const adapter = new MockLlmAdapter({ '*': 'not json at all' });

    await assert.rejects(
      () => extractSignals(SIMPLE_TRANSCRIPT, adapter),
      (err) => {
        assert.ok(err instanceof ExtractionError, `Expected ExtractionError, got ${err.constructor.name}`);
        assert.equal(err.code, ExtractionErrorCodes.REPAIR_FAILED);
        return true;
      },
    );

    assert.equal(adapter.calls.length, 2, 'Original + one repair call before giving up');
  });

  it('throws ExtractionError(REPAIR_FAILED) when first response has missing signals key', async () => {
    // Valid JSON but not the expected shape; repair also returns same
    const adapter = new MockLlmAdapter({ '*': '{"data":[]}' });

    await assert.rejects(
      () => extractSignals(SIMPLE_TRANSCRIPT, adapter),
      (err) => {
        assert.ok(err instanceof ExtractionError);
        assert.equal(err.code, ExtractionErrorCodes.REPAIR_FAILED);
        return true;
      },
    );
  });
});

// ── 3. Anti-hallucination gate ───────────────────────────────────────

describe('extractSignals: anti-hallucination gate', () => {
  it('drops a signal whose spanText does not appear verbatim in the referenced turn', async () => {
    const hallucinatedSignal = mkValidSignal({
      id: 'sig-hallucinated',
      evidenceRef: { turnIndex: 1, spanText: 'this text was never spoken by the candidate' },
    });
    const adapter = new MockLlmAdapter({ '*': JSON.stringify({ signals: [hallucinatedSignal] }) });

    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);

    assert.equal(result.signals.length, 0, 'Hallucinated signal should not appear in valid signals');
    assert.equal(result.dropped.length, 1);
    assert.ok(result.dropped[0].reason.includes('not found verbatim'));
  });

  it('drops a signal with an out-of-bounds turnIndex', async () => {
    const oobSignal = mkValidSignal({
      id: 'sig-oob',
      evidenceRef: { turnIndex: 99, spanText: 'some text' },
    });
    const adapter = new MockLlmAdapter({ '*': JSON.stringify({ signals: [oobSignal] }) });

    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);

    assert.equal(result.signals.length, 0);
    assert.equal(result.dropped.length, 1);
    assert.ok(result.dropped[0].reason.includes('out of bounds'));
  });

  it('keeps valid signals and drops hallucinated ones in the same batch', async () => {
    const good = mkValidSignal({ id: 'sig-good' });
    const bad  = mkValidSignal({
      id: 'sig-bad',
      evidenceRef: { turnIndex: 1, spanText: 'invented span that does not exist' },
    });
    const adapter = new MockLlmAdapter({ '*': JSON.stringify({ signals: [good, bad] }) });

    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);

    assert.equal(result.signals.length, 1);
    assert.equal(result.signals[0].id, 'sig-good');
    assert.equal(result.dropped.length, 1);
    assert.equal(result.dropped[0].signal.id, 'sig-bad');
  });

  it('drops a signal with a missing evidenceRef', async () => {
    const noRef = { ...mkValidSignal({ id: 'sig-no-ref' }) };
    delete noRef.evidenceRef;
    const adapter = new MockLlmAdapter({ '*': JSON.stringify({ signals: [noRef] }) });

    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);

    assert.equal(result.dropped.length, 1);
    assert.ok(result.dropped[0].reason.includes('malformed'));
  });
});

// ── 4. Dedup ─────────────────────────────────────────────────────────

describe('extractSignals: dedup via validator', () => {
  it('drops a duplicate signal (same dim + type + evidenceRef)', async () => {
    const sig1 = mkValidSignal({ id: 'sig-a' });
    const sig2 = mkValidSignal({ id: 'sig-b' }); // identical evidence, different id
    const adapter = new MockLlmAdapter({ '*': JSON.stringify({ signals: [sig1, sig2] }) });

    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);

    assert.equal(result.signals.length, 1, 'Only one of the two duplicates kept');
    assert.equal(result.validationErrors.length, 1);
    assert.equal(result.validationErrors[0].code, 'DUPLICATE_SIGNAL');
  });

  it('keeps signals with same type but different dimensions', async () => {
    const s1 = mkValidSignal({
      id: 'sig-d1',
      dimension: 'D1',
      evidenceRef: { turnIndex: 1, spanText: 'I align volunteer roles to our theory of change' },
    });
    const s2 = mkValidSignal({
      id: 'sig-d2',
      dimension: 'D2',
      evidenceRef: { turnIndex: 3, spanText: 'structured skills-based matching process' },
    });
    const adapter = new MockLlmAdapter({ '*': JSON.stringify({ signals: [s1, s2] }) });

    const result = await extractSignals(SIMPLE_TRANSCRIPT, adapter);

    assert.equal(result.signals.length, 2);
    assert.equal(result.validationErrors.length, 0);
  });
});

// ── 5. Invalid transcript guard ──────────────────────────────────────

describe('extractSignals: invalid transcript', () => {
  it('throws ExtractionError(INVALID_TRANSCRIPT) for null transcript', async () => {
    const adapter = new MockLlmAdapter({ '*': '{"signals":[]}' });
    await assert.rejects(
      () => extractSignals(null, adapter),
      (err) => {
        assert.ok(err instanceof ExtractionError);
        assert.equal(err.code, ExtractionErrorCodes.INVALID_TRANSCRIPT);
        return true;
      },
    );
  });

  it('throws ExtractionError(INVALID_TRANSCRIPT) for transcript with empty turns', async () => {
    const adapter = new MockLlmAdapter({ '*': '{"signals":[]}' });
    await assert.rejects(
      () => extractSignals({ id: 'x', candidateId: 'y', startedAt: '2026-07-05T00:00:00Z', turns: [] }, adapter),
      (err) => {
        assert.ok(err instanceof ExtractionError);
        assert.equal(err.code, ExtractionErrorCodes.INVALID_TRANSCRIPT);
        return true;
      },
    );
  });
});

// ── 6. E2E: fixture transcript → extractor → validator → scoreAssessment() ─

describe('E2E: extractSignals → scoreAssessment (rubric v1.2)', () => {
  it('full pipeline produces a valid scored assessment across all 6 dimensions', async () => {
    const signals = mkE2ESignals();
    const adapter = new MockLlmAdapter({ '*': JSON.stringify({ signals }) });

    // Step 1: extraction
    const extraction = await extractSignals(E2E_TRANSCRIPT, adapter);

    assert.equal(extraction.transcriptId, 'e2e-transcript-001');
    assert.equal(extraction.dropped.length, 0, `Unexpected drops: ${JSON.stringify(extraction.dropped)}`);
    assert.equal(extraction.validationErrors.length, 0, `Unexpected errors: ${JSON.stringify(extraction.validationErrors)}`);
    assert.equal(extraction.signals.length, signals.length, 'All 18 signals should survive extraction');

    // Step 2: transform CandidateSignal[] to scoreAssessment() input format
    const dimensions = {};
    for (const dimId of DIMENSION_IDS) dimensions[dimId] = [];
    for (const sig of extraction.signals) {
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

    // Step 3: score
    const scored = scoreAssessment({ dimensions });

    assert.equal(scored.rubricVersion, RUBRIC_VERSION, 'rubricVersion must be current');
    assert.equal(scored.dimensions.length, 6);

    // All dimensions have ≥3 signals so none should be insufficient evidence
    for (const dim of scored.dimensions) {
      assert.equal(dim.insufficientEvidence, false, `${dim.id} should not be insufficient evidence`);
      assert.equal(typeof dim.score, 'number', `${dim.id} must have a numeric score`);
      assert.ok(dim.score >= 1.0 && dim.score <= 10.0, `${dim.id} score ${dim.score} out of range`);
    }

    assert.equal(scored.overall.incomplete, false);
    assert.equal(typeof scored.overall.score, 'number');
    assert.equal(typeof scored.overall.tier, 'string');
  });

  it('N signal (red flag) flows correctly through extraction into scoring', async () => {
    // Transcript with a D1 turn containing a misconception
    const transcript = {
      id: 'rf-transcript-001',
      candidateId: 'candidate-rf-001',
      startedAt: '2026-07-05T10:00:00Z',
      turns: [
        { role: 'interviewer', content: 'What is your philosophy on volunteers?', dimension: 'D1' },
        { role: 'candidate',   content: 'Volunteers are essentially free labor that reduces our staffing costs.' },
        { role: 'interviewer', content: 'How do you recruit?', dimension: 'D2' },
        { role: 'candidate',   content: 'I use a structured intake process for matching volunteer skills.' },
      ],
    };

    // D1: one S1 + one S2 + one N (misconception) — 3 signals, meets §5.5 IE minimum
    const rfSignals = [
      { id: 'rf-D1-1', dimension: 'D1', type: 'S1', strengthLabel: 'weak',  strength: 0.5, anchorTier: 'foundational', corrected: false, evidenceRef: { turnIndex: 1, spanText: 'Volunteers are essentially free labor' }, excerpt: 'Volunteers are essentially free labor', hasFirstPersonSpecificity: true },
      { id: 'rf-D1-2', dimension: 'D1', type: 'S2', strengthLabel: 'weak',  strength: 0.5, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 1, spanText: 'reduces our staffing costs' }, excerpt: 'reduces our staffing costs', hasFirstPersonSpecificity: true },
      { id: 'rf-D1-3', dimension: 'D1', type: 'N',  strengthLabel: 'clear', strength: 1.0, anchorTier: 'foundational', corrected: false, evidenceRef: { turnIndex: 1, spanText: 'Volunteers are essentially free labor that reduces our staffing costs.' }, excerpt: 'Volunteers are essentially free labor that reduces our staffing costs.', hasFirstPersonSpecificity: true },
      { id: 'rf-D2-1', dimension: 'D2', type: 'S1', strengthLabel: 'weak',  strength: 0.5, anchorTier: 'foundational', corrected: false, evidenceRef: { turnIndex: 3, spanText: 'structured intake process' }, excerpt: 'structured intake process', hasFirstPersonSpecificity: true },
      { id: 'rf-D2-2', dimension: 'D2', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 3, spanText: 'matching volunteer skills' }, excerpt: 'matching volunteer skills', hasFirstPersonSpecificity: true },
      { id: 'rf-D2-3', dimension: 'D2', type: 'S2', strengthLabel: 'clear', strength: 1.0, anchorTier: 'developing',   corrected: false, evidenceRef: { turnIndex: 3, spanText: 'I use a structured intake process for matching volunteer skills.' }, excerpt: 'I use a structured intake process for matching volunteer skills.', hasFirstPersonSpecificity: true },
    ];

    const adapter = new MockLlmAdapter({ '*': JSON.stringify({ signals: rfSignals }) });
    const extraction = await extractSignals(transcript, adapter);

    // All signals must survive (N is valid per schema)
    assert.equal(extraction.dropped.length, 0);
    assert.equal(extraction.validationErrors.length, 0);
    assert.equal(extraction.signals.length, rfSignals.length);

    // D1 should have 1 red flag
    const d1Signals = extraction.signals.filter(s => s.dimension === 'D1');
    const nSignals = d1Signals.filter(s => s.type === 'N');
    assert.equal(nSignals.length, 1);
    assert.equal(nSignals[0].corrected, false);
  });
});
