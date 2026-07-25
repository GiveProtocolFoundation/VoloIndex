/**
 * Volo Index — Score Publication Queue (P3)
 *
 * Implements board decision D5: human-in-the-loop spot-check workflow.
 *
 * Rules:
 * - Every public assessment is held as 'pending_review'; QA must release
 *   each one with an agreement verdict. Reviewed/agreement counters track
 *   the D5 spot-check thresholds (default 50 reviews / 95% agreement) for
 *   reporting purposes.
 *
 * AUTO-PUBLISH IS DISABLED BY DEFAULT (DPIA R-01 / GIV-741 SOP §7).
 * The original D5 design auto-published entries once the spot-check latch
 * tripped, but the binding Art. 13 privacy notice §6 commits that "every
 * publication passes a human review step before going live" (Art. 22
 * safeguard). The latch therefore cannot trip unless the constructor is
 * called with `allowAutoPublish: true` — which MUST NOT be done without a
 * DPIA re-assessment signed off by the Head of Data (see GIV-741 §7,
 * GIV-745). No production code path passes this flag.
 *
 * Designed for deterministic unit-testability and JSON round-trip persistence.
 * A durable file-backed persistence layer can wrap this with toJSON/fromJSON.
 */

// ── Defaults (match board decisions D5) ──────────────────────────────

const DEFAULT_SPOT_CHECK_THRESHOLD = 50;
const DEFAULT_AGREEMENT_THRESHOLD  = 0.95;

// ── Types ─────────────────────────────────────────────────────────────

/**
 * @typedef {'pending_review'|'published'} PublicationStatus
 */

/**
 * @typedef {Object} PublicationEntry
 * @property {string}            sessionId
 * @property {string}            candidateId
 * @property {string}            enqueuedAt            - ISO 8601
 * @property {PublicationStatus} status
 * @property {object}            scoreResult           - scoreAssessment() output
 * @property {string|null}       releasedAt            - ISO 8601 or null
 * @property {boolean|null}      agreedWithExtractor   - QA verdict or null
 */

// ── PublicationQueue ──────────────────────────────────────────────────

/**
 * Score publication pipeline with QA spot-check hold for first N assessments.
 *
 * State is fully serializable (toJSON / fromJSON) for durable persistence.
 */
export class PublicationQueue {
  /**
   * @param {{
   *   spotCheckThreshold?: number,
   *   agreementThreshold?: number,
   *   allowAutoPublish?: boolean,
   * }} [opts]
   */
  constructor(opts = {}) {
    this._spotCheckThreshold = opts.spotCheckThreshold ?? DEFAULT_SPOT_CHECK_THRESHOLD;
    this._agreementThreshold = opts.agreementThreshold ?? DEFAULT_AGREEMENT_THRESHOLD;

    // DPIA R-01 guard: auto-publish would bypass the Art. 22 human-review
    // safeguard promised in privacy notice §6. Enabling this flag requires a
    // DPIA re-assessment (GIV-741 SOP §7 / GIV-745) — never set it in
    // production code without HoData sign-off.
    this._allowAutoPublish = opts.allowAutoPublish === true;

    /** @type {Map<string, PublicationEntry>} */
    this._entries = new Map();

    // Reviewed-result counters for agreement-rate tracking
    this._reviewedCount  = 0;
    this._agreementCount = 0;

    // Flips to true once spotCheckThreshold reviews pass agreementThreshold
    // — only reachable when allowAutoPublish was explicitly set (DPIA R-01)
    this._autoPublishEnabled = false;
  }

  // ── Accessors ───────────────────────────────────────────────────────

  get spotCheckThreshold()  { return this._spotCheckThreshold; }
  get agreementThreshold()  { return this._agreementThreshold; }
  get reviewedCount()       { return this._reviewedCount; }
  get agreementCount()      { return this._agreementCount; }
  get allowAutoPublish()    { return this._allowAutoPublish; }
  get autoPublishEnabled()  { return this._allowAutoPublish && this._autoPublishEnabled; }

  /** Number of entries currently waiting for QA review. */
  get pendingCount() {
    let n = 0;
    for (const e of this._entries.values()) {
      if (e.status === 'pending_review') n++;
    }
    return n;
  }

  /** Total published entries (auto-published or QA-released). */
  get publishedCount() {
    let n = 0;
    for (const e of this._entries.values()) {
      if (e.status === 'published') n++;
    }
    return n;
  }

  /**
   * Extractor agreement rate as a fraction (0–1).
   * Returns 0 when no reviews have been completed yet.
   *
   * @returns {number}
   */
  get agreementRate() {
    if (this._reviewedCount === 0) return 0;
    return this._agreementCount / this._reviewedCount;
  }

  // ── Core operations ─────────────────────────────────────────────────

