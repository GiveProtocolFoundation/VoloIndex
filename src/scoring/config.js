/**
 * Volo Index Scoring Configuration v1.0
 *
 * All parameterized constants from the scoring rubric.
 * Change these for config-level adjustments without rewriting engine logic.
 */

/** Tier definitions with inclusive boundaries per §2 */
export const TIERS = [
  { id: 'foundational', label: 'Foundational', min: 1.0, max: 3.0 },
  { id: 'developing',   label: 'Developing',   min: 3.1, max: 5.5 },
  { id: 'proficient',   label: 'Proficient',   min: 5.6, max: 7.5 },
  { id: 'expert',       label: 'Expert',        min: 7.6, max: 10.0 },
];

/** Ordered tier ids (lowest to highest) */
export const TIER_ORDER = TIERS.map(t => t.id);

/** Lookup tier config by id */
export const TIER_BY_ID = Object.fromEntries(TIERS.map(t => [t.id, t]));

/** Evidence saturation constant K per tier (§5.2) */
export const K_VALUES = {
  foundational: 4.0,
  developing:   4.0,
  proficient:   5.0,
  expert:       6.0,
};

/** Signal strength values (§3) */
export const STRENGTH = {
  weak:   0.5,
  clear:  1.0,
  strong: 1.5,
};

/** Minimum strength to be "clear-or-stronger" (§5.1) */
export const CLEAR_THRESHOLD = STRENGTH.clear;

/**
 * Required signal types per tier for base-tier qualification (§5.1).
 * Each entry is an array of requirements; each requirement is { types, minCount, minStrength? }.
 * All requirements must be met.
 */
export const TIER_REQUIREMENTS = {
  foundational: [],
  developing: [
    { types: ['S2'], minCount: 1 },
  ],
  proficient: [
    // ≥1 S3 AND (≥1 S4 or a second distinct S3)
    // Modeled as: ≥1 S3 required, plus ≥1 of (S3 or S4) beyond the first S3
    { types: ['S3'], minCount: 1 },
    { types: ['S3', 'S4'], minCount: 2, note: '≥1 S3 + (≥1 S4 or second S3)' },
  ],
  expert: [
    { types: ['S5'], minCount: 1, minStrength: STRENGTH.clear },
    { types: ['S6'], minCount: 1, minStrength: STRENGTH.clear },
  ],
};

/** Minimum clear-or-stronger signals matching tier anchors (§5.1) */
export const MIN_TIER_ANCHOR_SIGNALS = 2;

/** Expert gating threshold and breadth requirement (§5.3) */
export const EXPERT_GATING = {
  scoreThreshold: 8.5,
  requiredStrength: STRENGTH.strong,
  requiredDistinctAnchors: 3,
};

/** Red-flag cap: max uncorrected before hard cap (§5.4) */
export const RED_FLAG_HARD_CAP_COUNT = 2;
export const RED_FLAG_HARD_CAP_SCORE = 5.5;

/** Minimum signals per dimension before "insufficient evidence" (§5.5) */
export const MIN_SIGNALS_FOR_SCORING = 3;

/** Recall inflation: cap when ≥ N S1 and zero S2 (§7.1) */
export const RECALL_INFLATION = {
  minS1Count: 4,
  capScore: 4.3,
};

/** Uniform maximum: hold for review when all 6 dims ≥ threshold (§7.4) */
export const UNIFORM_MAX_THRESHOLD = 9.0;

/** §6.4 overall-tier Expert constraint */
export const OVERALL_EXPERT_CONSTRAINT = {
  minProficientPlus: 4,
  minExpert: 2,
  capScore: 7.5,
};

/** Maximum allowed insufficient-evidence dimensions before assessment is incomplete (§6.3) */
export const MAX_INSUFFICIENT_FOR_PARTIAL = 1;

/** Dimension definitions (§4 order) */
export const DIMENSIONS = [
  { id: 'D1', name: 'Strategic Engagement Design' },
  { id: 'D2', name: 'Recruitment, Matching & Onboarding' },
  { id: 'D3', name: 'Training, Development & Role Support' },
  { id: 'D4', name: 'Performance, Impact & Accountability' },
  { id: 'D5', name: 'Recognition, Retention & Culture' },
  { id: 'D6', name: 'Ethics, Equity & Advocacy' },
];

export const DIMENSION_IDS = DIMENSIONS.map(d => d.id);

export const RUBRIC_VERSION = '1.0';
