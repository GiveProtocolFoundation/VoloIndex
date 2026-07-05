/**
 * Volo Index Scoring Engine — Test Fixtures
 *
 * Covers: at least one worked example per tier per dimension,
 * plus edge cases for boundary scores, red-flag caps, insufficient
 * evidence, §6.4 overall-tier cap, and each §7 integrity rule.
 */

// ── Helper: build a signal ──────────────────────────────────────────

let _id = 0;
function sig(type, strength, anchorTier, opts = {}) {
  return {
    id: `sig-${++_id}`,
    type,
    strength,
    anchorTier,
    excerpt: opts.excerpt || `Example ${type} evidence`,
    anchor: opts.anchor || `anchor-${type}-${anchorTier}`,
    hasFirstPersonSpecificity: opts.hasFirstPersonSpecificity ?? true,
    ...(type === 'N' ? { corrected: opts.corrected ?? false } : {}),
  };
}

function resetIds() { _id = 0; }

// ── Per-tier fixtures (D1 — Strategic Engagement Design) ────────────

/** Foundational: only S1 recall signals at foundational anchor */
export const D1_FOUNDATIONAL = [
  sig('S1', 1.0, 'foundational', { excerpt: 'Knows the term volunteer management' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Mentions cost savings as benefit' }),
  sig('S1', 1.0, 'foundational', { excerpt: 'Aware of recruitment concepts' }),
];

/** Developing: has S2 applied practice, developing anchors */
export const D1_DEVELOPING = [
  sig('S1', 1.0, 'developing', { excerpt: 'Understands mission-alignment concept' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Wrote role descriptions with purpose statements' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Set basic program goals for headcount' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Mentions org strategy abstractly' }),
];

/** Proficient: has S3 reasoning + S4 adaptation */
export const D1_PROFICIENT = [
  sig('S3', 1.0, 'proficient', { excerpt: 'Explains why outcome-linked goals drive engagement', anchor: 'outcome-linked goals' }),
  sig('S4', 1.0, 'proficient', { excerpt: 'Adapts assessment to org readiness before expanding', anchor: 'readiness assessment' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Has written role descriptions' }),
  sig('S3', 1.5, 'proficient', { excerpt: 'Articulates strategic case to leadership', anchor: 'strategic case' }),
];

/** Expert: has S5 systems design + S6 advocacy */
export const D1_EXPERT = [
  sig('S5', 1.5, 'expert', { excerpt: 'Designed business case with VIVA-style valuation', anchor: 'business-case-roi' }),
  sig('S6', 1.0, 'expert', { excerpt: 'Mentors peers on strategic engagement design', anchor: 'mentoring-strategic' }),
  sig('S5', 1.0, 'expert', { excerpt: 'Aligns volunteer roles to theory of change', anchor: 'theory-of-change' }),
  sig('S3', 1.5, 'proficient', { excerpt: 'Deep reasoning about volunteer value proposition' }),
  sig('S4', 1.0, 'proficient', { excerpt: 'Adapts to org size and sector' }),
  sig('S6', 1.5, 'expert', { excerpt: 'Influences board investment decisions', anchor: 'board-influence' }),
];

// ── Per-tier fixtures (D2 — Recruitment, Matching & Onboarding) ─────

export const D2_FOUNDATIONAL = [
  sig('S1', 1.0, 'foundational', { excerpt: 'Posts generic volunteer needed appeals' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Accepts anyone for any role' }),
  sig('S1', 1.0, 'foundational', { excerpt: 'Onboarding is paperwork only' }),
];

export const D2_DEVELOPING = [
  sig('S1', 1.0, 'developing', { excerpt: 'Aware that motivation matters' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Writes role-specific recruitment messages' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Conducts basic interviews' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Has an orientation checklist' }),
];

export const D2_PROFICIENT = [
  sig('S3', 1.0, 'proficient', { excerpt: 'Explains functional motives framework', anchor: 'motivation-matching' }),
  sig('S4', 1.5, 'proficient', { excerpt: 'Adjusts recruitment channels by target audience', anchor: 'channel-targeting' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Tracks conversion from inquiry to active volunteer' }),
  sig('S3', 1.0, 'proficient', { excerpt: 'Stages onboarding: orientation, training, check-in', anchor: 'staged-onboarding' }),
];

export const D2_EXPERT = [
  sig('S5', 1.5, 'expert', { excerpt: 'Designs full attraction-to-integration pipeline', anchor: 'pipeline-design' }),
  sig('S6', 1.0, 'expert', { excerpt: 'Trains staff on matching practice', anchor: 'staff-training' }),
  sig('S5', 1.0, 'expert', { excerpt: 'Builds inclusive recruitment for diverse demographics', anchor: 'inclusive-recruitment' }),
  sig('S3', 1.5, 'proficient', { excerpt: 'Evaluates onboarding based on 90-day retention data' }),
  sig('S4', 1.0, 'proficient', { excerpt: 'Adapts screening to role risk level' }),
  sig('S6', 1.5, 'expert', { excerpt: 'Redesigns onboarding from retention data analysis', anchor: 'retention-redesign' }),
];

// ── Per-tier fixtures (D3 — Training, Development & Role Support) ───

export const D3_FOUNDATIONAL = [
  sig('S1', 0.5, 'foundational', { excerpt: 'Training is shadow someone' }),
  sig('S1', 1.0, 'foundational', { excerpt: 'Assumes volunteers will ask for help' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'No ongoing support structure' }),
];

export const D3_DEVELOPING = [
  sig('S2', 1.0, 'developing', { excerpt: 'Provides structured initial training for most roles' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Does occasional check-ins with volunteers' }),
  sig('S1', 1.0, 'developing', { excerpt: 'Recognizes experienced volunteers get bored' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'No development pathway yet' }),
];

export const D3_PROFICIENT = [
  sig('S3', 1.0, 'proficient', { excerpt: 'Scales training depth to responsibility and risk', anchor: 'risk-scaled-training' }),
  sig('S4', 1.0, 'proficient', { excerpt: 'Adapts support style to the individual', anchor: 'individualized-support' }),
  sig('S2', 1.5, 'developing', { excerpt: 'Creates growth options: skill expansion, leadership roles' }),
  sig('S3', 1.0, 'proficient', { excerpt: 'Provides ongoing coaching proactively', anchor: 'proactive-coaching' }),
];

export const D3_EXPERT = [
  sig('S5', 1.5, 'expert', { excerpt: 'Builds tiered development pathways: frontline → lead → trainer', anchor: 'tiered-pathways' }),
  sig('S6', 1.0, 'expert', { excerpt: 'Develops volunteers as trainers and mentors', anchor: 'volunteer-trainers' }),
  sig('S5', 1.0, 'expert', { excerpt: 'Evaluates training effectiveness vs role performance', anchor: 'training-evaluation' }),
  sig('S3', 1.5, 'proficient', { excerpt: 'Uses adult-learning principles deliberately' }),
  sig('S4', 1.0, 'proficient', { excerpt: 'Adapts learning modality to volunteer type' }),
  sig('S6', 1.5, 'expert', { excerpt: 'Mentors other practitioners on training design', anchor: 'training-mentorship' }),
];

// ── Per-tier fixtures (D4 — Performance, Impact & Accountability) ───

export const D4_FOUNDATIONAL = [
  sig('S1', 1.0, 'foundational', { excerpt: 'Avoids performance conversations' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'No expectations beyond showing up' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Reports activity hours if anything' }),
];

export const D4_DEVELOPING = [
  sig('S2', 1.0, 'developing', { excerpt: 'Sets written expectations for key roles' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Gives informal feedback' }),
  sig('S1', 1.0, 'developing', { excerpt: 'Collects some output data' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Avoids hard conversations' }),
];

export const D4_PROFICIENT = [
  sig('S3', 1.5, 'proficient', { excerpt: 'Explains when and how to reassign or release a volunteer', anchor: 'performance-management' }),
  sig('S4', 1.0, 'proficient', { excerpt: 'Connects outputs to outcomes per org context', anchor: 'outcome-measurement' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Gives timely specific feedback on underperformance' }),
  sig('S3', 1.0, 'proficient', { excerpt: 'Communicates program value with evidence', anchor: 'stakeholder-communication' }),
];

export const D4_EXPERT = [
  sig('S5', 1.5, 'expert', { excerpt: 'Runs full accountability system with exit paths', anchor: 'accountability-system' }),
  sig('S6', 1.5, 'expert', { excerpt: 'Coaches staff on volunteer performance management', anchor: 'staff-coaching' }),
  sig('S5', 1.0, 'expert', { excerpt: 'Builds impact measurement framework', anchor: 'impact-framework' }),
  sig('S3', 1.0, 'proficient', { excerpt: 'Knows limits of valuation methods' }),
  sig('S4', 1.0, 'proficient', { excerpt: 'Adapts feedback to volunteer context' }),
  sig('S6', 1.5, 'expert', { excerpt: 'Designs dignified exit paths for all scenarios', anchor: 'exit-paths' }),
];

// ── Per-tier fixtures (D5 — Recognition, Retention & Culture) ───────

export const D5_FOUNDATIONAL = [
  sig('S1', 0.5, 'foundational', { excerpt: 'Annual certificate for everyone identical' }),
  sig('S1', 1.0, 'foundational', { excerpt: 'Attributes turnover to volunteer flakiness' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Unaware of staff-volunteer friction' }),
];

export const D5_DEVELOPING = [
  sig('S2', 1.0, 'developing', { excerpt: 'Thanks volunteers regularly' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Notices different people like different recognition' }),
  sig('S1', 1.0, 'developing', { excerpt: 'Tracks retention loosely' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Exit reasons unknown' }),
];

export const D5_PROFICIENT = [
  sig('S3', 1.0, 'proficient', { excerpt: 'Explains matching recognition to motivation type', anchor: 'motivation-recognition' }),
  sig('S4', 1.5, 'proficient', { excerpt: 'Intervenes on flight risk based on engagement signals', anchor: 'retention-intervention' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Runs exit conversations and uses the data' }),
  sig('S3', 1.0, 'proficient', { excerpt: 'Builds belonging between staff and volunteers', anchor: 'belonging-building' }),
];

export const D5_EXPERT = [
  sig('S5', 1.5, 'expert', { excerpt: 'Designs retention systems with cohort retention curves', anchor: 'retention-systems' }),
  sig('S6', 1.0, 'expert', { excerpt: 'Equips staff org-wide to sustain volunteer culture', anchor: 'culture-systems' }),
  sig('S5', 1.0, 'expert', { excerpt: 'Diagnoses cultural root causes of attrition', anchor: 'attrition-diagnosis' }),
  sig('S3', 1.5, 'proficient', { excerpt: 'Grounds recognition in motivation research' }),
  sig('S4', 1.0, 'proficient', { excerpt: 'Adapts culture-building to org type' }),
  sig('S6', 1.5, 'expert', { excerpt: 'Integrates volunteers in org decision-making', anchor: 'volunteer-integration' }),
];

// ── Per-tier fixtures (D6 — Ethics, Equity & Advocacy) ──────────────

export const D6_FOUNDATIONAL = [
  sig('S1', 1.0, 'foundational', { excerpt: 'Unaware of power dynamics in unpaid work' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Program assumes free time and transport' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Shares info loosely' }),
];

export const D6_DEVELOPING = [
  sig('S2', 1.0, 'developing', { excerpt: 'Recognizes some barriers to participation' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Addresses confidentiality when raised' }),
  sig('S1', 1.0, 'developing', { excerpt: 'Advocates for program occasionally' }),
  sig('S1', 0.5, 'foundational', { excerpt: 'Doesn\'t audit proactively' }),
];

export const D6_PROFICIENT = [
  sig('S3', 1.0, 'proficient', { excerpt: 'Applies ethical frameworks to boundary situations', anchor: 'ethical-frameworks' }),
  sig('S4', 1.0, 'proficient', { excerpt: 'Designs for access: cost, schedule, language, ability', anchor: 'access-design' }),
  sig('S2', 1.5, 'developing', { excerpt: 'Handles data with defined privacy practice' }),
  sig('S3', 1.5, 'proficient', { excerpt: 'Makes the case for program resources with leadership', anchor: 'resource-advocacy' }),
];

export const D6_EXPERT = [
  sig('S5', 1.5, 'expert', { excerpt: 'Builds equity audits into program infrastructure', anchor: 'equity-audits' }),
  sig('S6', 1.0, 'expert', { excerpt: 'Advocates at org and field level', anchor: 'field-advocacy' }),
  sig('S5', 1.0, 'expert', { excerpt: 'Sets policy on ethical questions', anchor: 'ethics-policy' }),
  sig('S3', 1.5, 'proficient', { excerpt: 'Deep reasoning about displacement ethics' }),
  sig('S4', 1.0, 'proficient', { excerpt: 'Adapts inclusion strategy to population served' }),
  sig('S6', 1.5, 'expert', { excerpt: 'Mentors others on ethical practice', anchor: 'ethics-mentorship' }),
];

// ── Edge case fixtures ──────────────────────────────────────────────

/** Boundary 3.0 (top of Foundational) — saturated foundational signals */
export const EDGE_BOUNDARY_3_0 = [
  sig('S1', 1.0, 'foundational'),
  sig('S1', 1.0, 'foundational'),
  sig('S1', 1.0, 'foundational'),
  sig('S1', 1.0, 'foundational'),
  // 4.0 total strength, K=4.0 → position=1.0 → score=1.0+1.0*2.0=3.0
  // But: ≥4 S1 and 0 S2 → §7.1 recall inflation → no S2 so... wait,
  // this should also trigger recall inflation. Let me add an S2 to avoid that.
];

/** Boundary 3.0 — exactly top of Foundational without recall inflation */
export const EDGE_SCORE_3_0 = [
  sig('S1', 1.0, 'foundational'),
  sig('S1', 1.0, 'foundational'),
  sig('S1', 1.0, 'foundational'),
  sig('S2', 1.0, 'foundational'),
  // Has S2 so no recall inflation. No S2 at developing anchor → stays Foundational
  // Total foundational strength: 4.0, K=4.0 → position=1.0 → score=1.0+1.0*2.0=3.0
];

/** Boundary 3.1 (bottom of Developing) — just enough for Developing tier */
export const EDGE_SCORE_3_1 = [
  sig('S2', 1.0, 'developing', { excerpt: 'Applied practice example 1' }),
  sig('S2', 1.0, 'developing', { excerpt: 'Applied practice example 2' }),
  sig('S1', 0.5, 'foundational'),
  // Base tier: developing (≥2 clear at developing, ≥1 S2 ✓)
  // Developing+ signals: 2.0 strength, K=4.0 → position=0.5
  // Score: 3.1 + 0.5 * 2.4 = 4.3. Hmm that's too high for 3.1 boundary.
  // For exactly 3.1: position must be 0 → tier_min = 3.1
  // That means 0 strength at developing+, but we need 2 clear at developing...
  // Actually the signals that qualify for tier ARE counted in position.
  // Minimum: position = 2.0/4.0 = 0.5 → 3.1 + 0.5*2.4 = 4.3
  // So 3.1 exactly isn't achievable with ≥2 clear developing signals.
  // The minimum developing score is 4.3 with 2 clear signals.
];

/** Boundary 5.5 (top of Developing) — saturated developing */
export const EDGE_SCORE_5_5 = [
  sig('S2', 1.0, 'developing'),
  sig('S2', 1.0, 'developing'),
  sig('S2', 1.0, 'developing'),
  sig('S2', 1.0, 'developing'),
  sig('S1', 0.5, 'foundational'),
  // Base tier: developing (≥2 clear at developing, ≥1 S2 ✓)
  // Developing+ strength: 4.0, K=4.0 → position=1.0
  // Score: 3.1 + 1.0 * 2.4 = 5.5 ✓
];

/** Boundary 5.6 (bottom of Proficient) — just qualifies for Proficient */
export const EDGE_SCORE_5_6 = [
  sig('S3', 1.0, 'proficient', { anchor: 'reasoning-1' }),
  sig('S4', 1.0, 'proficient', { anchor: 'adaptation-1' }),
  sig('S2', 1.0, 'developing'),
  // Base tier: proficient (≥2 clear at proficient, ≥1 S3 ✓, S3+S4≥2 ✓)
  // Proficient+ strength: 2.0, K=5.0 → position=0.4
  // Score: 5.6 + 0.4 * 1.9 = 5.6 + 0.76 = 6.36 → 6.4
  // Not 5.6... minimum proficient with 2 clear signals = 5.6 + (2.0/5.0)*1.9 = 6.36
];

/** Boundary 7.5 (top of Proficient) — saturated proficient */
export const EDGE_SCORE_7_5 = [
  sig('S3', 1.0, 'proficient', { anchor: 'a1' }),
  sig('S4', 1.5, 'proficient', { anchor: 'a2' }),
  sig('S3', 1.5, 'proficient', { anchor: 'a3' }),
  sig('S2', 1.0, 'developing'),
  sig('S4', 1.0, 'proficient', { anchor: 'a4' }),
  // Base tier: proficient ✓
  // Proficient+ strength: 1.0+1.5+1.5+1.0 = 5.0, K=5.0 → position=1.0
  // Score: 5.6 + 1.0 * 1.9 = 7.5 ✓
];

/** Boundary 7.6 (bottom of Expert) — just qualifies for Expert */
export const EDGE_SCORE_7_6 = [
  sig('S5', 1.0, 'expert', { anchor: 'expert-a1' }),
  sig('S6', 1.0, 'expert', { anchor: 'expert-a2' }),
  sig('S3', 1.0, 'proficient'),
  sig('S4', 1.0, 'proficient'),
  sig('S2', 1.0, 'developing'),
  // Base tier: expert (≥2 clear at expert, S5 clear ✓, S6 clear ✓)
  // Expert+ strength: 2.0, K=6.0 → position=0.333
  // Score: 7.6 + 0.333 * 2.4 = 7.6 + 0.8 = 8.4. Hmm that's 8.4.
  // For minimum expert: position = 2.0/6.0 = 0.333 → 8.4
];

/** Red-flag cap: 1 uncorrected N caps at midpoint of tier below */
export const EDGE_RED_FLAG_ONE = [
  sig('S3', 1.0, 'proficient', { anchor: 'a1' }),
  sig('S4', 1.0, 'proficient', { anchor: 'a2' }),
  sig('S3', 1.5, 'proficient', { anchor: 'a3' }),
  sig('S2', 1.0, 'developing'),
  sig('N', 1.0, 'proficient', { excerpt: 'Treats volunteers as free labor', corrected: false }),
  // Base tier: proficient
  // Raw score: proficient+ = 3.5, K=5.0 → position=0.7 → 5.6+0.7*1.9 = 6.93 → 6.9
  // 1 uncorrected N at clear → cap at developing midpoint = 4.3
  // Final: 4.3
];

/** Red-flag cap: 1 N that was corrected → no cap */
export const EDGE_RED_FLAG_CORRECTED = [
  sig('S3', 1.0, 'proficient', { anchor: 'a1' }),
  sig('S4', 1.0, 'proficient', { anchor: 'a2' }),
  sig('S3', 1.5, 'proficient', { anchor: 'a3' }),
  sig('S2', 1.0, 'developing'),
  sig('N', 1.0, 'proficient', { excerpt: 'Initially said volunteers are free', corrected: true }),
  // Same base score 6.9 but corrected → no cap
];

/** Red-flag cap: 2 uncorrected N → cap at 5.5 */
export const EDGE_RED_FLAG_TWO = [
  sig('S5', 1.5, 'expert', { anchor: 'a1' }),
  sig('S6', 1.0, 'expert', { anchor: 'a2' }),
  sig('S5', 1.0, 'expert', { anchor: 'a3' }),
  sig('S3', 1.0, 'proficient'),
  sig('S4', 1.0, 'proficient'),
  sig('N', 1.0, 'expert', { corrected: false }),
  sig('N', 1.5, 'expert', { corrected: false }),
  // Base tier: expert, raw score high, but 2 uncorrected N → cap at 5.5
];

/** Insufficient evidence: < 3 positive signals */
export const EDGE_INSUFFICIENT = [
  sig('S1', 1.0, 'foundational'),
  sig('S2', 0.5, 'developing'),
  // Only 2 positive signals → insufficient evidence
];

/** Recall inflation (v1.1): Developing+ with ≥4 S1, exactly 1 clear S2, no strong S2/S3+ → cap at 4.3 */
export const EDGE_RECALL_INFLATION = [
  sig('S2', 1.0, 'developing'),
  sig('S1', 1.5, 'developing'),
  sig('S1', 1.0, 'foundational'),
  sig('S1', 1.0, 'foundational'),
  sig('S1', 1.0, 'foundational'),
  sig('S1', 1.0, 'foundational'),
  // Base tier: developing (S2 clear at developing + S1 strong at developing = 2 clear-or-stronger; ≥1 S2 ✓)
  // v1.1 recall inflation: Developing+ ✓, 5 S1 ≥ 4 ✓, exactly 1 clear S2 ✓, no strong S2/S3+ ✓
  // Developing+ strength: S2(1.0) + S1(1.5) = 2.5; Q=2.0, K=4.0
  // position = (2.5−2.0)/(4.0−2.0) = 0.25 → score = 3.1 + 0.25×2.4 = 3.7
  // Recall inflation cap: min(3.7, 4.3) = 3.7 → score 3.7, flag set
];

/** Generic answer detection: S2+ without first-person specificity → downgrade to S1 */
export const EDGE_GENERIC_ANSWER = [
  sig('S3', 1.0, 'proficient', { hasFirstPersonSpecificity: false, anchor: 'a1' }),
  sig('S4', 1.0, 'proficient', { hasFirstPersonSpecificity: false, anchor: 'a2' }),
  sig('S2', 1.0, 'developing', { hasFirstPersonSpecificity: true }),
  sig('S1', 1.0, 'foundational'),
  // S3 and S4 downgraded to S1 → no proficient qualification
  // Base tier: developing (S2 present, but are there 2 clear developing-anchor signals? S2 is clear at developing ✓ but only 1)
  // Actually only 1 S2 at developing anchor. Need 2 clear at developing.
  // After downgrade: 3 S1, 1 S2. S2 at developing anchor.
  // Foundational base tier (only 1 developing-anchor signal at clear).
  // All strength: 4.0, K=4.0 → pos=1.0 → 3.0
];

/** Expert gating: score > 8.5 without enough distinct strong expert anchors */
export const EDGE_EXPERT_GATING = [
  sig('S5', 1.5, 'expert', { anchor: 'systems-a' }),
  sig('S6', 1.5, 'expert', { anchor: 'advocacy-a' }),
  sig('S5', 1.5, 'expert', { anchor: 'systems-a' }), // same anchor as first
  sig('S6', 1.5, 'expert', { anchor: 'advocacy-a' }), // same anchor
  sig('S3', 1.0, 'proficient'),
  sig('S4', 1.0, 'proficient'),
  // Expert+ strength: 6.0, K=6.0 → pos=1.0 → 7.6+1.0*2.4=10.0
  // But strong expert signals only 2 distinct anchors → cap at 8.5
];

/** Expert gating passes: ≥3 distinct strong expert anchors */
export const EDGE_EXPERT_GATING_PASS = [
  sig('S5', 1.5, 'expert', { anchor: 'anchor-a' }),
  sig('S6', 1.5, 'expert', { anchor: 'anchor-b' }),
  sig('S5', 1.5, 'expert', { anchor: 'anchor-c' }),
  sig('S6', 1.5, 'expert', { anchor: 'anchor-d' }),
  sig('S3', 1.0, 'proficient'),
  sig('S4', 1.0, 'proficient'),
  // Expert+ strength: 6.0, K=6.0 → pos=1.0 → 10.0
  // 4 distinct strong expert anchors ≥ 3 → passes gating
];

// ── Full assessment fixtures ────────────────────────────────────────

/** All proficient — for testing §6 aggregation */
export function fullProficientAssessment() {
  resetIds();
  return {
    dimensions: {
      D1: D1_PROFICIENT.map(s => ({ ...s, id: `fp-${++_id}` })),
      D2: D2_PROFICIENT.map(s => ({ ...s, id: `fp-${++_id}` })),
      D3: D3_PROFICIENT.map(s => ({ ...s, id: `fp-${++_id}` })),
      D4: D4_PROFICIENT.map(s => ({ ...s, id: `fp-${++_id}` })),
      D5: D5_PROFICIENT.map(s => ({ ...s, id: `fp-${++_id}` })),
      D6: D6_PROFICIENT.map(s => ({ ...s, id: `fp-${++_id}` })),
    },
  };
}

/** All expert — for testing §6.4 and §7.4 */
export function fullExpertAssessment() {
  resetIds();
  return {
    dimensions: {
      D1: D1_EXPERT.map(s => ({ ...s, id: `fe-${++_id}` })),
      D2: D2_EXPERT.map(s => ({ ...s, id: `fe-${++_id}` })),
      D3: D3_EXPERT.map(s => ({ ...s, id: `fe-${++_id}` })),
      D4: D4_EXPERT.map(s => ({ ...s, id: `fe-${++_id}` })),
      D5: D5_EXPERT.map(s => ({ ...s, id: `fe-${++_id}` })),
      D6: D6_EXPERT.map(s => ({ ...s, id: `fe-${++_id}` })),
    },
  };
}

/** Mixed — some Expert, some not → tests §6.4 overall-tier cap */
export function mixedAssessmentForOverallCap() {
  resetIds();
  return {
    dimensions: {
      D1: D1_EXPERT.map(s => ({ ...s, id: `mc-${++_id}` })),
      D2: D2_DEVELOPING.map(s => ({ ...s, id: `mc-${++_id}` })),
      D3: D3_DEVELOPING.map(s => ({ ...s, id: `mc-${++_id}` })),
      D4: D4_DEVELOPING.map(s => ({ ...s, id: `mc-${++_id}` })),
      D5: D5_DEVELOPING.map(s => ({ ...s, id: `mc-${++_id}` })),
      D6: D6_DEVELOPING.map(s => ({ ...s, id: `mc-${++_id}` })),
    },
  };
}

/** One dimension insufficient — partial overall (§6.2) */
export function partialAssessment() {
  resetIds();
  return {
    dimensions: {
      D1: D1_PROFICIENT.map(s => ({ ...s, id: `pa-${++_id}` })),
      D2: D2_PROFICIENT.map(s => ({ ...s, id: `pa-${++_id}` })),
      D3: D3_PROFICIENT.map(s => ({ ...s, id: `pa-${++_id}` })),
      D4: D4_PROFICIENT.map(s => ({ ...s, id: `pa-${++_id}` })),
      D5: D5_PROFICIENT.map(s => ({ ...s, id: `pa-${++_id}` })),
      D6: EDGE_INSUFFICIENT.map(s => ({ ...s, id: `pa-${++_id}` })),
    },
  };
}

/** Two dimensions insufficient — incomplete (§6.3) */
export function incompleteAssessment() {
  resetIds();
  return {
    dimensions: {
      D1: D1_PROFICIENT.map(s => ({ ...s, id: `ia-${++_id}` })),
      D2: D2_PROFICIENT.map(s => ({ ...s, id: `ia-${++_id}` })),
      D3: D3_PROFICIENT.map(s => ({ ...s, id: `ia-${++_id}` })),
      D4: D4_PROFICIENT.map(s => ({ ...s, id: `ia-${++_id}` })),
      D5: EDGE_INSUFFICIENT.map(s => ({ ...s, id: `ia-${++_id}` })),
      D6: EDGE_INSUFFICIENT.map(s => ({ ...s, id: `ia-${++_id}` })),
    },
  };
}

/** Cross-dimension contradiction fixture */
export function contradictionAssessment() {
  resetIds();
  const d1Signals = [
    sig('S3', 1.5, 'proficient', { excerpt: 'We measure outcomes linked to mission', anchor: 'outcome-goals' }),
    sig('S4', 1.0, 'proficient', { anchor: 'a2' }),
    sig('S2', 1.0, 'developing'),
  ];
  // Re-assign ids after creation
  d1Signals[0].id = 'contra-d1-s1';
  d1Signals[1].id = 'contra-d1-s2';
  d1Signals[2].id = 'contra-d1-s3';

  const d4Signals = [
    sig('S3', 1.0, 'proficient', { excerpt: 'We only track hours really', anchor: 'perf-a1' }),
    sig('S4', 1.0, 'proficient', { anchor: 'perf-a2' }),
    sig('S2', 1.0, 'developing'),
  ];
  d4Signals[0].id = 'contra-d4-s1';
  d4Signals[1].id = 'contra-d4-s2';
  d4Signals[2].id = 'contra-d4-s3';

  return {
    dimensions: {
      D1: d1Signals,
      D2: D2_PROFICIENT.map(s => ({ ...s, id: `ca-${++_id}` })),
      D3: D3_PROFICIENT.map(s => ({ ...s, id: `ca-${++_id}` })),
      D4: d4Signals,
      D5: D5_PROFICIENT.map(s => ({ ...s, id: `ca-${++_id}` })),
      D6: D6_PROFICIENT.map(s => ({ ...s, id: `ca-${++_id}` })),
    },
    contradictions: [
      { signalIds: ['contra-d1-s1', 'contra-d4-s1'] },
    ],
  };
}
