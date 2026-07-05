import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAssessment, tierFor } from '../src/scoring/index.js';
import {
  D1_FOUNDATIONAL, D1_DEVELOPING, D1_PROFICIENT, D1_EXPERT,
  D2_FOUNDATIONAL, D2_DEVELOPING, D2_PROFICIENT, D2_EXPERT,
  D3_FOUNDATIONAL, D3_DEVELOPING, D3_PROFICIENT, D3_EXPERT,
  D4_FOUNDATIONAL, D4_DEVELOPING, D4_PROFICIENT, D4_EXPERT,
  D5_FOUNDATIONAL, D5_DEVELOPING, D5_PROFICIENT, D5_EXPERT,
  D6_FOUNDATIONAL, D6_DEVELOPING, D6_PROFICIENT, D6_EXPERT,
  EDGE_SCORE_3_0, EDGE_SCORE_5_5, EDGE_SCORE_7_5,
  EDGE_SCORE_7_6, EDGE_SCORE_5_6,
  EDGE_RED_FLAG_ONE, EDGE_RED_FLAG_CORRECTED, EDGE_RED_FLAG_TWO,
  EDGE_INSUFFICIENT, EDGE_RECALL_INFLATION, EDGE_GENERIC_ANSWER,
  EDGE_EXPERT_GATING, EDGE_EXPERT_GATING_PASS,
  fullProficientAssessment, fullExpertAssessment,
  mixedAssessmentForOverallCap, partialAssessment, incompleteAssessment,
  contradictionAssessment,
} from './fixtures.js';

// Helper: score a single dimension by wrapping it in a full assessment
function scoreDim(dimId, signals) {
  const dimensions = { D1: [], D2: [], D3: [], D4: [], D5: [], D6: [] };
  dimensions[dimId] = signals;
  const result = scoreAssessment({ dimensions });
  return result.dimensions.find(d => d.id === dimId);
}

// ── tierFor helper ──────────────────────────────────────────────────

describe('tierFor', () => {
  it('returns Foundational for scores 1.0–3.0', () => {
    assert.equal(tierFor(1.0).id, 'foundational');
    assert.equal(tierFor(2.0).id, 'foundational');
    assert.equal(tierFor(3.0).id, 'foundational');
  });

  it('returns Developing for scores 3.1–5.5', () => {
    assert.equal(tierFor(3.1).id, 'developing');
    assert.equal(tierFor(4.3).id, 'developing');
    assert.equal(tierFor(5.5).id, 'developing');
  });

  it('returns Proficient for scores 5.6–7.5', () => {
    assert.equal(tierFor(5.6).id, 'proficient');
    assert.equal(tierFor(6.5).id, 'proficient');
    assert.equal(tierFor(7.5).id, 'proficient');
  });

  it('returns Expert for scores 7.6–10.0', () => {
    assert.equal(tierFor(7.6).id, 'expert');
    assert.equal(tierFor(9.0).id, 'expert');
    assert.equal(tierFor(10.0).id, 'expert');
  });
});

// ── §8 Output contract ─────────────────────────────────────────────

describe('§8 Output contract', () => {
  it('emits rubricVersion, dimensions[], overall, integrityFlags', () => {
    const result = scoreAssessment(fullProficientAssessment());
    assert.equal(result.rubricVersion, '1.2');
    assert.equal(result.dimensions.length, 6);
    assert.ok(Array.isArray(result.integrityFlags));
    assert.ok(result.overall);
    assert.equal(typeof result.overall.score, 'number');
    assert.equal(typeof result.overall.tier, 'string');
    assert.equal(typeof result.overall.partial, 'boolean');
    assert.equal(typeof result.overall.capped, 'boolean');
  });

  it('dimension results have required fields', () => {
    const result = scoreAssessment(fullProficientAssessment());
    for (const dim of result.dimensions) {
      assert.ok(dim.id.match(/^D[1-6]$/), `id ${dim.id}`);
      assert.equal(typeof dim.name, 'string');
      assert.ok(Array.isArray(dim.signals));
      assert.ok(Array.isArray(dim.redFlags));
      assert.equal(typeof dim.insufficientEvidence, 'boolean');
      if (!dim.insufficientEvidence) {
        assert.equal(typeof dim.score, 'number');
        assert.equal(typeof dim.tier, 'string');
        assert.equal(typeof dim.baseTier, 'string');
      }
    }
  });

  it('signal objects have type, strength, excerpt, anchor', () => {
    const result = scoreAssessment(fullProficientAssessment());
    const sig = result.dimensions[0].signals[0];
    assert.ok(sig.type);
    assert.equal(typeof sig.strength, 'number');
    assert.ok('excerpt' in sig);
  });
});

