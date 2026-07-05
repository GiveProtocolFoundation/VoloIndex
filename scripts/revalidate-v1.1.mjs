/**
 * §9 Head-of-Data re-validation harness for rubric v1.1.
 *
 * INDEPENDENT check: every expected value below is hand-derived directly from
 * docs/SCORING_RUBRIC.md prose (§5.2/§5.3/§5.4/§6.4/§7), NOT copied from the
 * engine's own QA fixtures. It asserts the engine reproduces the rubric.
 *
 * Run: node scripts/revalidate-v1.1.mjs
 */
import { scoreAssessment } from '../src/scoring/index.js';

let pass = 0, fail = 0;
const failures = [];

function approx(a, b) { return Math.abs(a - b) < 1e-9; }

function check(label, actual, expected) {
  const ok = (typeof expected === 'number' && typeof actual === 'number')
    ? approx(actual, expected) : actual === expected;
  if (ok) { pass++; }
  else { fail++; failures.push(`${label}: expected ${expected}, got ${actual}`); }
}

// Signal builders
const S = (type, strength, anchorTier, extra = {}) =>
  ({ type, strength, anchorTier, ...extra });

// Score a single dimension in isolation (put it in D1, leave rest empty).
function scoreOne(signals, contradictions) {
  const r = scoreAssessment({ dimensions: { D1: signals }, contradictions });
  return r.dimensions[0];
}

// ── §5.2 Position formula & band reachability ──────────────────────
// position = min(1, max(0,(Σ−Q)/(K−Q))); score = min + position*(max−min)

// Developing floor: 2 clear signals at developing (one S2) give the qualifying Σ=2.0.
// The mandatory 3rd signal (§5.5) must anchor BELOW base tier so it stays out of Σ
// (positionScore counts only anchorTier >= baseTier). Σ=2.0, Q=2 → pos 0 → 3.1.
check('§5.2 Developing floor 3.1',
  scoreOne([S('S2', 1.0, 'developing'), S('S1', 1.0, 'developing'), S('S1', 0.5, 'foundational')]).score,
  3.1);

// Developing mid: Σ=3.0 → pos (3-2)/(4-2)=0.5 → 3.1+0.5*2.4=4.3
check('§5.2 Developing mid 4.3',
  scoreOne([S('S2', 1.0, 'developing'), S('S1', 1.0, 'developing'), S('S1', 1.0, 'developing')]).score,
  4.3);

// Developing saturation: Σ=4.0 → pos 1 → 5.5
check('§5.2 Developing saturation 5.5',
  scoreOne([S('S2', 1.0, 'developing'), S('S1', 1.0, 'developing'),
            S('S1', 1.0, 'developing'), S('S1', 1.0, 'developing')]).score,
  5.5);

// Proficient floor: needs S3 + (S4 or 2nd S3), 2 clear at proficient. Σ=2.0,Q=2,K=5 → 5.6
check('§5.2 Proficient floor 5.6',
  scoreOne([S('S3', 1.0, 'proficient'), S('S4', 1.0, 'proficient'), S('S1', 0.5, 'developing')]).score,
  5.6);

// Proficient mid: Σ=3.5 → pos (3.5-2)/(5-2)=0.5 → 5.6+0.5*1.9=6.55→6.6
check('§5.2 Proficient mid 6.6',
  scoreOne([S('S3', 1.5, 'proficient'), S('S4', 1.0, 'proficient'), S('S3', 1.0, 'proficient')]).score,
  6.6);

// Expert floor: S5 clear + S6 clear, 2 clear at expert. Σ=2.0,Q=2,K=6 → 7.6
check('§5.2 Expert floor 7.6',
  scoreOne([S('S5', 1.0, 'expert'), S('S6', 1.0, 'expert'), S('S1', 0.5, 'developing')]).score,
  7.6);

// Foundational: Q=0,K=4. 3 weak S1 foundational Σ=1.5 → pos 1.5/4=0.375 → 1+0.375*2=1.75→1.8
check('§5.2 Foundational Σ1.5 → 1.8',
  scoreOne([S('S1', 0.5, 'foundational'), S('S1', 0.5, 'foundational'), S('S1', 0.5, 'foundational')]).score,
  1.8);

