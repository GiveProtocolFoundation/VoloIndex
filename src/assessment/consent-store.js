/**
 * Volo Index — Transcript + Consent Store (P3)
 *
 * Interface and implementations for durable transcript retention with consent.
 * Board decision D4: retain full transcripts with candidate consent.
 *
 * Key invariant: NO transcript may be stored without consentGiven === true.
 *
 * Interface:   TranscriptStore  (abstract)
 * In-memory:   InMemoryTranscriptStore  (unit tests, non-durable)
 * File-backed: FileTranscriptStore      (v1 production; real DB comes with backend tranche)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Record type ───────────────────────────────────────────────────────

/**
 * @typedef {Object} TranscriptRecord
 * @property {string}  sessionId
 * @property {string}  candidateId
 * @property {boolean} consentGiven    - MUST be true; enforced at save time
 * @property {string}  consentAt       - ISO 8601 timestamp of consent
 * @property {object}  transcript      - AssessmentTranscript snapshot
 * @property {string}  savedAt         - ISO 8601 timestamp set by store
 */

// ── Abstract interface ────────────────────────────────────────────────

/**
 * Abstract transcript store. Implementations must override save(), load(), and listIds().
 */
export class TranscriptStore {
  /**
   * Persist a transcript record.
   * Enforces the D4 invariant: throws if record.consentGiven !== true.
   *
   * @param {TranscriptRecord} record
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async save(record) {
    throw new Error('TranscriptStore.save() must be implemented by subclass');
  }

  /**
   * Load a stored record by session ID. Returns null if not found.
   *
   * @param {string} sessionId
   * @returns {Promise<TranscriptRecord|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async load(sessionId) {
    throw new Error('TranscriptStore.load() must be implemented by subclass');
  }

  /**
   * List all stored session IDs.
   *
   * @returns {Promise<string[]>}
   */
  async listIds() {
    throw new Error('TranscriptStore.listIds() must be implemented by subclass');
  }
}

// ── Validation helper ─────────────────────────────────────────────────

/**
 * Validate a record before storing. Enforces D4 consent invariant.
 * @param {object} record
 * @throws {Error} on missing fields or consent not given
 */
function assertValidRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('Transcript record must be an object');
  }
  if (!record.sessionId || typeof record.sessionId !== 'string') {
    throw new Error('Transcript record must have a sessionId string');
  }
  if (!record.candidateId || typeof record.candidateId !== 'string') {
    throw new Error('Transcript record must have a candidateId string');
  }
  if (record.consentGiven !== true) {
    throw new Error('Cannot store transcript without consentGiven: true (D4 policy — no transcript without consent)');
  }
  if (!record.transcript || typeof record.transcript !== 'object') {
    throw new Error('Transcript record must have a transcript object');
  }
}

// ── In-memory implementation ──────────────────────────────────────────

/**
 * In-memory transcript store.
 * Suitable for unit testing; not durable across process restarts.
 */
export class InMemoryTranscriptStore extends TranscriptStore {
  constructor() {
    super();
    /** @type {Map<string, TranscriptRecord>} */
    this._store = new Map();
  }

  async save(record) {
    assertValidRecord(record);
    this._store.set(record.sessionId, {
      ...record,
      savedAt: record.savedAt ?? new Date().toISOString(),
    });
  }

  async load(sessionId) {
    const entry = this._store.get(sessionId);
    return entry ? { ...entry } : null;
  }

  async listIds() {
    return [...this._store.keys()];
  }

  /** Total number of stored records. */
  get size() { return this._store.size; }
}

// ── File-backed implementation ────────────────────────────────────────

/**
 * File-backed transcript store.
 * Each session is stored as a separate JSON file under `dir/`.
 * Suitable for v1 production; real DB storage comes with the backend tranche.
 */
export class FileTranscriptStore extends TranscriptStore {
  /**
   * @param {{ dir: string }} opts
   */
  constructor({ dir }) {
    super();
    if (!dir || typeof dir !== 'string') {
      throw new Error('FileTranscriptStore requires a { dir } option');
    }
    this._dir = dir;
    if (!existsSync(this._dir)) {
      mkdirSync(this._dir, { recursive: true });
    }
  }

  async save(record) {
    assertValidRecord(record);
    const enriched = {
      ...record,
      savedAt: record.savedAt ?? new Date().toISOString(),
    };
    writeFileSync(this._pathFor(record.sessionId), JSON.stringify(enriched, null, 2), 'utf8');
  }

  async load(sessionId) {
    const path = this._pathFor(sessionId);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }

  async listIds() {
    if (!existsSync(this._dir)) return [];
    return readdirSync(this._dir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.slice(0, -5));
  }

  /**
   * Sanitize sessionId to a safe filename (prevent path traversal).
   * @param {string} sessionId
   * @returns {string}
   */
  _pathFor(sessionId) {
    const safe = sessionId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    return join(this._dir, `${safe}.json`);
  }
}
