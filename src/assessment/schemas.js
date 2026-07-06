/**
 * Volo Index — Assessment Engine Schemas (P0)
 *
 * JSON-schema-style validation objects and JSDoc types for:
 * (a) assessment transcripts
 * (b) candidate signals {dimension, type, strength, anchorTier, corrected, evidenceRef}
 *
 * These schemas are the contracts between the LLM extraction layer and the
 * deterministic validator / scoring engine.
 */

import { DIMENSION_IDS, TIER_ORDER } from '../scoring/config.js';

// ── Enum constants ──────────────────────────────────────────────────

export const SIGNAL_TYPES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'N'];
export const STRENGTH_LABELS = ['weak', 'clear', 'strong'];
export const STRENGTH_VALUES = { weak: 0.5, clear: 1.0, strong: 1.5 };

// ── JSDoc type definitions ──────────────────────────────────────────

/**
 * @typedef {Object} EvidenceRef
 * @property {number} turnIndex - Zero-based index into transcript.turns
 * @property {string} spanText  - The verbatim span from the candidate's response
 */

/**
 * @typedef {Object} CandidateSignal
 * @property {string}  id          - Unique signal identifier (e.g. "sig-D1-001")
 * @property {string}  dimension   - Dimension id: D1–D6
 * @property {'S1'|'S2'|'S3'|'S4'|'S5'|'S6'|'N'} type - Signal type per §3
 * @property {'weak'|'clear'|'strong'} strengthLabel - Human-readable strength
 * @property {0.5|1.0|1.5} strength - Numeric strength value
 * @property {'foundational'|'developing'|'proficient'|'expert'} anchorTier
 * @property {boolean} corrected   - True if candidate self-corrected (N only)
 * @property {EvidenceRef} evidenceRef - Traceability back to transcript span
 * @property {string} [excerpt]    - Short excerpt (may be same as spanText)
 * @property {string} [anchor]     - Named anchor behavior matched
 * @property {boolean} [hasFirstPersonSpecificity] - For §7.3 generic detection
 */

/**
 * @typedef {Object} TranscriptTurn
 * @property {'interviewer'|'candidate'} role
 * @property {string} content - The spoken/written content
 * @property {string} [dimension] - Which dimension this turn targets (interviewer turns)
 */

/**
 * @typedef {Object} AssessmentTranscript
 * @property {string}  id          - Unique assessment/session identifier
 * @property {string}  candidateId - Anonymized candidate identifier
 * @property {string}  startedAt   - ISO 8601 timestamp
 * @property {string}  [completedAt] - ISO 8601 timestamp
 * @property {TranscriptTurn[]} turns - Ordered conversation turns
 */

/**
 * @typedef {Object} ExtractionResult
 * @property {string} transcriptId - Links back to AssessmentTranscript.id
 * @property {CandidateSignal[]} signals - Extracted signals
 * @property {{ promptTokens: number, completionTokens: number }} usage
 */

// ── Schema objects (for runtime validation) ─────────────────────────

export const EVIDENCE_REF_SCHEMA = {
  type: 'object',
  required: ['turnIndex', 'spanText'],
  properties: {
    turnIndex: { type: 'integer', minimum: 0 },
    spanText:  { type: 'string', minLength: 1 },
  },
};

export const CANDIDATE_SIGNAL_SCHEMA = {
  type: 'object',
  required: ['id', 'dimension', 'type', 'strengthLabel', 'strength', 'anchorTier', 'corrected', 'evidenceRef'],
  properties: {
    id:            { type: 'string', minLength: 1 },
    dimension:     { type: 'string', enum: [...DIMENSION_IDS] },
    type:          { type: 'string', enum: SIGNAL_TYPES },
    strengthLabel: { type: 'string', enum: STRENGTH_LABELS },
    strength:      { type: 'number', enum: [0.5, 1.0, 1.5] },
    anchorTier:    { type: 'string', enum: [...TIER_ORDER] },
    corrected:     { type: 'boolean' },
    evidenceRef:   EVIDENCE_REF_SCHEMA,
    excerpt:       { type: 'string' },
    anchor:        { type: 'string' },
    hasFirstPersonSpecificity: { type: 'boolean' },
  },
};

export const TRANSCRIPT_TURN_SCHEMA = {
  type: 'object',
  required: ['role', 'content'],
  properties: {
    role:      { type: 'string', enum: ['interviewer', 'candidate'] },
    content:   { type: 'string', minLength: 1 },
    dimension: { type: 'string', enum: [...DIMENSION_IDS] },
  },
};

export const ASSESSMENT_TRANSCRIPT_SCHEMA = {
  type: 'object',
  required: ['id', 'candidateId', 'startedAt', 'turns'],
  properties: {
    id:          { type: 'string', minLength: 1 },
    candidateId: { type: 'string', minLength: 1 },
    startedAt:   { type: 'string', format: 'date-time' },
    completedAt: { type: 'string', format: 'date-time' },
    turns:       { type: 'array', items: TRANSCRIPT_TURN_SCHEMA, minItems: 1 },
  },
};
