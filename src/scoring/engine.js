/**
 * Volo Index Scoring Engine v1.0
 *
 * Pure, deterministic: signals in → scores out.
 * Implements §5 (per-dimension), §6 (aggregation), §7 (integrity checks)
 * of docs/SCORING_RUBRIC.md.
 */

import {
  TIERS, TIER_ORDER, TIER_BY_ID, K_VALUES,
  CLEAR_THRESHOLD, TIER_REQUIREMENTS, MIN_TIER_ANCHOR_SIGNALS,
  EXPERT_GATING, RED_FLAG_HARD_CAP_COUNT, RED_FLAG_HARD_CAP_SCORE,
  MIN_SIGNALS_FOR_SCORING, RECALL_INFLATION, UNIFORM_MAX_THRESHOLD,
  OVERALL_EXPERT_CONSTRAINT, MAX_INSUFFICIENT_FOR_PARTIAL,
  DIMENSIONS, DIMENSION_IDS, RUBRIC_VERSION,
} from './config.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Round to one decimal place */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Get tier index (0-based, lowest first) */
function tierIndex(tierId) {
  const idx = TIER_ORDER.indexOf(tierId);
  if (idx === -1) throw new Error(`Unknown tier: ${tierId}`);
  return idx;
}

/** Derive tier label from a numeric score using §2 boundaries */
export function tierFor(score) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (score >= TIERS[i].min) return TIERS[i];
  }
  return TIERS[0];
}

/** Midpoint of a tier range, rounded to 1 decimal */
function tierMidpoint(tierId) {
  const t = TIER_BY_ID[tierId];
  return round1((t.min + t.max) / 2);
}

// ── §7.3  Generic answer detection (pre-processing) ─────────────────

/**
 * Downgrade signals lacking first-person specificity from S2+ to S1.
 * Mutates nothing; returns a new array.
 */
function applyGenericAnswerDetection(signals) {
  return signals.map(s => {
    if (s.type === 'N') return s;
    const typeNum = parseInt(s.type.slice(1), 10);
    if (typeNum >= 2 && s.hasFirstPersonSpecificity === false) {
      return { ...s, type: 'S1', _downgraded: true, _originalType: s.type };
    }
    return s;
  });
}

// ── §7.2  Cross-dimension contradiction ─────────────────────────────

/**
 * Process contradictions: for each contradiction group, downgrade all
 * member signals to the minimum strength in the group.
 * Returns { signals (Map<dimId, signal[]>), flags }.
 */
function applyContradictions(dimensionSignals, contradictions) {
  if (!contradictions || contradictions.length === 0) {
    return { dimensionSignals, flags: [] };
  }

  // Build signal lookup by id across all dimensions
  const signalById = new Map();
  const dimBySignalId = new Map();
  for (const [dimId, signals] of Object.entries(dimensionSignals)) {
    for (const s of signals) {
      if (s.id) {
        signalById.set(s.id, s);
        dimBySignalId.set(s.id, dimId);
      }
    }
  }

  const flags = [];
  // Deep copy dimension signals
  const result = {};
  for (const [dimId, signals] of Object.entries(dimensionSignals)) {
    result[dimId] = signals.map(s => ({ ...s }));
  }

  // Re-build lookup on copied signals
  const copiedById = new Map();
  for (const [dimId, signals] of Object.entries(result)) {
    for (const s of signals) {
      if (s.id) copiedById.set(s.id, s);
    }
  }

  for (const contradiction of contradictions) {
    const ids = contradiction.signalIds || [];
    const strengths = ids
      .map(id => copiedById.get(id))
      .filter(Boolean)
      .map(s => s.strength);
    if (strengths.length < 2) continue;

    const minStrength = Math.min(...strengths);
    const affectedDims = new Set();
    for (const id of ids) {
      const s = copiedById.get(id);
      if (s) {
        s.strength = minStrength;
        s._contradicted = true;
        const dim = dimBySignalId.get(id);
        if (dim) affectedDims.add(dim);
      }
    }

    flags.push({
      rule: 'cross_dimension_contradiction',
      dimensions: [...affectedDims],
      signalIds: ids,
      appliedStrength: minStrength,
    });
  }

  return { dimensionSignals: result, flags };
}

// ── §5.1  Base tier placement ───────────────────────────────────────

function baseTierPlacement(signals) {
  // Only non-N signals for tier placement
  const positive = signals.filter(s => s.type !== 'N');

  // Try from highest tier downward
  for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
    const tierId = TIER_ORDER[i];
    if (tierId === 'foundational') return 'foundational'; // always qualifies

    // Check ≥ MIN_TIER_ANCHOR_SIGNALS clear-or-stronger signals matching tier anchors
    const tierSignals = positive.filter(
      s => s.anchorTier === tierId && s.strength >= CLEAR_THRESHOLD
    );
    if (tierSignals.length < MIN_TIER_ANCHOR_SIGNALS) continue;

    // Check required signal types
    const requirements = TIER_REQUIREMENTS[tierId];
    if (!checkRequirements(positive, requirements)) continue;

    return tierId;
  }
  return 'foundational';
}