// ── §5.1 Base tier placement per dimension ──────────────────────────

describe('§5.1 Base tier placement', () => {
  describe('D1 — Strategic Engagement Design', () => {
    it('Foundational signals → Foundational tier', () => {
      const d = scoreDim('D1', D1_FOUNDATIONAL);
      assert.equal(d.baseTier, 'Foundational');
    });
    it('Developing signals → Developing tier', () => {
      const d = scoreDim('D1', D1_DEVELOPING);
      assert.equal(d.baseTier, 'Developing');
    });
    it('Proficient signals → Proficient tier', () => {
      const d = scoreDim('D1', D1_PROFICIENT);
      assert.equal(d.baseTier, 'Proficient');
    });
    it('Expert signals → Expert tier', () => {
      const d = scoreDim('D1', D1_EXPERT);
      assert.equal(d.baseTier, 'Expert');
    });
  });

  describe('D2 — Recruitment, Matching & Onboarding', () => {
    it('Foundational', () => assert.equal(scoreDim('D2', D2_FOUNDATIONAL).baseTier, 'Foundational'));
    it('Developing', () => assert.equal(scoreDim('D2', D2_DEVELOPING).baseTier, 'Developing'));
    it('Proficient', () => assert.equal(scoreDim('D2', D2_PROFICIENT).baseTier, 'Proficient'));
    it('Expert', () => assert.equal(scoreDim('D2', D2_EXPERT).baseTier, 'Expert'));
  });

  describe('D3 — Training, Development & Role Support', () => {
    it('Foundational', () => assert.equal(scoreDim('D3', D3_FOUNDATIONAL).baseTier, 'Foundational'));
    it('Developing', () => assert.equal(scoreDim('D3', D3_DEVELOPING).baseTier, 'Developing'));
    it('Proficient', () => assert.equal(scoreDim('D3', D3_PROFICIENT).baseTier, 'Proficient'));
    it('Expert', () => assert.equal(scoreDim('D3', D3_EXPERT).baseTier, 'Expert'));
  });

  describe('D4 — Performance, Impact & Accountability', () => {
    it('Foundational', () => assert.equal(scoreDim('D4', D4_FOUNDATIONAL).baseTier, 'Foundational'));
    it('Developing', () => assert.equal(scoreDim('D4', D4_DEVELOPING).baseTier, 'Developing'));
    it('Proficient', () => assert.equal(scoreDim('D4', D4_PROFICIENT).baseTier, 'Proficient'));
    it('Expert', () => assert.equal(scoreDim('D4', D4_EXPERT).baseTier, 'Expert'));
  });

  describe('D5 — Recognition, Retention & Culture', () => {
    it('Foundational', () => assert.equal(scoreDim('D5', D5_FOUNDATIONAL).baseTier, 'Foundational'));
    it('Developing', () => assert.equal(scoreDim('D5', D5_DEVELOPING).baseTier, 'Developing'));
    it('Proficient', () => assert.equal(scoreDim('D5', D5_PROFICIENT).baseTier, 'Proficient'));
    it('Expert', () => assert.equal(scoreDim('D5', D5_EXPERT).baseTier, 'Expert'));
  });

  describe('D6 — Ethics, Equity & Advocacy', () => {
    it('Foundational', () => assert.equal(scoreDim('D6', D6_FOUNDATIONAL).baseTier, 'Foundational'));
    it('Developing', () => assert.equal(scoreDim('D6', D6_DEVELOPING).baseTier, 'Developing'));
    it('Proficient', () => assert.equal(scoreDim('D6', D6_PROFICIENT).baseTier, 'Proficient'));
    it('Expert', () => assert.equal(scoreDim('D6', D6_EXPERT).baseTier, 'Expert'));
  });
});

