/**
 * Volo Index — Deterministic Signal Validator (P0)
 *
 * Validates extracted candidate signals before they reach the scoring engine.
 * Enforces:
 * - Schema: required fields, enum ranges, types
 * - §3/§5 consistency: strength/type/anchorTier relationships
 * - evidenceRef required on every signal (auditability, §9)
 * - Dedup: reject duplicate signals (same dimension + type + evidenceRef.turnIndex + spanText)
 *
 * Malformed input is rejected with typed ValidationError objects.
 * LLMs propose, deterministic code disposes.
 */

import {
  SIGNAL_TYPES, STRENGTH_LABELS, STRENGTH_VALUES,
  CANDIDATE_SIGNAL_SCHEMA, ASSESSMENT_TRANSCRIPT_SCHEMA,
} from './schemas.js';
import { DIMENSION_IDS, TIER_ORDER } from '../scoring/config.js';

// ── Error types ─────────────────────────────────────────────────────

/**
 * @typedef {Object} ValidationError
 * @property {string} code      - Machine-readable error code
 * @property {string} message   - Human-readable description
 * @property {string} [signalId] - Which signal caused it (if applicable)
 * @property {string} [field]   - Which field is invalid
 */

/** Standard error codes */
export const ErrorCodes = {
  MISSING_FIELD:        'MISSING_FIELD',
  INVALID_TYPE:         'INVALID_TYPE',
  INVALID_ENUM:         'INVALID_ENUM',
  INVALID_RANGE:        'INVALID_RANGE',
  STRENGTH_MISMATCH:    'STRENGTH_MISMATCH',
  TIER_TYPE_MISMATCH:   'TIER_TYPE_MISMATCH',
  MISSING_EVIDENCE_REF: 'MISSING_EVIDENCE_REF',
  INVALID_EVIDENCE_REF: 'INVALID_EVIDENCE_REF',
  DUPLICATE_SIGNAL:     'DUPLICATE_SIGNAL',
  INVALID_TRANSCRIPT:   'INVALID_TRANSCRIPT',
  EVIDENCE_OUT_OF_RANGE:'EVIDENCE_OUT_OF_RANGE',
};

// ── §3 / §5 consistency rules ───────────────────────────────────────

/**
 * Signal type → minimum anchor tier where it is meaningful (§3 "Gates Entry To").
 * S1 (Recall) has no tier gate; N has no tier gate.
 * S2 gates Developing, S3/S4 gate Proficient, S5/S6 gate Expert.
 */
const TYPE_MIN_ANCHOR_TIER = {
  S1: 0, // foundational
  S2: 1, // developing
  S3: 2, // proficient
  S4: 2, // proficient
  S5: 3, // expert
  S6: 3, // expert
  N:  0, // any tier
};

// ── Validator ────────────────────────────────────────────────────────

/**
 * Validate an array of candidate signals against the assessment transcript.
 *
 * @param {import('./schemas.js').CandidateSignal[]} signals
 * @param {import('./schemas.js').AssessmentTranscript} [transcript] - If provided, evidenceRef bounds are checked
 * @returns {{ valid: import('./schemas.js').CandidateSignal[], errors: ValidationError[] }}
 */
export function validateSignals(signals, transcript) {
  const errors = [];
  const valid = [];
  const seen = new Set();

  // Validate transcript if provided
  if (transcript) {
    const tErr = validateTranscript(transcript);
    if (tErr.length > 0) {
      return { valid: [], errors: tErr };
    }
  }

  if (!Array.isArray(signals)) {
    errors.push({ code: ErrorCodes.INVALID_TYPE, message: 'signals must be an array', field: 'signals' });
    return { valid, errors };
  }

  for (const signal of signals) {
    const sigErrors = validateOneSignal(signal, transcript, seen);
    if (sigErrors.length === 0) {
      // Build dedup key and check
      const dedupKey = `${signal.dimension}|${signal.type}|${signal.evidenceRef.turnIndex}|${signal.evidenceRef.spanText}`;
      if (seen.has(dedupKey)) {
        errors.push({
          code: ErrorCodes.DUPLICATE_SIGNAL,
          message: `Duplicate signal: same dimension, type, and evidence span`,
          signalId: signal.id,
        });
      } else {
        seen.add(dedupKey);
        valid.push(signal);
      }
    } else {
      errors.push(...sigErrors);
    }
  }

  return { valid, errors };
}

/**
 * Validate a single signal object.
 * @returns {ValidationError[]}
 */