function checkRequirements(signals, requirements) {
  for (const req of requirements) {
    const minStrength = req.minStrength || 0;
    const matching = signals.filter(
      s => req.types.includes(s.type) && s.strength >= minStrength
    );
    if (matching.length < req.minCount) return false;
  }
  return true;
}

// ── §5.2  Position within tier ──────────────────────────────────────

function positionScore(signals, baseTierId) {
  const baseTierIdx = tierIndex(baseTierId);
  const tier = TIER_BY_ID[baseTierId];
  const K = K_VALUES[baseTierId];

  // Sum signal strengths at base tier and above (only positive signals)
  const relevantStrength = signals
    .filter(s => s.type !== 'N' && tierIndex(s.anchorTier) >= baseTierIdx)
    .reduce((sum, s) => sum + s.strength, 0);

  const position = Math.min(1.0, relevantStrength / K);
  const raw = tier.min + position * (tier.max - tier.min);
  return round1(raw);
}

// ── §5.3  Expert gating ─────────────────────────────────────────────

function applyExpertGating(score, signals) {
  if (score <= EXPERT_GATING.scoreThreshold) return score;

  const strongExpertAnchors = new Set();
  for (const s of signals) {
    if (
      s.type !== 'N' &&
      s.anchorTier === 'expert' &&
      s.strength >= EXPERT_GATING.requiredStrength &&
      s.anchor
    ) {
      strongExpertAnchors.add(s.anchor);
    }
  }

  if (strongExpertAnchors.size < EXPERT_GATING.requiredDistinctAnchors) {
    return EXPERT_GATING.scoreThreshold;
  }
  return score;
}

// ── §5.4  Red-flag caps ─────────────────────────────────────────────

function applyRedFlagCaps(score, signals, baseTierId) {
  const uncorrectedN = signals.filter(
    s => s.type === 'N' && s.strength >= CLEAR_THRESHOLD && !s.corrected
  );

  if (uncorrectedN.length === 0) return score;

  // ≥2 uncorrected N: hard cap at Developing max
  if (uncorrectedN.length >= RED_FLAG_HARD_CAP_COUNT) {
    return Math.min(score, RED_FLAG_HARD_CAP_SCORE);
  }

  // 1 uncorrected N: cap at midpoint of tier below base
  const baseTierIdx = tierIndex(baseTierId);
  if (baseTierIdx === 0) {
    // Already foundational — cap at minimum score
    return Math.min(score, 1.0);
  }
  const belowTierId = TIER_ORDER[baseTierIdx - 1];
  const capScore = tierMidpoint(belowTierId);
  return Math.min(score, capScore);
}

// ── §7.1  Recall inflation ──────────────────────────────────────────

function applyRecallInflation(score, signals) {
  const s1Count = signals.filter(s => s.type === 'S1').length;
  const s2Count = signals.filter(s => s.type === 'S2').length;
  if (s1Count >= RECALL_INFLATION.minS1Count && s2Count === 0) {
    return Math.min(score, RECALL_INFLATION.capScore);
  }
  return score;
}

// ── §5 complete: score one dimension ────────────────────────────────

function scoreDimension(dimId, dimName, rawSignals) {
  // §5.5 insufficient evidence
  const positiveSignals = rawSignals.filter(s => s.type !== 'N');
  if (positiveSignals.length < MIN_SIGNALS_FOR_SCORING) {
    return {
      id: dimId,
      name: dimName,
      score: null,
      tier: null,
      baseTier: null,
      signals: rawSignals.map(outputSignal),
      redFlags: rawSignals.filter(s => s.type === 'N').map(outputSignal),
      insufficientEvidence: true,
    };
  }

  // §5.1
  const baseTierId = baseTierPlacement(rawSignals);
  const baseTier = TIER_BY_ID[baseTierId];

  // §5.2
  let score = positionScore(rawSignals, baseTierId);

  // §5.3 expert gating
  score = applyExpertGating(score, rawSignals);

  // §5.4 red-flag caps
  score = applyRedFlagCaps(score, rawSignals, baseTierId);

  // §7.1 recall inflation
  score = applyRecallInflation(score, rawSignals);

  const finalTier = tierFor(score);

  return {
    id: dimId,
    name: dimName,
    score,
    tier: finalTier.label,
    baseTier: baseTier.label,
    signals: rawSignals.filter(s => s.type !== 'N').map(outputSignal),
    redFlags: rawSignals.filter(s => s.type === 'N').map(outputSignal),
    insufficientEvidence: false,
  };
}

function outputSignal(s) {
  const out = { type: s.type, strength: s.strength };
  if (s.excerpt != null) out.excerpt = s.excerpt;
  if (s.anchor != null) out.anchor = s.anchor;
  if (s._downgraded) {
    out.downgraded = true;
    out.originalType = s._originalType;
  }
  if (s._contradicted) out.contradicted = true;
  if (s.corrected) out.corrected = true;
  return out;
}

