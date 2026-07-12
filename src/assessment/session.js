/**
 * Volo Index — Assessment Session Manager (P2a)
 *
 * Manages the full assessment lifecycle and append-only transcript accumulation.
 * State machine: created → in_progress → completed | abandoned
 *
 * Design goals:
 * - JSON-serializable + resumable (toJSON / fromJSON round-trip)
 * - Append-only transcript: the shape consumed by P1's extractSignals()
 * - Per-dimension progress state (coverage + turn budget tracking)
 * - Modality-agnostic: no transport, no UI, no realtime assumptions
 */

import { DIMENSION_IDS } from '../scoring/config.js';

// ── Constants ─────────────────────────────────────────────────────────

export const SESSION_STATES = ['created', 'in_progress', 'completed', 'abandoned'];

// ── Session class ─────────────────────────────────────────────────────

/**
 * Assessment session: lifecycle, transcript, and per-dimension progress.
 *
 * All state mutations are intentional (no accidental mutation of turns[]).
 * The transcript getter returns a fresh snapshot compatible with AssessmentTranscript.
 */
export class AssessmentSession {
  /**
   * @param {{ id: string, candidateId: string }} opts
   */
  constructor({ id, candidateId }) {
    if (!id || typeof id !== 'string') throw new Error('id must be a non-empty string');
    if (!candidateId || typeof candidateId !== 'string') throw new Error('candidateId must be a non-empty string');

    this._id = id;
    this._candidateId = candidateId;
    this._status = 'created';
    this._startedAt = null;
    this._completedAt = null;
    this._abandonedAt = null;
    this._abandonReason = null;

    // D4: consent must be recorded before session can start
    this._consentGiven = false;
    this._consentAt = null;

    // Append-only transcript turns
    this._turns = [];

    // Per-dimension progress: { turnCount, covered }
    this._dimensionProgress = {};
    for (const dimId of DIMENSION_IDS) {
      this._dimensionProgress[dimId] = { turnCount: 0, covered: false };
    }
  }

  // ── Getters ───────────────────────────────────────────────────────

  get id()          { return this._id; }
  get candidateId() { return this._candidateId; }
  get status()      { return this._status; }
  get startedAt()   { return this._startedAt; }
  get completedAt() { return this._completedAt; }
  get abandonedAt() { return this._abandonedAt; }
  get abandonReason() { return this._abandonReason; }
  get turnCount()   { return this._turns.length; }
  get consentGiven() { return this._consentGiven; }
  get consentAt()   { return this._consentAt; }

  /**
   * Returns a snapshot compatible with AssessmentTranscript (P1 schema).
   * @returns {import('./schemas.js').AssessmentTranscript}
   */
  get transcript() {
    return {
      id: this._id,
      candidateId: this._candidateId,
      startedAt: this._startedAt,
      ...(this._completedAt ? { completedAt: this._completedAt } : {}),
      turns: [...this._turns],
    };
  }

  /**
   * Dimension IDs that have been marked covered.
   * @returns {string[]}
   */
  get coveredDimensions() {
    return Object.entries(this._dimensionProgress)
      .filter(([, p]) => p.covered)
      .map(([id]) => id);
  }

  // ── Consent (D4) ──────────────────────────────────────────────────