  /**
   * Add a completed assessment result to the pipeline.
   *
   * Always holds as 'pending_review' for QA unless the instance was
   * explicitly constructed with `allowAutoPublish: true` AND the D5 latch
   * has tripped (DPIA R-01 guard — see file header).
   *
   * @param {{ sessionId: string, candidateId: string, scoreResult: object }} opts
   * @returns {PublicationEntry} - snapshot of the new entry
   * @throws {Error} on invalid input or duplicate sessionId
   */
  enqueue({ sessionId, candidateId, scoreResult }) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('enqueue: sessionId must be a non-empty string');
    }
    if (!candidateId || typeof candidateId !== 'string') {
      throw new Error('enqueue: candidateId must be a non-empty string');
    }
    if (!scoreResult || typeof scoreResult !== 'object') {
      throw new Error('enqueue: scoreResult must be an object');
    }
    if (this._entries.has(sessionId)) {
      throw new Error(`enqueue: session ${sessionId} is already in the queue`);
    }

    const now = new Date().toISOString();
    // Gated getter: false unless allowAutoPublish was explicitly opted into
    // at construction (DPIA R-01 / Art. 22 human-review safeguard).
    const autoPublish = this.autoPublishEnabled;

    /** @type {PublicationEntry} */
    const entry = {
      sessionId,
      candidateId,
      enqueuedAt: now,
      status: autoPublish ? 'published' : 'pending_review',
      scoreResult,
      releasedAt: autoPublish ? now : null,
      agreedWithExtractor: null,
    };

    this._entries.set(sessionId, entry);
    return { ...entry };
  }

  /**
   * QA releases a pending result, recording the agreement verdict.
   *
   * - Updates agreement counters.
   * - Checks whether the auto-publish threshold has now been reached.
   *
   * @param {string} sessionId
   * @param {{ agreedWithExtractor: boolean }} opts - QA verdict
   * @returns {PublicationEntry} - snapshot of the updated (published) entry
   * @throws {Error} if sessionId not found or entry not in pending_review
   */
  release(sessionId, { agreedWithExtractor }) {
    const entry = this._entries.get(sessionId);
    if (!entry) {
      throw new Error(`release: session ${sessionId} not found in queue`);
    }
    if (entry.status !== 'pending_review') {
      throw new Error(`release: session ${sessionId} is not pending_review (current status: ${entry.status})`);
    }
    if (typeof agreedWithExtractor !== 'boolean') {
      throw new Error('release: agreedWithExtractor must be a boolean');
    }

    entry.status = 'published';
    entry.releasedAt = new Date().toISOString();
    entry.agreedWithExtractor = agreedWithExtractor;

    this._reviewedCount++;
    if (agreedWithExtractor) this._agreementCount++;

    // Flip auto-publish once threshold met — but ONLY when the instance was
    // explicitly constructed with allowAutoPublish (DPIA R-01 / GIV-741 §7:
    // enabling auto-publish requires a DPIA re-assessment).
    if (this._allowAutoPublish
        && !this._autoPublishEnabled
        && this._reviewedCount >= this._spotCheckThreshold
        && this.agreementRate >= this._agreementThreshold) {
      this._autoPublishEnabled = true;
    }

    return { ...entry };
  }

  /**
   * Get a snapshot of one entry (or null if not found).
   *
   * @param {string} sessionId
   * @returns {PublicationEntry|null}
   */
  getEntry(sessionId) {
    const e = this._entries.get(sessionId);
    return e ? { ...e } : null;
  }

  // ── Persistence (JSON round-trip) ────────────────────────────────────

  /**
   * Produce a plain-object snapshot for JSON.stringify / durable storage.
   * @returns {object}
   */
  toJSON() {
    return {
      spotCheckThreshold: this._spotCheckThreshold,
      agreementThreshold: this._agreementThreshold,
      reviewedCount:      this._reviewedCount,
      agreementCount:     this._agreementCount,
      // Effective (gated) value — a tripped latch is never serialized from a
      // non-allowed instance (DPIA R-01)
      autoPublishEnabled: this.autoPublishEnabled,
      entries: [...this._entries.entries()].map(([k, v]) => [k, { ...v }]),
    };
  }

  /**
   * Reconstruct a PublicationQueue from a toJSON() snapshot.
   *
   * `allowAutoPublish` is deliberately NOT part of the snapshot: it must be
   * re-asserted in code via `opts` on every restore, so persisted data can
   * never re-enable auto-publish on its own (DPIA R-01 / GIV-741 §7).
   *
   * @param {object} data
   * @param {{ allowAutoPublish?: boolean }} [opts]
   * @returns {PublicationQueue}
   */
  static fromJSON(data, opts = {}) {
    if (!data || typeof data !== 'object') {
      throw new Error('PublicationQueue.fromJSON: data must be an object');
    }
    const q = new PublicationQueue({
      spotCheckThreshold: data.spotCheckThreshold ?? DEFAULT_SPOT_CHECK_THRESHOLD,
      agreementThreshold: data.agreementThreshold ?? DEFAULT_AGREEMENT_THRESHOLD,
      allowAutoPublish:   opts.allowAutoPublish === true,
    });
    q._reviewedCount      = data.reviewedCount      ?? 0;
    q._agreementCount     = data.agreementCount     ?? 0;
    q._autoPublishEnabled = q._allowAutoPublish && (data.autoPublishEnabled ?? false);
    if (Array.isArray(data.entries)) {
      for (const [k, v] of data.entries) {
        q._entries.set(k, { ...v });
      }
    }
    return q;
  }
}
