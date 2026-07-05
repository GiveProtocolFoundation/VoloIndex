/**
 * Volo Index Scoring Engine v1.2
 *
 * Pure, deterministic: signals in → scores out.
 * Implements §5 (per-dimension), §6 (aggregation), §7 (integrity checks)
 * of docs/SCORING_RUBRIC.md (v1.2 = v1.1 R1–R7 + BUG-001 §5.5 ruling).
 */

import {
  TIERS, TIER_ORDER, TIER_BY_ID, K_VALUES, Q_VALUES,
  CLEAR_THRESHOLD, TIER_REQUIREMENTS, MIN_TIER_ANCHOR_SIGNALS,
  EXPERT_GATING, RED_FLAG_HARD_CAP_COUNT, RED_FLAG_HARD_CAP_SCORE,
  MIN_SIGNALS_FOR_SCORING, RECALL_INFLATION, UNIFORM_MAX_THRESHOLD,
  OVERALL_EXPERT_CONSTRAINT, MAX_INSUFFICIENT_FOR_PARTIAL,
  DIMENSIONS, DIMENSION_IDS, RUBRIC_VERSION, STRENGTH,
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

/**
 * v1.1 (R2): position = min(1, max(0, (Σ − Q) / (K − Q))) so the
 * qualifying minimum maps to tier_min and the full tier range is reachable.
 * Returns { score, evidenceDensity } (§8 R4).
 */
function positionScore(signals, baseTierId) {
  const baseTierIdx = tierIndex(baseTierId);
  const tier = TIER_BY_ID[baseTierId];
  const K = K_VALUES[baseTierId];
  const Q = Q_VALUES[baseTierId];

  // Sum signal strengths at base tier and above (only positive signals)
  const sumStrength = signals
    .filter(s => s.type !== 'N' && tierIndex(s.anchorTier) >= baseTierIdx)
    .reduce((sum, s) => sum + s.strength, 0);

  const position = Math.min(1.0, Math.max(0, (sumStrength - Q) / (K - Q)));
  const raw = tier.min + position * (tier.max - tier.min);
  return {
    score: round1(raw),
    evidenceDensity: {
      sumStrength,
      K,
      Q,
      position: Math.round(position * 1000) / 1000,
    },
  };
}

// ── §5.3  Expert gating ─────────────────────────────────────────────

function applyExpertGating(score, signals, appliedCaps) {
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
    appliedCaps.push({
      rule: '§5.3',
      capValue: EXPERT_GATING.scoreThreshold,
      reason: `expert-breadth-cap: score >${EXPERT_GATING.scoreThreshold} requires strong signals in ≥${EXPERT_GATING.requiredDistinctAnchors} distinct Expert anchor behaviors (found ${strongExpertAnchors.size})`,
    });
    return EXPERT_GATING.scoreThreshold;
  }
  return score;
}

// ── §5.4  Red-flag caps ─────────────────────────────────────────────

/**
 * v1.1 (R1): with n uncorrected N signals at clear+, the cap is the midpoint
 * of the tier n steps below the base tier (floor 1.0). Additionally, ≥2
 * uncorrected N cap the dimension at Developing (≤5.5). The applied cap is
 * the LOWEST of all triggered caps (monotonic guarantee).
 */
function applyRedFlagCaps(score, signals, baseTierId, appliedCaps) {
  const uncorrectedN = signals.filter(
    s => s.type === 'N' && s.strength >= CLEAR_THRESHOLD && !s.corrected
  );
  const n = uncorrectedN.length;
  if (n === 0) return score;

  const triggeredCaps = [];

  // Monotonic cap: midpoint of the tier n steps below base (floor 1.0)
  const belowIdx = tierIndex(baseTierId) - n;
  if (belowIdx >= 0) {
    const belowTierId = TIER_ORDER[belowIdx];
    triggeredCaps.push({
      capValue: tierMidpoint(belowTierId),
      reason: `${n} uncorrected red flag${n > 1 ? 's' : ''}: midpoint of tier ${n} step${n > 1 ? 's' : ''} below base (${TIER_BY_ID[belowTierId].label})`,
    });
  } else {
    triggeredCaps.push({
      capValue: 1.0,
      reason: `${n} uncorrected red flag${n > 1 ? 's' : ''}: tier ${n} step${n > 1 ? 's' : ''} below base is under the scale — floor 1.0`,
    });
  }

  // ≥2 uncorrected N: hard cap at Developing max
  if (n >= RED_FLAG_HARD_CAP_COUNT) {
    triggeredCaps.push({
      capValue: RED_FLAG_HARD_CAP_SCORE,
      reason: `≥${RED_FLAG_HARD_CAP_COUNT} uncorrected red flags: capped at Developing (≤${RED_FLAG_HARD_CAP_SCORE})`,
    });
  }

  // Lowest of all triggered caps wins
  const lowest = triggeredCaps.reduce((a, b) => (b.capValue < a.capValue ? b : a));
  if (lowest.capValue < score) {
    appliedCaps.push({ rule: '§5.4', capValue: lowest.capValue, reason: lowest.reason });
  }
  return Math.min(score, lowest.capValue);
}

// ── §7  Recall inflation ────────────────────────────────────────────

/**
 * v1.1 (R3): fires when the dimension qualifies Developing+ but has
 * ≥4 S1, exactly one clear S2, and no S2/S3+ signal at strong.
 * Returns trigger metadata or null. Pure — shared by the per-dimension
 * cap (§7 action) and the assessment-level integrity flag.
 */