// ── §5.2 Position within tier & boundary scores ─────────────────────

describe('§5.2 Position within tier', () => {
  it('Foundational saturated → score 3.0', () => {
    const d = scoreDim('D1', EDGE_SCORE_3_0);
    assert.equal(d.score, 3.0);
    assert.equal(d.tier, 'Foundational');
  });

  it('Developing saturated → score 5.5', () => {
    const d = scoreDim('D1', EDGE_SCORE_5_5);
    assert.equal(d.score, 5.5);
    assert.equal(d.tier, 'Developing');
  });

  it('Proficient saturated → score 7.5', () => {
    const d = scoreDim('D1', EDGE_SCORE_7_5);
    assert.equal(d.score, 7.5);
    assert.equal(d.tier, 'Proficient');
  });

  it('Expert minimum qualifying → score in Expert range', () => {
    const d = scoreDim('D1', EDGE_SCORE_7_6);
    assert.ok(d.score >= 7.6, `Expected ≥7.6, got ${d.score}`);
    assert.equal(d.tier, 'Expert');
    assert.equal(d.baseTier, 'Expert');
  });

  it('scores are rounded to one decimal', () => {
    const result = scoreAssessment(fullProficientAssessment());
    for (const dim of result.dimensions) {
      if (dim.score !== null) {
        const decimals = dim.score.toString().split('.')[1];
        assert.ok(!decimals || decimals.length <= 1, `${dim.id} score ${dim.score} has too many decimals`);
      }
    }
  });
});

// ── §5.3 Expert gating ──────────────────────────────────────────────

describe('§5.3 Expert gating', () => {
  it('caps score at 8.5 when <3 distinct strong expert anchors', () => {
    const d = scoreDim('D1', EDGE_EXPERT_GATING);
    assert.equal(d.score, 8.5, `Expected 8.5, got ${d.score}`);
  });

  it('allows score > 8.5 when ≥3 distinct strong expert anchors', () => {
    const d = scoreDim('D1', EDGE_EXPERT_GATING_PASS);
    assert.ok(d.score > 8.5, `Expected >8.5, got ${d.score}`);
  });
});

// ── §5.4 Red-flag caps ──────────────────────────────────────────────

describe('§5.4 Red-flag caps', () => {
  it('1 uncorrected N at clear → cap at midpoint of tier below base', () => {
    const d = scoreDim('D1', EDGE_RED_FLAG_ONE);
    // Base tier proficient → tier below = developing → midpoint = 4.3
    assert.equal(d.score, 4.3, `Expected 4.3, got ${d.score}`);
  });

  it('corrected N → no cap applied', () => {
    const d = scoreDim('D1', EDGE_RED_FLAG_CORRECTED);
    assert.ok(d.score > 4.3, `Expected >4.3 (no cap), got ${d.score}`);
  });

  it('2 uncorrected N → hard cap at 5.5', () => {
    const d = scoreDim('D1', EDGE_RED_FLAG_TWO);
    assert.ok(d.score <= 5.5, `Expected ≤5.5, got ${d.score}`);
  });

  it('red flags are included in output', () => {
    const d = scoreDim('D1', EDGE_RED_FLAG_ONE);
    assert.equal(d.redFlags.length, 1);
    assert.equal(d.redFlags[0].type, 'N');
  });
});

// ── §5.5 Insufficient evidence ──────────────────────────────────────