// ── §6  Aggregation ─────────────────────────────────────────────────

function aggregate(dimensionResults) {
  const scored = dimensionResults.filter(d => !d.insufficientEvidence);
  const insufficientCount = dimensionResults.length - scored.length;

  // §6.3 — ≥2 insufficient → incomplete
  if (insufficientCount > MAX_INSUFFICIENT_FOR_PARTIAL) {
    return { score: null, tier: null, partial: false, capped: false, incomplete: true };
  }

  if (scored.length === 0) {
    return { score: null, tier: null, partial: false, capped: false, incomplete: true };
  }

  const partial = insufficientCount > 0;
  const mean = round1(scored.reduce((s, d) => s + d.score, 0) / scored.length);

  // §6.4 overall-tier Expert constraint
  let capped = false;
  let overallScore = mean;
  const tier = tierFor(overallScore);

  if (tier.id === 'expert') {
    const proficientPlusCount = scored.filter(d => {
      const t = tierFor(d.score);
      return t.id === 'proficient' || t.id === 'expert';
    }).length;
    const expertCount = scored.filter(d => tierFor(d.score).id === 'expert').length;

    if (
      proficientPlusCount < OVERALL_EXPERT_CONSTRAINT.minProficientPlus ||
      expertCount < OVERALL_EXPERT_CONSTRAINT.minExpert
    ) {
      overallScore = Math.min(overallScore, OVERALL_EXPERT_CONSTRAINT.capScore);
      capped = true;
    }
  }

  const finalTier = tierFor(overallScore);
  return {
    score: overallScore,
    tier: finalTier.label,
    partial,
    capped,
    incomplete: false,
  };
}

// ── §7.4  Uniform maximum ──────────────────────────────────────────

function checkUniformMaximum(dimensionResults) {
  const scored = dimensionResults.filter(d => !d.insufficientEvidence);
  if (scored.length < DIMENSIONS.length) return null;
  if (scored.every(d => d.score >= UNIFORM_MAX_THRESHOLD)) {
    return {
      rule: 'uniform_maximum',
      message: `All ${scored.length} dimensions scored ≥ ${UNIFORM_MAX_THRESHOLD}. Hold for review; require §5.3 breadth evidence in all six.`,
    };
  }
  return null;
}

// ── Main entry point ────────────────────────────────────────────────

/**
 * Score an assessment.
 *
 * @param {Object} input
 * @param {Object<string, Array>} input.dimensions  – keyed by D1–D6, each an array of signal objects
 *   Signal object: { id?, type: 'S1'|…|'S6'|'N', strength: 0.5|1.0|1.5,
 *     anchorTier: 'foundational'|'developing'|'proficient'|'expert',
 *     excerpt?: string, anchor?: string,
 *     hasFirstPersonSpecificity?: boolean, corrected?: boolean }
 * @param {Array} [input.contradictions] – [{ signalIds: string[] }]
 * @returns {Object} Output per §8
 */
export function scoreAssessment(input) {
  const integrityFlags = [];

  // §7.3 generic answer detection (pre-processing per dimension)
  let dimensionSignals = {};
  for (const dimId of DIMENSION_IDS) {
    const raw = input.dimensions?.[dimId] || [];
    dimensionSignals[dimId] = applyGenericAnswerDetection(raw);
  }

  // Track generic-answer downgrades
  for (const [dimId, signals] of Object.entries(dimensionSignals)) {
    const downgraded = signals.filter(s => s._downgraded);
    if (downgraded.length > 0) {
      integrityFlags.push({
        rule: 'generic_answer_detection',
        dimension: dimId,
        downgradedCount: downgraded.length,
      });
    }
  }

  // §7.2 cross-dimension contradictions
  const contradictionResult = applyContradictions(
    dimensionSignals,
    input.contradictions || []
  );
  dimensionSignals = contradictionResult.dimensionSignals;
  integrityFlags.push(...contradictionResult.flags);

  // §5 per-dimension scoring
  const dimensionResults = DIMENSIONS.map(dim =>
    scoreDimension(dim.id, dim.name, dimensionSignals[dim.id] || [])
  );

  // §7.1 recall inflation flags
  for (const dim of dimensionResults) {
    if (!dim.insufficientEvidence) {
      const signals = dimensionSignals[dim.id] || [];
      const s1Count = signals.filter(s => s.type === 'S1').length;
      const s2Count = signals.filter(s => s.type === 'S2').length;
      if (s1Count >= RECALL_INFLATION.minS1Count && s2Count === 0) {
        integrityFlags.push({
          rule: 'recall_inflation',
          dimension: dim.id,
          s1Count,
        });
      }
    }
  }

  // §7.4 uniform maximum
  const uniformFlag = checkUniformMaximum(dimensionResults);
  if (uniformFlag) integrityFlags.push(uniformFlag);

  // §6 aggregation
  const overall = aggregate(dimensionResults);

  return {
    rubricVersion: RUBRIC_VERSION,
    dimensions: dimensionResults,
    overall,
    integrityFlags,
  };
}