function checkRecallInflation(signals, baseTierId) {
  if (tierIndex(baseTierId) < tierIndex('developing')) return null;

  const s1 = signals.filter(s => s.type === 'S1');
  if (s1.length < RECALL_INFLATION.minS1Count) return null;

  const clearS2 = signals.filter(
    s => s.type === 'S2' && s.strength >= CLEAR_THRESHOLD
  );
  if (clearS2.length !== RECALL_INFLATION.requiredClearS2Count) return null;

  const strongHigherOrder = signals.filter(
    s => s.type !== 'N' && s.type !== 'S1' && s.strength >= STRENGTH.strong
  );
  if (strongHigherOrder.length > 0) return null;

  return {
    s1Count: s1.length,
    signalIds: [...s1, ...clearS2].map(s => s.id).filter(Boolean),
  };
}

// ── §5 complete: score one dimension ────────────────────────────────

function scoreDimension(dimId, dimName, rawSignals) {
  // §5.5 insufficient evidence — BUG-001 ruling (2026-07-04, Head of Data):
  // ALL recorded signals count toward the minimum, including N red flags
  // (any strength, corrected or not). An observed misconception is decisive
  // evidence and must never be suppressed as "insufficient".
  if (rawSignals.length < MIN_SIGNALS_FOR_SCORING) {
    return {
      id: dimId,
      name: dimName,
      score: null,
      tier: null,
      baseTier: null,
      evidenceDensity: null,
      signals: rawSignals.map(outputSignal),
      redFlags: rawSignals.filter(s => s.type === 'N').map(outputSignal),
      appliedCaps: [],
      insufficientEvidence: true,
    };
  }

  // §5.1
  const baseTierId = baseTierPlacement(rawSignals);
  const baseTier = TIER_BY_ID[baseTierId];

  // §8 (R4): every cap applied from §5.3/§5.4/§7 is recorded here
  const appliedCaps = [];

  // §5.2
  const { score: rawScore, evidenceDensity } = positionScore(rawSignals, baseTierId);
  let score = rawScore;

  // §5.3 expert gating
  score = applyExpertGating(score, rawSignals, appliedCaps);

  // §5.4 red-flag caps
  score = applyRedFlagCaps(score, rawSignals, baseTierId, appliedCaps);

  // §7 recall inflation (R3)
  const recallInflation = checkRecallInflation(rawSignals, baseTierId);
  if (recallInflation && RECALL_INFLATION.capScore < score) {
    appliedCaps.push({
      rule: '§7',
      capValue: RECALL_INFLATION.capScore,
      reason: `recall_inflation: ≥${RECALL_INFLATION.minS1Count} S1 with exactly one clear S2 and no strong S2/S3+ — capped at Developing lower third`,
    });
    score = RECALL_INFLATION.capScore;
  }

  const finalTier = tierFor(score);

  return {
    id: dimId,
    name: dimName,
    score,
    tier: finalTier.label,
    baseTier: baseTier.label,
    evidenceDensity,
    signals: rawSignals.filter(s => s.type !== 'N').map(outputSignal),
    redFlags: rawSignals.filter(s => s.type === 'N').map(outputSignal),
    appliedCaps,
    insufficientEvidence: false,
  };
}

function outputSignal(s) {
  const out = { type: s.type, strength: s.strength };
  // §8 (R4): each signal records its classified tier so §5.2 is reproducible
  out.tier = TIER_BY_ID[s.anchorTier]?.label ?? null;
  if (s.excerpt != null) out.excerpt = s.excerpt;
  if (s.anchor != null) out.anchor = s.anchor;
  if (s._downgraded) {
    out.downgraded = true;
    out.originalType = s._originalType;
  }
  if (s._contradicted) out.contradicted = true;
  // §8 (R4): red flags always carry an explicit corrected boolean
  if (s.type === 'N') out.corrected = !!s.corrected;
  else if (s.corrected) out.corrected = true;
  return out;
}

// ── §6  Aggregation ─────────────────────────────────────────────────

function aggregate(dimensionResults) {
  const scored = dimensionResults.filter(d => !d.insufficientEvidence);
  const insufficientCount = dimensionResults.length - scored.length;

  // §6.3 — ≥2 insufficient → incomplete
  if (insufficientCount > MAX_INSUFFICIENT_FOR_PARTIAL) {
    return { score: null, tier: null, partial: false, capped: false, capReason: null, incomplete: true };
  }

  if (scored.length === 0) {
    return { score: null, tier: null, partial: false, capped: false, capReason: null, incomplete: true };
  }

  const partial = insufficientCount > 0;
  const mean = round1(scored.reduce((s, d) => s + d.score, 0) / scored.length);

  // §6.4 overall-tier Expert constraint
  let capped = false;
  let capReason = null;
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
      capReason = `§6.4: overall in Expert range requires ≥${OVERALL_EXPERT_CONSTRAINT.minProficientPlus} Proficient+ dimensions and ≥${OVERALL_EXPERT_CONSTRAINT.minExpert} Expert dimensions (have ${proficientPlusCount} Proficient+, ${expertCount} Expert) — capped at ${OVERALL_EXPERT_CONSTRAINT.capScore}`;
    }
  }

  const finalTier = tierFor(overallScore);
  return {
    score: overallScore,
    tier: finalTier.label,
    partial,
    capped,
    capReason,
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
        signalIds: downgraded.map(s => s.id).filter(Boolean),
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

  // §7 recall inflation flags (v1.1 R3)
  for (const dim of dimensionResults) {
    if (!dim.insufficientEvidence) {
      const signals = dimensionSignals[dim.id] || [];
      const trigger = checkRecallInflation(signals, baseTierPlacement(signals));
      if (trigger) {
        integrityFlags.push({
          rule: 'recall_inflation',
          dimension: dim.id,
          s1Count: trigger.s1Count,
          signalIds: trigger.signalIds,
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