function validateOneSignal(signal, transcript, seen) {
  const errors = [];
  const sid = signal?.id ?? '(unknown)';

  if (!signal || typeof signal !== 'object') {
    errors.push({ code: ErrorCodes.INVALID_TYPE, message: 'Signal must be an object', signalId: sid });
    return errors;
  }

  // Required fields
  for (const field of CANDIDATE_SIGNAL_SCHEMA.required) {
    if (signal[field] === undefined || signal[field] === null) {
      errors.push({ code: ErrorCodes.MISSING_FIELD, message: `Missing required field: ${field}`, signalId: sid, field });
    }
  }

  // If critical fields are missing, no point continuing
  if (errors.length > 0) return errors;

  // id: string
  if (typeof signal.id !== 'string' || signal.id.length === 0) {
    errors.push({ code: ErrorCodes.INVALID_TYPE, message: 'id must be a non-empty string', signalId: sid, field: 'id' });
  }

  // dimension: D1–D6
  if (!DIMENSION_IDS.includes(signal.dimension)) {
    errors.push({ code: ErrorCodes.INVALID_ENUM, message: `dimension must be one of ${DIMENSION_IDS.join(', ')}`, signalId: sid, field: 'dimension' });
  }

  // type: S1–S6 or N
  if (!SIGNAL_TYPES.includes(signal.type)) {
    errors.push({ code: ErrorCodes.INVALID_ENUM, message: `type must be one of ${SIGNAL_TYPES.join(', ')}`, signalId: sid, field: 'type' });
  }

  // strengthLabel: weak|clear|strong
  if (!STRENGTH_LABELS.includes(signal.strengthLabel)) {
    errors.push({ code: ErrorCodes.INVALID_ENUM, message: `strengthLabel must be one of ${STRENGTH_LABELS.join(', ')}`, signalId: sid, field: 'strengthLabel' });
  }

  // strength: 0.5|1.0|1.5
  if (![0.5, 1.0, 1.5].includes(signal.strength)) {
    errors.push({ code: ErrorCodes.INVALID_ENUM, message: 'strength must be 0.5, 1.0, or 1.5', signalId: sid, field: 'strength' });
  }

  // strength ↔ strengthLabel consistency
  if (STRENGTH_LABELS.includes(signal.strengthLabel) && [0.5, 1.0, 1.5].includes(signal.strength)) {
    if (STRENGTH_VALUES[signal.strengthLabel] !== signal.strength) {
      errors.push({
        code: ErrorCodes.STRENGTH_MISMATCH,
        message: `strengthLabel "${signal.strengthLabel}" (${STRENGTH_VALUES[signal.strengthLabel]}) does not match strength ${signal.strength}`,
        signalId: sid,
        field: 'strength',
      });
    }
  }

  // anchorTier: valid tier
  if (!TIER_ORDER.includes(signal.anchorTier)) {
    errors.push({ code: ErrorCodes.INVALID_ENUM, message: `anchorTier must be one of ${TIER_ORDER.join(', ')}`, signalId: sid, field: 'anchorTier' });
  }

  // §3/§5 consistency: signal type should match a tier at or above its gate
  if (SIGNAL_TYPES.includes(signal.type) && TIER_ORDER.includes(signal.anchorTier)) {
    const anchorIdx = TIER_ORDER.indexOf(signal.anchorTier);
    const minIdx = TYPE_MIN_ANCHOR_TIER[signal.type];
    if (minIdx !== undefined && anchorIdx < minIdx) {
      errors.push({
        code: ErrorCodes.TIER_TYPE_MISMATCH,
        message: `Signal type ${signal.type} gates entry to ${TIER_ORDER[minIdx]}; anchorTier "${signal.anchorTier}" is below that`,
        signalId: sid,
        field: 'anchorTier',
      });
    }
  }

  // corrected: boolean
  if (typeof signal.corrected !== 'boolean') {
    errors.push({ code: ErrorCodes.INVALID_TYPE, message: 'corrected must be a boolean', signalId: sid, field: 'corrected' });
  }

  // evidenceRef: required object with turnIndex + spanText
  if (!signal.evidenceRef || typeof signal.evidenceRef !== 'object') {
    errors.push({ code: ErrorCodes.MISSING_EVIDENCE_REF, message: 'evidenceRef is required and must be an object', signalId: sid, field: 'evidenceRef' });
  } else {
    if (typeof signal.evidenceRef.turnIndex !== 'number' || !Number.isInteger(signal.evidenceRef.turnIndex) || signal.evidenceRef.turnIndex < 0) {
      errors.push({ code: ErrorCodes.INVALID_EVIDENCE_REF, message: 'evidenceRef.turnIndex must be a non-negative integer', signalId: sid, field: 'evidenceRef.turnIndex' });
    }
    if (typeof signal.evidenceRef.spanText !== 'string' || signal.evidenceRef.spanText.length === 0) {
      errors.push({ code: ErrorCodes.INVALID_EVIDENCE_REF, message: 'evidenceRef.spanText must be a non-empty string', signalId: sid, field: 'evidenceRef.spanText' });
    }

    // If transcript provided, check turnIndex bounds
    if (transcript && typeof signal.evidenceRef.turnIndex === 'number') {
      if (signal.evidenceRef.turnIndex >= transcript.turns.length) {
        errors.push({
          code: ErrorCodes.EVIDENCE_OUT_OF_RANGE,
          message: `evidenceRef.turnIndex ${signal.evidenceRef.turnIndex} exceeds transcript length (${transcript.turns.length} turns)`,
          signalId: sid,
          field: 'evidenceRef.turnIndex',
        });
      }
    }
  }

  return errors;
}

/**
 * Basic transcript structure validation.
 * @param {import('./schemas.js').AssessmentTranscript} transcript
 * @returns {ValidationError[]}
 */
function validateTranscript(transcript) {
  const errors = [];

  if (!transcript || typeof transcript !== 'object') {
    errors.push({ code: ErrorCodes.INVALID_TRANSCRIPT, message: 'Transcript must be an object' });
    return errors;
  }

  for (const field of ASSESSMENT_TRANSCRIPT_SCHEMA.required) {
    if (transcript[field] === undefined || transcript[field] === null) {
      errors.push({ code: ErrorCodes.INVALID_TRANSCRIPT, message: `Transcript missing required field: ${field}`, field });
    }
  }

  if (transcript.turns !== undefined) {
    if (!Array.isArray(transcript.turns)) {
      errors.push({ code: ErrorCodes.INVALID_TRANSCRIPT, message: 'Transcript turns must be an array', field: 'turns' });
    } else if (transcript.turns.length === 0) {
      errors.push({ code: ErrorCodes.INVALID_TRANSCRIPT, message: 'Transcript must have at least one turn', field: 'turns' });
    }
  }

  return errors;
}
