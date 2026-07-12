/**
 * Volo Index — Chat Interview Controller (P2c)
 *
 * Bridges the modality-agnostic runInterview() orchestrator to an
 * interactive chat UI. Manages consent capture (D4), UI state
 * transitions, typing/streaming indicators, and message history
 * with turn-index linkage for evidenceRef traceability.
 *
 * State machine:
 *   idle → consent_pending → interviewing → completed | abandoned | cost_capped
 *
 * Usage:
 *   const ctrl = new ChatInterviewController({ candidateId, llmAdapter });
 *   ctrl.on('question', ({ question, dimension }) => renderQuestion(question));
 *   ctrl.on('stateChange', ({ from, to }) => updateUI(to));
 *   ctrl.begin();                    // → consent_pending
 *   ctrl.grantConsent();             // → interviewing (fires first question)
 *   ctrl.submitResponse('My answer');// resolves getCandidateResponse
 *   // ... loop until completed / abandoned / cost_capped
 */

import { randomUUID } from 'node:crypto';
import { AssessmentSession } from './session.js';
import { runInterview } from './interviewer.js';

// ── Constants ─────────────────────────────────────────────────────────

export const CONTROLLER_STATES = [
  'idle',
  'consent_pending',
  'interviewing',
  'completed',
  'abandoned',
  'cost_capped',
];

// ── ChatInterviewController ──────────────────────────────────────────

export class ChatInterviewController {
  /**
   * @param {object} opts
   * @param {string} opts.candidateId       - Anonymized candidate identifier
   * @param {import('./llm-adapter.js').LlmAdapter} opts.llmAdapter - LLM for question generation
   * @param {import('./consent-store.js').TranscriptStore} [opts.transcriptStore] - Optional; saves transcript on completion
   * @param {string} [opts.sessionId]       - Override session ID (defaults to randomUUID)
   * @param {object} [opts.interviewOpts]   - Passed through to runInterview (maxTurnsPerDimension, dimensionOrder)
   */
  constructor({ candidateId, llmAdapter, transcriptStore, sessionId, interviewOpts }) {
    if (!candidateId || typeof candidateId !== 'string') {
      throw new Error('candidateId must be a non-empty string');
    }
    if (!llmAdapter) {
      throw new Error('llmAdapter is required');
    }

    this._candidateId = candidateId;
    this._llmAdapter = llmAdapter;
    this._transcriptStore = transcriptStore ?? null;
    this._sessionId = sessionId ?? randomUUID();
    this._interviewOpts = interviewOpts ?? {};

    this._state = 'idle';
    this._session = null;
    this._messages = [];
    this._typing = false;
    this._error = null;

    // Promise resolver for the pending getCandidateResponse callback
    this._pendingResolve = null;

    // Event listeners: Map<string, Set<Function>>
    this._listeners = new Map();
  }

  // ── Getters ───────────────────────────────────────────────────────

  /** Current controller state. */
  get state() { return this._state; }

  /** Whether the LLM is generating a question (typing indicator). */
  get typing() { return this._typing; }

  /** Whether the controller is waiting for a candidate response. */
  get awaitingResponse() { return this._pendingResolve !== null; }

  /** The underlying AssessmentSession (null until begin() called). */
  get session() { return this._session; }

  /**
   * UI message log. Each entry:
   *   { role: 'interviewer'|'candidate', content: string, dimension?: string, turnIndex: number }
   * turnIndex maps to session.transcript.turns[turnIndex] for evidenceRef linkage.
   */
  get messages() { return [...this._messages]; }

  /** Last error (for cost_capped or unexpected failures). */
  get error() { return this._error; }