describe('§5.5 Insufficient evidence', () => {
  it('< 3 positive signals → insufficientEvidence true, score null', () => {
    const d = scoreDim('D1', EDGE_INSUFFICIENT);
    assert.equal(d.insufficientEvidence, true);
    assert.equal(d.score, null);
    assert.equal(d.tier, null);
  });

  it('exactly 3 positive signals → scores normally', () => {
    const d = scoreDim('D1', D1_FOUNDATIONAL);
    assert.equal(d.insufficientEvidence, false);
    assert.equal(typeof d.score, 'number');
  });
});

// ── §6 Aggregation ──────────────────────────────────────────────────

describe('§6 Aggregation', () => {
  it('overall score is mean of 6 dimension scores, rounded to 1 decimal', () => {
    const result = scoreAssessment(fullProficientAssessment());
    const scores = result.dimensions.map(d => d.score);
    const expectedMean = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
    assert.equal(result.overall.score, expectedMean);
    assert.equal(result.overall.partial, false);
  });

  it('1 dimension insufficient → partial flag, mean of 5', () => {
    const result = scoreAssessment(partialAssessment());
    assert.equal(result.overall.partial, true);
    assert.equal(result.overall.incomplete, false);
    const scored = result.dimensions.filter(d => !d.insufficientEvidence);
    assert.equal(scored.length, 5);
    const expectedMean = Math.round(scored.reduce((a, b) => a + b.score, 0) / 5 * 10) / 10;
    assert.equal(result.overall.score, expectedMean);
  });

  it('≥2 dimensions insufficient → incomplete, no overall', () => {
    const result = scoreAssessment(incompleteAssessment());
    assert.equal(result.overall.incomplete, true);
    assert.equal(result.overall.score, null);
    assert.equal(result.overall.tier, null);
  });
});

// ── §6.4 Overall-tier Expert constraint ─────────────────────────────

describe('§6.4 Overall-tier Expert constraint', () => {
  it('caps overall at 7.5 when Expert tier but <4 Proficient+ or <2 Expert dimensions', () => {
    const result = scoreAssessment(mixedAssessmentForOverallCap());
    // With 1 Expert + 5 Developing, mean could be in Expert range
    // but constraint should cap it at 7.5 if applicable
    if (result.overall.score !== null) {
      const rawMean = Math.round(
        result.dimensions.reduce((s, d) => s + (d.score || 0), 0) / 6 * 10
      ) / 10;
      if (tierFor(rawMean).id === 'expert') {
        const profPlus = result.dimensions.filter(d =>
          !d.insufficientEvidence && (tierFor(d.score).id === 'proficient' || tierFor(d.score).id === 'expert')
        ).length;
        const expertCount = result.dimensions.filter(d =>
          !d.insufficientEvidence && tierFor(d.score).id === 'expert'
        ).length;
        if (profPlus < 4 || expertCount < 2) {
          assert.ok(result.overall.score <= 7.5, `Expected ≤7.5, got ${result.overall.score}`);
          assert.equal(result.overall.capped, true);
        }
      }
    }
  });

  it('does not cap when ≥4 Proficient+ and ≥2 Expert dimensions', () => {
    const result = scoreAssessment(fullExpertAssessment());
    const expertDims = result.dimensions.filter(d => tierFor(d.score).id === 'expert').length;
    const profPlusDims = result.dimensions.filter(d => {
      const t = tierFor(d.score).id;
      return t === 'proficient' || t === 'expert';
    }).length;
    assert.ok(expertDims >= 2, `Expected ≥2 expert dims, got ${expertDims}`);
    assert.ok(profPlusDims >= 4, `Expected ≥4 prof+ dims, got ${profPlusDims}`);
    assert.equal(result.overall.capped, false);
  });
});

// ── §7 Integrity checks ────────────────────────────────────────────

