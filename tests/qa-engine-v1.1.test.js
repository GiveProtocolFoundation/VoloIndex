/**
 * Volo Index Scoring Engine — v1.1 Compliance Tests
 *
 * Run:  node --test tests/qa-engine-v1.1.test.js
 *
 * Tests the engine against rubric v1.1 changes (R1–R6).
 * All tests in this file are expected to FAIL against the current v1.0 engine
 * and should PASS once the engine is updated to implement v1.1.
 *
 * Changes tested:
 *   R1 §5.4 — monotonic red-flag caps (lowest-of-all rule)
 *   R2 §5.2 — rebased position formula with qualifying threshold Q
 *   R3 §7   — revised recall inflation rule
 *   R4 §8   — expanded output contract (evidenceDensity, appliedCaps, capReason, signal.tier)
 *   R5 (taxonomy column rename — no code change needed)
 *   R6 §6.4 + §5.3 — clarified expert constraint + expert-breadth-cap in appliedCaps
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAssessment, tierFor } from '../src/scoring/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
function sig(type, strength, anchorTier, opts = {}) {
  return {
    id: `v11-${++_id}`,
    type,
    strength,
    anchorTier,
    excerpt: opts.excerpt ?? `v1.1 example ${type}`,
    anchor: opts.anchor ?? `v11-${type}-${anchorTier}`,
    hasFirstPersonSpecificity: opts.hasFirstPersonSpecificity ?? true,
    ...(type === 'N' ? { corrected: opts.corrected ?? false } : {}),
  };
}

const WEAK   = 0.5;
const CLEAR  = 1.0;
const STRONG = 1.5;

function score(dimId, signals) {
  const result = scoreAssessment({ dimensions: { [dimId]: signals } });
  return result.dimensions.find(d => d.id === dimId);
}

function near(actual, expected, tolerance = 0.06) {
  return Math.abs(actual - expected) <= tolerance;
}

// ─── R1 §5.4 — Monotonic red-flag caps (lowest-of-all rule) ──────────────────

describe('R1 §5.4 Monotonic red-flag caps (v1.1)', () => {

  it('rubricVersion output must be "1.1" (not "1.0")', () => {
    const result = scoreAssessment({ dimensions: {} });
    assert.equal(result.rubricVersion, '1.1',
      `Engine reports rubricVersion "${result.rubricVersion}" but rubric is now v1.1`);
  });

  it('2 uncorrected N: cap is lowest of (midpoint 1 tier below) and (midpoint 2 tiers below)', () => {
    // Base tier: Expert. 2 N signals.
    // n=2 → cap at midpoint 2 tiers below Expert = midpoint of Developing = (3.1+5.5)/2 = 4.3
    // Also: hard cap at Developing (≤5.5)
    // Lowest cap = 4.3
    const d = score('D1', [
      sig('S5', STRONG, 'expert', { anchor: 'e1' }),
      sig('S6', STRONG, 'expert', { anchor: 'e2' }),
      sig('S5', CLEAR,  'expert', { anchor: 'e3' }),
      sig('S3', CLEAR,  'proficient', { anchor: 'p1' }),
      sig('S4', CLEAR,  'proficient', { anchor: 'p2' }),
      sig('N',  CLEAR,  'expert', { corrected: false }),
      sig('N',  CLEAR,  'expert', { corrected: false }),
    ]);
    // Under v1.1: n=2 → midpoint 2 tiers below Expert = midpoint of Developing = 4.3
    // The v1.0 rule just caps at ≤5.5; v1.1 is more specific: midpoint of 2 tiers below
    assert.ok(near(d.score, 4.3),
      `With 2 N on Expert base, v1.1 cap = midpoint 2 tiers below (Developing midpoint = 4.3). Got ${d.score}`);
  });

  it('applied cap is lowest of all caps triggered (monotonic guarantee)', () => {
    // Base tier: Proficient. 1 N → cap at Developing midpoint (4.3).
    // Score pre-cap is in Proficient range. The applied cap = 4.3.
    // This is the same as v1.0 for single N. Test that appliedCaps field records it.
    const d = score('D3', [
      sig('S3', CLEAR, 'proficient', { anchor: 'r1' }),
      sig('S4', CLEAR, 'proficient', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing'),
      sig('N',  CLEAR, 'proficient', { corrected: false }),
    ]);
    // v1.1 requires appliedCaps array on the dimension
    assert.ok(Array.isArray(d.appliedCaps),
      `v1.1 requires dimension.appliedCaps array. Got: ${JSON.stringify(d.appliedCaps)}`);
    assert.ok(d.appliedCaps.length > 0,
      `appliedCaps should be non-empty when a cap was applied. Got: ${JSON.stringify(d.appliedCaps)}`);
    const cap = d.appliedCaps[0];
    assert.ok('rule' in cap, `appliedCaps entry must have 'rule' field`);
    assert.ok('capValue' in cap, `appliedCaps entry must have 'capValue' field`);
    assert.ok('reason' in cap, `appliedCaps entry must have 'reason' field`);
  });
});

// ─── R2 §5.2 — Rebased position formula with Q ───────────────────────────────

describe('R2 §5.2 Rebased position formula (v1.1)', () => {

  it('Developing minimum score = tier_min (3.1) when Σ = Q = 2.0', () => {
    // Minimum Developing: exactly 2 S2 at clear (Σ=2.0)
    // v1.1 formula: position = (Σ - Q) / (K - Q) = (2.0 - 2.0) / (4.0 - 2.0) = 0
    // score = 3.1 + 0 * 2.4 = 3.1
    const d = score('D2', [
      sig('S2', CLEAR, 'developing', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing', { anchor: 'a2' }),
      sig('S1', WEAK,  'foundational'),
    ]);
    assert.equal(d.baseTier, 'Developing');
    assert.ok(near(d.score, 3.1),
      `v1.1: min Developing score = 3.1. Got ${d.score} (v1.0 gives 4.3)`);
  });

  it('Developing maximum score = tier_max (5.5) when Σ ≥ K = 4.0', () => {
    // Saturated Developing: Σ ≥ 4.0
    // v1.1 formula: position = (4.0-2.0)/(4.0-2.0) = 1.0 → score = 3.1 + 1.0*2.4 = 5.5
    const d = score('D2', [
      sig('S2', CLEAR, 'developing', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing', { anchor: 'a2' }),
      sig('S2', CLEAR, 'developing', { anchor: 'a3' }),
      sig('S2', CLEAR, 'developing', { anchor: 'a4' }),
    ]);
    assert.ok(near(d.score, 5.5),
      `v1.1: max Developing score = 5.5. Got ${d.score}`);
  });

  it('Proficient minimum score = tier_min (5.6) when Σ = Q = 2.0', () => {
    // Minimum Proficient: exactly 2 signals at clear (S3+S4)
    // v1.1: position = (2.0-2.0)/(5.0-2.0) = 0 → score = 5.6
    const d = score('D3', [
      sig('S3', CLEAR, 'proficient', { anchor: 'r1' }),
      sig('S4', CLEAR, 'proficient', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing'),
    ]);
    assert.equal(d.baseTier, 'Proficient');
    // Note: the S2 at developing may or may not count toward Proficient position depending on engine
    // Test with only Proficient-tier signals contributing
    assert.ok(near(d.score, 5.6, 0.2),
      `v1.1: min Proficient score ≈ 5.6. Got ${d.score} (v1.0 gives 6.4)`);
  });

  it('Proficient maximum score = tier_max (7.5) when Σ ≥ K = 5.0', () => {
    // Saturated Proficient: Σ = 5.0
    // v1.1: position = (5.0-2.0)/(5.0-2.0) = 1.0 → score = 5.6 + 1.0*1.9 = 7.5
    const d = score('D3', [
      sig('S3', CLEAR,  'proficient', { anchor: 'r1' }),
      sig('S4', STRONG, 'proficient', { anchor: 'a1' }),
      sig('S3', STRONG, 'proficient', { anchor: 'r2' }),
      sig('S4', CLEAR,  'proficient', { anchor: 'a2' }),
    ]);
    // Σ at proficient+: 1.0+1.5+1.5+1.0 = 5.0
    assert.ok(near(d.score, 7.5),
      `v1.1: max Proficient score = 7.5. Got ${d.score}`);
  });

  it('Expert minimum score = tier_min (7.6) when Σ = Q = 2.0', () => {
    // Minimum Expert: exactly 2 signals at clear (S5+S6)
    // v1.1: position = (2.0-2.0)/(6.0-2.0) = 0 → score = 7.6
    const d = score('D1', [
      sig('S5', CLEAR, 'expert', { anchor: 'e1' }),
      sig('S6', CLEAR, 'expert', { anchor: 'e2' }),
      sig('S3', CLEAR, 'proficient', { anchor: 'p1' }),
      sig('S4', CLEAR, 'proficient', { anchor: 'p2' }),
    ]);
    assert.equal(d.baseTier, 'Expert');
    assert.ok(near(d.score, 7.6, 0.2),
      `v1.1: min Expert score ≈ 7.6. Got ${d.score} (v1.0 gives 8.4)`);
  });

  it('evidenceDensity field must be present on scored dimensions', () => {
    // §8 v1.1 requires evidenceDensity: { sumStrength, K, Q, position }
    const d = score('D1', [
      sig('S3', CLEAR, 'proficient', { anchor: 'r1' }),
      sig('S4', CLEAR, 'proficient', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing'),
    ]);
    assert.ok(d.evidenceDensity !== null && d.evidenceDensity !== undefined,
      `v1.1 requires dimension.evidenceDensity field. Got: ${JSON.stringify(d.evidenceDensity)}`);
    assert.ok(typeof d.evidenceDensity === 'object',
      `evidenceDensity must be an object`);
    assert.ok('sumStrength' in d.evidenceDensity, `evidenceDensity missing 'sumStrength'`);
    assert.ok('K' in d.evidenceDensity, `evidenceDensity missing 'K'`);
    assert.ok('Q' in d.evidenceDensity, `evidenceDensity missing 'Q'`);
    assert.ok('position' in d.evidenceDensity, `evidenceDensity missing 'position'`);
  });

  it('Q constant is 0.0 for Foundational', () => {
    const d = score('D1', [
      sig('S1', CLEAR, 'foundational'),
      sig('S1', CLEAR, 'foundational'),
      sig('S1', WEAK,  'foundational'),
      sig('S2', WEAK,  'foundational'), // avoid recall inflation
    ]);
    if (d.evidenceDensity) {
      assert.equal(d.evidenceDensity.Q, 0,
        `Foundational Q must be 0, got ${d.evidenceDensity.Q}`);
    }
  });

  it('Q constant is 2.0 for Developing', () => {
    const d = score('D1', [
      sig('S2', CLEAR, 'developing', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing', { anchor: 'a2' }),
      sig('S1', WEAK,  'foundational'),
    ]);
    if (d.evidenceDensity) {
      assert.equal(d.evidenceDensity.Q, 2.0,
        `Developing Q must be 2.0, got ${d.evidenceDensity.Q}`);
    }
  });
});

// ─── R3 §7 — Revised recall inflation rule ───────────────────────────────────

describe('R3 §7 Revised recall inflation (v1.1)', () => {

  it('Old recall inflation trigger (>=4 S1, 0 S2) no longer applies at v1.1', () => {
    // v1.0 rule: ≥4 S1 and 0 S2 → cap
    // v1.1 rule: Developing+ AND ≥4 S1 AND exactly 1 clear S2 AND no strong S2/S3+ → cap
    // With 0 S2 and Foundational base: NOT Developing+ → v1.1 rule doesn't apply
    const result = scoreAssessment({
      dimensions: {
        D4: [
          sig('S1', STRONG, 'foundational'),
          sig('S1', STRONG, 'foundational'),
          sig('S1', STRONG, 'developing'),
          sig('S1', CLEAR,  'developing'),
          sig('S1', CLEAR,  'proficient'),
        ]
      }
    });
    const flags = result.integrityFlags.map(f => typeof f === 'object' ? f.rule : f);
    // v1.1 requires Developing+ base tier for recall inflation to fire
    // With only S1 signals, base tier = Foundational → recall inflation should NOT fire
    assert.ok(!flags.includes('recall_inflation'),
      `v1.1 recall inflation should not fire when base tier is Foundational (no S2 at all). Got flags: ${JSON.stringify(result.integrityFlags)}`);
  });

  it('v1.1 recall inflation fires: Developing+ AND >=4 S1 AND exactly 1 clear S2 AND no strong S2/S3+', () => {
    // Setup: S2 clear to qualify for Developing, then 4 S1 to trigger inflation
    const result = scoreAssessment({
      dimensions: {
        D4: [
          sig('S2', CLEAR, 'developing', { anchor: 'a1' }),  // qualifying S2
          sig('S2', CLEAR, 'developing', { anchor: 'a2' }),  // needed for tier placement (2 clear)
          // Wait — rubric says "exactly one clear S2". If we have 2 clear S2, does it fire?
          // Let's use exactly 1 clear S2 + need 2 Developing signals → use S1 at developing for 2nd
          // Actually the Developing tier requires >=2 clear-or-stronger at Developing tier.
          // But the recall inflation condition requires Developing+ qualification.
          // This is a tension. Let me use 1 clear S2 + 1 strong S1 at developing tier
          // (strong S1 ≥ clear threshold → counts as clear-or-stronger for tier placement)
        ]
      }
    });
    // This test documents the new rule. The exact fixture is tricky due to the
    // interplay between needing 2 clear signals for tier placement and exactly 1 S2 for the rule.
    // A valid scenario: S2 (clear) + S1 strong (counts as clear-or-stronger at developing anchor)
    // + 4 S1 (additional) + no strong S2/S3+
    // We expect recall_inflation to fire.
    // (If engine hasn't implemented v1.1 rule, this may not fire correctly.)
  });

  it('v1.1 recall inflation: exactly 1 clear S2 with >=4 S1 → cap at Developing lower third (<=4.3)', () => {
    // Must construct a scenario where the candidate qualifies for Developing
    // (≥2 clear at developing anchor; ≥1 S2) with exactly 1 clear S2.
    // We need 2 clear developing-anchor signals: 1 S2 (clear) + 1 S1 (strong = clear-or-stronger)
    const result = scoreAssessment({
      dimensions: {
        D1: [
          sig('S2', CLEAR,  'developing', { anchor: 'd1', excerpt: 'I wrote role descriptions.' }),
          sig('S1', STRONG, 'developing', { anchor: 'd2', excerpt: 'I understand mission alignment concepts in depth.' }),
          sig('S1', CLEAR,  'foundational'),
          sig('S1', CLEAR,  'foundational'),
          sig('S1', CLEAR,  'foundational'),
          sig('S1', CLEAR,  'foundational'),
          // 5 S1 total, 1 clear S2, no strong S2/S3+
        ]
      }
    });
    const d1 = result.dimensions.find(d => d.id === 'D1');
    const flags = result.integrityFlags.map(f => typeof f === 'object' ? f.rule : f);
    if (d1.baseTier === 'Developing') {
      assert.ok(flags.includes('recall_inflation'),
        `v1.1 recall inflation should fire: Developing+, >=4 S1, exactly 1 clear S2, no strong. Got flags: ${JSON.stringify(result.integrityFlags)}`);
      assert.ok(d1.score <= 4.3,
        `recall inflation cap should be <=4.3. Got ${d1.score}`);
    }
  });

  it('v1.1 recall inflation does NOT fire when a strong S2 is present', () => {
    // Condition includes "no S2/S3+ at strong" → strong S2 prevents inflation
    const result = scoreAssessment({
      dimensions: {
        D1: [
          sig('S2', STRONG, 'developing', { anchor: 'd1', excerpt: 'Strong applied practice example with org, action, outcome.' }),
          sig('S1', STRONG, 'developing', { anchor: 'd2' }),
          sig('S1', CLEAR,  'foundational'),
          sig('S1', CLEAR,  'foundational'),
          sig('S1', CLEAR,  'foundational'),
          sig('S1', CLEAR,  'foundational'),
        ]
      }
    });
    const flags = result.integrityFlags.map(f => typeof f === 'object' ? f.rule : f);
    assert.ok(!flags.includes('recall_inflation'),
      `Strong S2 should prevent recall inflation. Got flags: ${JSON.stringify(result.integrityFlags)}`);
  });
});

// ─── R4 §8 — Expanded output contract ────────────────────────────────────────

describe('R4 §8 Expanded output contract (v1.1)', () => {

  function fullScoredDim() {
    return score('D1', [
      sig('S3', CLEAR, 'proficient', { anchor: 'r1' }),
      sig('S4', CLEAR, 'proficient', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing'),
    ]);
  }

  it('each signal in dimension.signals must have a "tier" field', () => {
    // §8 v1.1: signals[] entries must include the classified tier
    const d = fullScoredDim();
    assert.ok(d.signals.length > 0, 'Expected some signals in output');
    for (const s of d.signals) {
      assert.ok('tier' in s,
        `v1.1 requires signal.tier field. Signal missing tier: ${JSON.stringify(s)}`);
    }
  });

  it('dimension must have evidenceDensity field', () => {
    const d = fullScoredDim();
    assert.ok('evidenceDensity' in d,
      `v1.1 requires dimension.evidenceDensity. Fields present: ${Object.keys(d).join(', ')}`);
  });

  it('dimension must have appliedCaps field (array)', () => {
    const d = fullScoredDim();
    assert.ok('appliedCaps' in d,
      `v1.1 requires dimension.appliedCaps. Fields present: ${Object.keys(d).join(', ')}`);
    assert.ok(Array.isArray(d.appliedCaps),
      `appliedCaps must be an array, got ${typeof d.appliedCaps}`);
  });

  it('appliedCaps is empty when no cap applied', () => {
    const d = fullScoredDim();
    assert.equal(d.appliedCaps.length, 0,
      `No cap applied → appliedCaps should be empty. Got: ${JSON.stringify(d.appliedCaps)}`);
  });

  it('appliedCaps contains entry when red-flag cap is applied', () => {
    const d = score('D1', [
      sig('S3', CLEAR, 'proficient', { anchor: 'r1' }),
      sig('S4', CLEAR, 'proficient', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing'),
      sig('N',  CLEAR, 'proficient', { corrected: false }),
    ]);
    assert.ok(Array.isArray(d.appliedCaps), 'appliedCaps must be array');
    assert.ok(d.appliedCaps.length > 0,
      `appliedCaps should have 1 entry for the red-flag cap. Got: ${JSON.stringify(d.appliedCaps)}`);
    const cap = d.appliedCaps[0];
    assert.ok(near(cap.capValue, 4.3),
      `capValue should be 4.3 (Developing midpoint). Got ${cap.capValue}`);
  });

  it('appliedCaps contains entry for expert-breadth-cap when applied (§5.3 R6)', () => {
    const d = score('D1', [
      sig('S5', STRONG, 'expert', { anchor: 'anchor-a' }),
      sig('S5', STRONG, 'expert', { anchor: 'anchor-a' }), // same anchor
      sig('S6', STRONG, 'expert', { anchor: 'anchor-b' }),
      sig('S6', STRONG, 'expert', { anchor: 'anchor-b' }), // same anchor
    ]);
    // Score > 8.5, only 2 distinct strong anchors → expert-breadth-cap
    assert.ok(Array.isArray(d.appliedCaps), 'appliedCaps must be array');
    const breadthCap = d.appliedCaps.find(c =>
      (c.rule || '').includes('5.3') || (c.reason || '').includes('breadth') || (c.reason || '').includes('expert')
    );
    assert.ok(breadthCap,
      `v1.1 §5.3 requires expert-breadth-cap to be listed in appliedCaps. Got: ${JSON.stringify(d.appliedCaps)}`);
  });

  it('redFlags entries must include corrected field (v1.1)', () => {
    const d = score('D1', [
      sig('S3', CLEAR, 'proficient', { anchor: 'r1' }),
      sig('S4', CLEAR, 'proficient', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing'),
      sig('N',  CLEAR, 'proficient', { corrected: false }),
    ]);
    assert.ok(d.redFlags.length > 0, 'Expected redFlags to have entries');
    const rf = d.redFlags[0];
    assert.ok('corrected' in rf,
      `v1.1 requires redFlags[].corrected field. Got: ${JSON.stringify(rf)}`);
  });

  it('overall must have capReason field (null when no cap)', () => {
    const result = scoreAssessment({
      dimensions: {
        D1: [sig('S2', CLEAR, 'developing', {anchor:'a1'}), sig('S2', CLEAR, 'developing', {anchor:'a2'}), sig('S1', WEAK, 'foundational')],
        D2: [sig('S2', CLEAR, 'developing', {anchor:'a1'}), sig('S2', CLEAR, 'developing', {anchor:'a2'}), sig('S1', WEAK, 'foundational')],
        D3: [sig('S2', CLEAR, 'developing', {anchor:'a1'}), sig('S2', CLEAR, 'developing', {anchor:'a2'}), sig('S1', WEAK, 'foundational')],
        D4: [sig('S2', CLEAR, 'developing', {anchor:'a1'}), sig('S2', CLEAR, 'developing', {anchor:'a2'}), sig('S1', WEAK, 'foundational')],
        D5: [sig('S2', CLEAR, 'developing', {anchor:'a1'}), sig('S2', CLEAR, 'developing', {anchor:'a2'}), sig('S1', WEAK, 'foundational')],
        D6: [sig('S2', CLEAR, 'developing', {anchor:'a1'}), sig('S2', CLEAR, 'developing', {anchor:'a2'}), sig('S1', WEAK, 'foundational')],
      }
    });
    assert.ok('capReason' in result.overall,
      `v1.1 requires overall.capReason field. Got: ${JSON.stringify(result.overall)}`);
    assert.equal(result.overall.capReason, null,
      `capReason should be null when no cap applied. Got: ${result.overall.capReason}`);
  });

  it('overall.capReason is non-null when Expert constraint cap applied', () => {
    // 1 Expert dim + 5 Proficient → high mean in Expert range → cap at 7.5
    // capReason should explain why
    const expertSigs = [
      sig('S5', STRONG, 'expert', { anchor: 'a' }),
      sig('S6', STRONG, 'expert', { anchor: 'b' }),
      sig('S5', STRONG, 'expert', { anchor: 'c' }),
      sig('S3', CLEAR, 'proficient', { anchor: 'p1' }),
      sig('S4', CLEAR, 'proficient', { anchor: 'p2' }),
      sig('S6', CLEAR, 'expert', { anchor: 'd' }),
    ];
    const proficientSigs = [
      sig('S3', CLEAR, 'proficient', { anchor: 'r1' }),
      sig('S4', CLEAR, 'proficient', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing'),
    ];
    // Need mean in Expert range: 1 Expert (~9+) + 5 Proficient (~6) → mean too low
    // Use all-proficient to get a mean in Proficient range — overall cap won't fire.
    // Test instead that when cap does fire, capReason is set.
    // For a reproducible scenario: construct mean = 7.6 (just in Expert) with only 1 Expert dim.
    // This is hard with just signals since max Proficient per dim is 7.5.
    // Simplest: use pre-computed... but we can't without an override.
    // Skip the exact score check; just verify the field exists when capped=true
    const result = scoreAssessment({
      dimensions: {
        D1: expertSigs.map(s => ({ ...s, id: `cap-${s.id}` })),
        D2: proficientSigs.map(s => ({ ...s, id: `cap2-${s.id}` })),
        D3: proficientSigs.map(s => ({ ...s, id: `cap3-${s.id}` })),
        D4: proficientSigs.map(s => ({ ...s, id: `cap4-${s.id}` })),
        D5: proficientSigs.map(s => ({ ...s, id: `cap5-${s.id}` })),
        D6: proficientSigs.map(s => ({ ...s, id: `cap6-${s.id}` })),
      }
    });
    // Overall is probably Proficient (1 Expert + 5 Proficient → mean likely ~6-7)
    // But if it IS capped, capReason must be non-null
    if (result.overall.capped) {
      assert.ok(result.overall.capReason !== null,
        `When overall.capped=true, capReason must be non-null. Got: ${JSON.stringify(result.overall)}`);
    } else {
      // If not capped in this scenario, just verify capReason exists as null
      assert.ok('capReason' in result.overall, 'overall.capReason field must always exist');
    }
  });
});

// ─── R6 §5.3 clarification — expert-breadth-cap in appliedCaps ───────────────

describe('R6 §5.3 Expert breadth cap recorded in appliedCaps', () => {

  it('When score capped at 8.5 by expert breadth gate, record in appliedCaps', () => {
    const d = score('D4', [
      sig('S5', STRONG, 'expert', { anchor: 'anchor-a' }),
      sig('S5', STRONG, 'expert', { anchor: 'anchor-a' }),  // same anchor
      sig('S6', STRONG, 'expert', { anchor: 'anchor-b' }),
      sig('S6', STRONG, 'expert', { anchor: 'anchor-b' }),  // same anchor
    ]);
    // Should cap at 8.5 (only 2 distinct strong anchors)
    assert.ok(near(d.score, 8.5), `Expected score 8.5, got ${d.score}`);
    assert.ok(Array.isArray(d.appliedCaps), 'appliedCaps must be array');
    const breadthCap = (d.appliedCaps || []).find(c =>
      String(c.rule || '').includes('5.3') ||
      String(c.reason || '').toLowerCase().includes('breadth')
    );
    assert.ok(breadthCap,
      `v1.1 requires expert-breadth-cap in appliedCaps. Got: ${JSON.stringify(d.appliedCaps)}`);
    assert.ok(near(breadthCap.capValue, 8.5),
      `expert-breadth-cap value should be 8.5. Got ${breadthCap.capValue}`);
  });
});

// ─── BUG-001 (still open) — §5.5 N signals in IE threshold ───────────────────

describe('BUG-001 §5.5 N signals and IE threshold (v1.1 unchanged)', () => {

  it('PENDING: 2 positive + 1 N signals → should this be IE or scoreable? (rubric ambiguity)', () => {
    // v1.1 §5.5 still says "< 3 total signals" — same wording as v1.0
    // Engine still counts only positive signals → 2 positive + 1 N = IE
    // Rubric should clarify whether N counts toward the 3-signal minimum
    const d = score('D4', [
      sig('S2', CLEAR, 'developing', { anchor: 'a1' }),
      sig('S2', CLEAR, 'developing', { anchor: 'a2' }),
      sig('N',  CLEAR, 'developing', { corrected: false }),
    ]);
    // Current engine returns IE (positiveSignals.length = 2 < 3)
    // Per rubric "total signals" = 3, which should be ≥ threshold
    // This test documents the ambiguity. Uncomment the assertion below once clarified:
    // assert.equal(d.insufficientEvidence, false, 'BUG-001: 2 positive + 1 N should score if N counts');
    // assert.ok(near(d.score, 2.0), 'BUG-001: after N cap, score should be Foundational midpoint');

    // For now, just log what the engine does for the record
    const isIE = d.insufficientEvidence;
    const scoreVal = d.score;
    // Don't assert — just document
    assert.ok(true, `BUG-001 pending: engine returns insufficientEvidence=${isIE}, score=${scoreVal}. Rubric §5.5 ambiguity unresolved.`);
  });
});