  /**
   * Record candidate consent for transcript retention (D4 policy).
   * Must be called before start(). Can only be called in 'created' state.
   */
  recordConsent() {
    if (this._status !== 'created') {
      throw new Error(`Cannot record consent in state: ${this._status}`);
    }
    this._consentGiven = true;
    this._consentAt = new Date().toISOString();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  /** Transition: created → in_progress. Requires consent (D4). */
  start() {
    if (this._status !== 'created') {
      throw new Error(`Cannot start session in state: ${this._status}`);
    }
    if (!this._consentGiven) {
      throw new Error('Cannot start session without consent (D4 policy): call recordConsent() first');
    }
    this._status = 'in_progress';
    this._startedAt = new Date().toISOString();
  }

  /** Transition: in_progress → completed */
  complete() {
    if (this._status !== 'in_progress') {
      throw new Error(`Cannot complete session in state: ${this._status}`);
    }
    this._status = 'completed';
    this._completedAt = new Date().toISOString();
  }

  /** Transition: created|in_progress → abandoned */
  abandon(reason = '') {
    if (this._status !== 'in_progress' && this._status !== 'created') {
      throw new Error(`Cannot abandon session in state: ${this._status}`);
    }
    this._status = 'abandoned';
    this._abandonedAt = new Date().toISOString();
    this._abandonReason = reason || null;
  }

  // ── Transcript ────────────────────────────────────────────────────

  /**
   * Append one turn to the transcript (append-only).
   * @param {{ role: 'interviewer'|'candidate', content: string, dimension?: string }} turn
   */
  appendTurn(turn) {
    if (!['interviewer', 'candidate'].includes(turn.role)) {
      throw new Error(`Invalid turn role: ${turn.role}`);
    }
    if (!turn.content || typeof turn.content !== 'string') {
      throw new Error('Turn content must be a non-empty string');
    }
    this._turns.push({ ...turn });
  }

  // ── Dimension progress ────────────────────────────────────────────

  /**
   * @param {string} dimId
   * @returns {{ turnCount: number, covered: boolean }}
   */
  getDimensionProgress(dimId) {
    if (!this._dimensionProgress[dimId]) {
      throw new Error(`Unknown dimension: ${dimId}`);
    }
    return { ...this._dimensionProgress[dimId] };
  }

  /** Record that the candidate gave at least one substantive response for this dimension. */
  markDimensionCovered(dimId) {
    if (!this._dimensionProgress[dimId]) {
      throw new Error(`Unknown dimension: ${dimId}`);
    }
    this._dimensionProgress[dimId].covered = true;
  }

  /** Increment candidate-turn counter for a dimension. */
  incrementDimensionTurns(dimId) {
    if (!this._dimensionProgress[dimId]) {
      throw new Error(`Unknown dimension: ${dimId}`);
    }
    this._dimensionProgress[dimId].turnCount++;
  }

  // ── Serialization ─────────────────────────────────────────────────

  /**
   * Produce a plain-object snapshot suitable for JSON.stringify.
   * All arrays and sub-objects are shallow-copied to prevent aliasing.
   */
  toJSON() {
    return {
      id: this._id,
      candidateId: this._candidateId,
      status: this._status,
      consentGiven: this._consentGiven,
      consentAt: this._consentAt,
      startedAt: this._startedAt,
      completedAt: this._completedAt,
      abandonedAt: this._abandonedAt,
      abandonReason: this._abandonReason,
      turns: this._turns.map(t => ({ ...t })),
      dimensionProgress: Object.fromEntries(
        Object.entries(this._dimensionProgress).map(([k, v]) => [k, { ...v }]),
      ),
    };
  }

  /**
   * Reconstruct a session from a toJSON() snapshot.
   * @param {object} data
   * @returns {AssessmentSession}
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Cannot deserialize session from non-object');
    }
    const session = new AssessmentSession({
      id: data.id,
      candidateId: data.candidateId,
    });
    if (SESSION_STATES.includes(data.status)) {
      session._status = data.status;
    }
    session._consentGiven = data.consentGiven ?? false;
    session._consentAt    = data.consentAt   ?? null;
    session._startedAt    = data.startedAt   ?? null;
    session._completedAt  = data.completedAt ?? null;
    session._abandonedAt  = data.abandonedAt ?? null;
    session._abandonReason = data.abandonReason ?? null;
    session._turns = Array.isArray(data.turns) ? data.turns.map(t => ({ ...t })) : [];
    if (data.dimensionProgress && typeof data.dimensionProgress === 'object') {
      for (const [dimId, progress] of Object.entries(data.dimensionProgress)) {
        if (session._dimensionProgress[dimId] && progress && typeof progress === 'object') {
          session._dimensionProgress[dimId] = { ...progress };
        }
      }
    }
    return session;
  }
}