// ── §5.3 Expert breadth cap ────────────────────────────────────────
// score >8.5 requires strong signals in ≥3 distinct expert anchors, else cap 8.5.
// Build base Expert with high Σ but only 2 distinct strong anchors → cap 8.5.
{
  const d = scoreOne([
    S('S5', 1.5, 'expert', { anchor: 'systems' }),
    S('S6', 1.5, 'expert', { anchor: 'advocacy' }),
    S('S5', 1.5, 'expert', { anchor: 'systems' }),   // same anchor, no new breadth
    S('S6', 1.5, 'expert', { anchor: 'advocacy' }),
  ]);
  // Σ=6.0 → pos 1 → raw 10.0; only 2 distinct strong anchors → cap 8.5
  check('§5.3 breadth cap value 8.5', d.score, 8.5);
  const cap = d.appliedCaps.find(c => c.rule === '§5.3');
  check('§5.3 breadth cap recorded', !!cap, true);
}
// With 3 distinct strong anchors → NOT capped (stays 10.0)
{
  const d = scoreOne([
    S('S5', 1.5, 'expert', { anchor: 'systems' }),
    S('S6', 1.5, 'expert', { anchor: 'advocacy' }),
    S('S5', 1.5, 'expert', { anchor: 'pathways' }),
    S('S6', 1.5, 'expert', { anchor: 'mentorship' }),
  ]);
  check('§5.3 breadth met → 10.0', d.score, 10.0);
  check('§5.3 no breadth cap', d.appliedCaps.some(c => c.rule === '§5.3'), false);
}

// ── §5.4 Monotonic red-flag caps ───────────────────────────────────
// midpoints: Foundational 2.0, Developing 4.3, Proficient 6.55→6.6, Expert 8.8
// 1 N on Expert base → tier 1 below = Proficient midpoint 6.6
{
  const d = scoreOne([
    S('S5', 1.0, 'expert'), S('S6', 1.0, 'expert'), S('S1', 0.5, 'developing'),
    S('N', 1.0, 'expert', { corrected: false }),
  ]);
  check('§5.4 1N Expert → 6.6', d.score, 6.6);
}
// 2 N on Expert base → tier 2 below = Developing midpoint 4.3 (lower than 5.5 hard cap)
{
  const d = scoreOne([
    S('S5', 1.0, 'expert'), S('S6', 1.0, 'expert'), S('S1', 0.5, 'developing'),
    S('N', 1.0, 'expert'), S('N', 1.0, 'expert'),
  ]);
  check('§5.4 2N Expert → 4.3', d.score, 4.3);
}
// 1 N on Proficient base → Developing midpoint 4.3
{
  const d = scoreOne([
    S('S3', 1.0, 'proficient'), S('S4', 1.0, 'proficient'), S('S1', 0.5, 'developing'),
    S('N', 1.0, 'proficient'),
  ]);
  check('§5.4 1N Proficient → 4.3', d.score, 4.3);
}
// 2 N on Developing base → 2 steps below floor 1.0
{
  const d = scoreOne([
    S('S2', 1.0, 'developing'), S('S1', 1.0, 'developing'), S('S1', 1.0, 'developing'),
    S('N', 1.0, 'developing'), S('N', 1.0, 'developing'),
  ]);
  check('§5.4 2N Developing → floor 1.0', d.score, 1.0);
}
// Corrected N does not count toward n
{
  const d = scoreOne([
    S('S5', 1.0, 'expert'), S('S6', 1.0, 'expert'), S('S1', 0.5, 'developing'),
    S('N', 1.0, 'expert', { corrected: true }),
  ]);
  check('§5.4 corrected N ignored → 7.6', d.score, 7.6);
}

// ── §7 Recall inflation ────────────────────────────────────────────
// Developing+ base, ≥4 S1, exactly 1 clear S2, no strong S2/S3+ → cap ≤4.3
{
  const d = scoreOne([
    S('S1', 1.0, 'developing'), S('S1', 1.0, 'developing'),
    S('S1', 1.0, 'developing'), S('S1', 1.0, 'developing'),
    S('S2', 1.0, 'developing'),
  ]);
  // Σ=5.0 → pos 1 → raw 5.5; recall inflation caps to 4.3
  check('§7 recall inflation → 4.3', d.score, 4.3);
  check('§7 cap recorded', d.appliedCaps.some(c => c.rule === '§7'), true);
}
// Does NOT fire when a strong S2 exists
{
  const d = scoreOne([
    S('S1', 1.0, 'developing'), S('S1', 1.0, 'developing'),
    S('S1', 1.0, 'developing'), S('S1', 1.0, 'developing'),
    S('S2', 1.5, 'developing'),
  ]);
  check('§7 no fire with strong S2', d.appliedCaps.some(c => c.rule === '§7'), false);
}

// ── §5.5 Insufficient evidence ─────────────────────────────────────
{
  const d = scoreOne([S('S1', 1.0, 'developing'), S('S1', 1.0, 'developing')]);
  check('§5.5 <3 signals → IE', d.insufficientEvidence, true);
  check('§5.5 IE score null', d.score, null);
}