  /** Current dimension being discussed (null if not interviewing or between dimensions). */
  get currentDimension() {
    if (this._state !== 'interviewing') return null;
    const last = this._messages.findLast(m => m.role === 'interviewer');
    return last?.dimension ?? null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Initialize the session and move to consent_pending.
   * The UI should present the consent prompt after this call.
   */
  begin() {
    if (this._state !== 'idle') {
      throw new Error(`Cannot begin() in state: ${this._state}`);
    }
    this._session = new AssessmentSession({
      id: this._sessionId,
      candidateId: this._candidateId,
    });
    this._setState('consent_pending');
  }

  /**
   * Record candidate consent (D4) and start the interview.
   * The first LLM question will be generated asynchronously.
   */
  grantConsent() {
    if (this._state !== 'consent_pending') {
      throw new Error(`Cannot grantConsent() in state: ${this._state}`);
    }
    this._session.recordConsent();
    this._session.start();
    this._setState('interviewing');
    this._runInterview(); // fire-and-forget; errors caught internally
  }

  /**
   * Candidate declined consent → no interview (v1 has no signals-only path).
   */
  declineConsent() {
    if (this._state !== 'consent_pending') {
      throw new Error(`Cannot declineConsent() in state: ${this._state}`);
    }
    this._session.abandon('consent_declined');
    this._setState('abandoned');
  }

  /**
   * Submit a candidate response to the current question.
   * @param {string} text - The candidate's answer text
   */
  submitResponse(text) {
    if (this._state !== 'interviewing') {
      throw new Error(`Cannot submitResponse() in state: ${this._state}`);
    }
    if (!this._pendingResolve) {
      throw new Error('No pending question to respond to');
    }
    if (!text || typeof text !== 'string') {
      throw new Error('Response text must be a non-empty string');
    }

    // Record in UI message log with turn index linkage
    const turnIndex = this._session.turnCount; // next turn index
    this._messages.push({
      role: 'candidate',
      content: text,
      dimension: this.currentDimension,
      turnIndex,
    });

    // Resolve the pending getCandidateResponse promise
    const resolve = this._pendingResolve;
    this._pendingResolve = null;
    this._setTyping(true); // LLM generating next question
    resolve(text);
  }

  /**
   * Abort the interview. If a question is pending, signals candidate-ended
   * to the orchestrator. Otherwise just abandons the session.
   */
  abort() {
    if (this._state !== 'interviewing' && this._state !== 'consent_pending') {
      throw new Error(`Cannot abort() in state: ${this._state}`);
    }

    if (this._pendingResolve) {
      // Signal candidate_ended to runInterview
      const resolve = this._pendingResolve;
      this._pendingResolve = null;
      resolve(null);
      // runInterview will call session.abandon('candidate_ended') and the
      // _runInterview handler will set state to 'abandoned'
    } else if (this._state === 'consent_pending') {
      this._session.abandon('aborted');
      this._setState('abandoned');
    }
    // If interviewing but no pending resolve, runInterview is between
    // getCandidateResponse calls (LLM generating). The abort will take
    // effect on the next getCandidateResponse callback.
  }

  // ── Events ────────────────────────────────────────────────────────

  /**
   * Register an event listener.
   * Events: 'stateChange', 'question', 'typing', 'complete', 'error'
   *
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this._listeners.get(event)?.delete(handler);
  }

  // ── Internal ──────────────────────────────────────────────────────

  /** @private */
  _emit(event, data) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(data); } catch { /* listener errors don't break the controller */ }
      }
    }
  }

  /** @private */
  _setState(newState) {
    const from = this._state;
    this._state = newState;
    this._emit('stateChange', { from, to: newState });
  }

  /** @private */
  _setTyping(value) {
    if (this._typing !== value) {
      this._typing = value;
      this._emit('typing', { typing: value });
    }
  }

  /**
   * Run the interview orchestrator. Called after grantConsent().
   * Handles the getCandidateResponse bridge and terminal-state cleanup.
   * @private
   */
  async _runInterview() {
    this._setTyping(true); // LLM generating first question

    /**
     * getCandidateResponse bridge: when runInterview needs a candidate
     * response, we emit the question to the UI and return a promise that
     * resolves when submitResponse() is called.
     */
    const getCandidateResponse = (question, dimId) => {
      this._setTyping(false); // question arrived, waiting for candidate

      // Record interviewer message with turn index
      const turnIndex = this._session.turnCount - 1; // just appended by runInterview
      this._messages.push({
        role: 'interviewer',
        content: question,
        dimension: dimId,
        turnIndex,
      });

      this._emit('question', { question, dimension: dimId, turnIndex });

      return new Promise(resolve => {
        this._pendingResolve = resolve;
      });
    };

    try {
      await runInterview(
        this._session,
        this._llmAdapter,
        getCandidateResponse,
        this._interviewOpts,
      );

      this._setTyping(false);

      if (this._session.status === 'completed') {
        await this._saveTranscript();
        this._setState('completed');
        this._emit('complete', { session: this._session });
      } else if (this._session.status === 'abandoned') {
        this._setState('abandoned');
      }
    } catch (err) {
      this._setTyping(false);
      this._error = err;

      if (err.constructor?.name === 'CostCapExceededError' || err.message?.includes('cost cap')) {
        this._setState('cost_capped');
      } else {
        // Unexpected error — abandon session if still in progress
        if (this._session.status === 'in_progress') {
          try { this._session.abandon('error'); } catch { /* already terminal */ }
        }
        this._setState('abandoned');
      }
      this._emit('error', { error: err });
    }
  }

  /**
   * Save transcript to store if consent was given and store is configured.
   * @private
   */
  async _saveTranscript() {
    if (!this._transcriptStore || !this._session.consentGiven) return;
    await this._transcriptStore.save({
      sessionId: this._session.id,
      candidateId: this._session.candidateId,
      consentGiven: this._session.consentGiven,
      consentAt: this._session.consentAt,
      transcript: this._session.transcript,
    });
  }
}