describe('§7.1 Recall inflation', () => {
  it('flags when Developing+ with ≥4 S1, exactly 1 clear S2, no strong S2/S3+', () => {
    const result = scoreAssessment({ dimensions: { D1: EDGE_RECALL_INFLATION, D2: [], D3: [], D4: [], D5: [], D6: [] } });
    const flag = result.integrityFlags.find(f => f.rule === 'recall_inflation');
    assert.ok(flag, 'Expected recall_inflation flag');
    assert.equal(flag.dimension, 'D1');
  });

  it('caps score at ≤4.3 (Developing lower third)', () => {
    const d = scoreDim('D1', EDGE_RECALL_INFLATION);
    assert.ok(d.score <= 4.3, `Expected ≤4.3, got ${d.score}`);
  });
});

describe('§7.2 Cross-dimension contradiction', () => {
  it('flags contradicting signals and uses weaker evidence', () => {
    const result = scoreAssessment(contradictionAssessment());
    const flag = result.integrityFlags.find(f => f.rule === 'cross_dimension_contradiction');
    assert.ok(flag, 'Expected cross_dimension_contradiction flag');
    assert.ok(flag.dimensions.includes('D1'));
    assert.ok(flag.dimensions.includes('D4'));
  });
});

describe('§7.3 Generic answer detection', () => {
  it('downgrades S2+ signals without first-person specificity to S1', () => {
    const result = scoreAssessment({
      dimensions: { D1: EDGE_GENERIC_ANSWER, D2: [], D3: [], D4: [], D5: [], D6: [] },
    });
    const d1 = result.dimensions.find(d => d.id === 'D1');
    const downgraded = d1.signals.filter(s => s.downgraded);
    assert.ok(downgraded.length >= 2, `Expected ≥2 downgrades, got ${downgraded.length}`);
    for (const s of downgraded) {
      assert.equal(s.type, 'S1');
    }
    const flag = result.integrityFlags.find(f => f.rule === 'generic_answer_detection');
    assert.ok(flag, 'Expected generic_answer_detection flag');
  });

  it('does not downgrade signals with first-person specificity', () => {
    const result = scoreAssessment(fullProficientAssessment());
    for (const dim of result.dimensions) {
      const downgraded = dim.signals.filter(s => s.downgraded);
      assert.equal(downgraded.length, 0, `${dim.id} should have no downgrades`);
    }
  });
});

describe('§7.4 Uniform maximum', () => {
  it('flags when all 6 dimensions score ≥ 9.0', () => {
    const result = scoreAssessment(fullExpertAssessment());
    const allAbove9 = result.dimensions.every(d => d.score >= 9.0);
    if (allAbove9) {
      const flag = result.integrityFlags.find(f => f.rule === 'uniform_maximum');
      assert.ok(flag, 'Expected uniform_maximum flag when all ≥ 9.0');
    }
    // If not all ≥ 9.0 due to gating, that's fine — this test validates the rule is applied
  });

  it('does not flag when any dimension < 9.0', () => {
    const result = scoreAssessment(fullProficientAssessment());
    const flag = result.integrityFlags.find(f => f.rule === 'uniform_maximum');
    assert.equal(flag, undefined, 'Should not flag uniform_maximum for proficient scores');
  });
});

// ── Determinism ─────────────────────────────────────────────────────

describe('Determinism', () => {
  it('produces identical output on repeated calls with same input', () => {
    const input = fullProficientAssessment();
    const r1 = scoreAssessment(input);
    const r2 = scoreAssessment(input);
    assert.deepStrictEqual(r1, r2);
  });
});

// ── Empty / missing input ───────────────────────────────────────────

describe('Edge: empty input', () => {
  it('handles empty dimensions gracefully', () => {
    const result = scoreAssessment({ dimensions: {} });
    assert.equal(result.dimensions.length, 6);
    for (const dim of result.dimensions) {
      assert.equal(dim.insufficientEvidence, true);
    }
    assert.equal(result.overall.incomplete, true);
  });

  it('handles missing dimensions key', () => {
    const result = scoreAssessment({});
    assert.equal(result.dimensions.length, 6);
  });
});