// ── §6.4 Overall Expert constraint ─────────────────────────────────
// Build 6 dims all Expert-floor 7.6 → mean 7.6, but only if ≥4 Prof+ & ≥2 Expert.
// 6 dims at 7.6 → 6 Expert, 6 Prof+ → constraint satisfied → NOT capped.
{
  const expertDim = [S('S5', 1.0, 'expert'), S('S6', 1.0, 'expert'), S('S1', 0.5, 'developing')];
  const r = scoreAssessment({ dimensions: {
    D1: expertDim, D2: expertDim, D3: expertDim,
    D4: expertDim, D5: expertDim, D6: expertDim,
  }});
  check('§6.4 all-expert mean 7.6', r.overall.score, 7.6);
  check('§6.4 all-expert not capped', r.overall.capped, false);
}
// 2 Expert (7.6) + 4 Developing-floor (3.1): mean=(7.6*2+3.1*4)/6=27.6/6=4.6 → not expert range, no cap.
// Developing-floor dims use a below-base filler so Σ stays 2.0 (see §5.2 floor case above).
{
  const expertDim = [S('S5', 1.0, 'expert'), S('S6', 1.0, 'expert'), S('S1', 0.5, 'developing')];
  const devDim = [S('S2', 1.0, 'developing'), S('S1', 1.0, 'developing'), S('S1', 0.5, 'foundational')];
  const r = scoreAssessment({ dimensions: {
    D1: expertDim, D2: expertDim, D3: devDim,
    D4: devDim, D5: devDim, D6: devDim,
  }});
  check('§6.4 mixed mean 4.6', r.overall.score, 4.6);
}
// Force overall into expert range WITHOUT the profile: 5 Expert + 1 Foundational.
// mean = (7.6*5 + 1.8)/6 = (38+1.8)/6 = 39.8/6 = 6.633 → 6.6, not expert range.
// To land ≥7.6 in expert range but fail constraint we need ≥4 prof+ AND <2 expert OR <4 prof+.
// Use 1 Expert (7.6) + 5 Proficient-high. 5 Prof at 7.5 + 1 Expert 7.6 = (37.5+7.6)/6=45.1/6=7.517→7.5 not expert.
// Use 6 dims where mean≥7.6 but only 1 Expert: 1 Expert 10.0 + 5 Proficient 7.5 = (10+37.5)/6=47.5/6=7.917→7.9 expert range, 1 Expert<2 → cap 7.5
{
  const expertHigh = [
    S('S5', 1.5, 'expert', { anchor: 'a' }), S('S6', 1.5, 'expert', { anchor: 'b' }),
    S('S5', 1.5, 'expert', { anchor: 'c' }), S('S6', 1.5, 'expert', { anchor: 'd' }),
  ]; // 4 strong distinct anchors → 10.0
  const profHigh = [S('S3', 1.5, 'proficient'), S('S4', 1.5, 'proficient'), S('S3', 1.5, 'proficient')]; // Σ4.5→pos1→7.5
  const r = scoreAssessment({ dimensions: {
    D1: expertHigh, D2: profHigh, D3: profHigh,
    D4: profHigh, D5: profHigh, D6: profHigh,
  }});
  check('§6.4 1-expert 5-prof capped to 7.5', r.overall.score, 7.5);
  check('§6.4 capped flag true', r.overall.capped, true);
}

// ── Output contract (§8 R4) presence ───────────────────────────────
{
  const r = scoreAssessment({ dimensions: { D1: [
    S('S3', 1.0, 'proficient', { anchor: 'x' }), S('S4', 1.0, 'proficient', { anchor: 'y' }),
    S('S1', 0.5, 'developing'),
  ] }});
  // v1.2 = v1.1 + BUG-001 §5.5 gating-rule bump (GIV-579); formulas unchanged.
  check('§8 rubricVersion 1.2', r.rubricVersion, '1.2');
  const d = r.dimensions[0];
  check('§8 evidenceDensity present', d.evidenceDensity != null, true);
  check('§8 evidenceDensity has Q', d.evidenceDensity.Q, 2.0);
  check('§8 signal carries tier', d.signals[0].tier, 'Proficient');
  check('§8 appliedCaps is array', Array.isArray(d.appliedCaps), true);
  check('§8 overall.capReason field exists', 'capReason' in r.overall, true);
}

// ── Determinism ────────────────────────────────────────────────────
{
  const input = { dimensions: { D1: [
    S('S3', 1.0, 'proficient'), S('S4', 1.0, 'proficient'), S('S1', 0.5, 'developing'),
  ] }};
  const a = JSON.stringify(scoreAssessment(input));
  const b = JSON.stringify(scoreAssessment(input));
  check('determinism', a === b, true);
}

console.log(`\n§9 RE-VALIDATION: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log('All independent rubric-derived checks reproduce the engine. ✓');
}
