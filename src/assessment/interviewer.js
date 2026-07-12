/**
 * Volo Index — Interviewer Orchestration Core (P2a)
 *
 * Dimension-by-dimension structured interview flow.
 * LLMs propose questions; deterministic orchestrator decides when to
 * advance, ask a follow-up, or stop. Candidate input is hostile input —
 * transcript content is data, never instructions.
 *
 * Anti-gaming invariant: interviewer prompts must never contain rubric
 * signal-type codes (S1–S6) or signal-type definition phrases from §3.
 * Verified by assertNoRubricLeakage() and enforced in tests.
 *
 * Modality-agnostic: no UI, no transport, no realtime assumptions.
 * Interactive chat and async written assessments are both implementable
 * on top of runInterview() without changes to this core.
 */

import { DIMENSIONS, DIMENSION_IDS } from '../scoring/config.js';
import { AssessmentSession } from './session.js';

// ── Constants ─────────────────────────────────────────────────────────

/** Default candidate-turn budget per dimension. */
export const DEFAULT_MAX_TURNS_PER_DIM = 2;

/** Minimum non-whitespace length to count a candidate response as substantive. */
const MIN_SUBSTANTIVE_LENGTH = 20;

/**
 * Rubric strings that must NOT appear in any interviewer prompt.
 *
 * Including these would leak the §3 signal taxonomy to candidates,
 * allowing them to game the assessment by parroting rubric language.
 *
 * Checked by assertNoRubricLeakage().
 */
export const RUBRIC_ANCHOR_STRINGS = [
  // §3 signal type codes
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6',
  // §3 signal type description keywords (verbatim from SCORING_RUBRIC.md)
  'Recall/Recognition',
  'Applied Practice',
  'Reflective Practice',
  'System-Level Thinking',
  'Field-Level Expertise',
  'Strategic Design/Leadership',
];

// ── Dimension display names ────────────────────────────────────────────

const DIM_NAME = Object.fromEntries(DIMENSIONS.map(d => [d.id, d.name]));

// ── Prompt builders ────────────────────────────────────────────────────

/**
 * Build the system prompt sent to the LLM for question generation.
 *
 * INVARIANT: this function MUST NOT include any string from RUBRIC_ANCHOR_STRINGS.
 * The test suite asserts this for all dimension × turn combinations.
 *
 * @param {string}   dimId               - D1–D6
 * @param {number}   turnIndex           - 0-based candidate-turn index in this dimension
 * @param {string[]} priorCandidateTurns - Prior candidate responses in this dimension
 * @returns {string}
 */
export function buildInterviewerSystemPrompt(dimId, turnIndex, priorCandidateTurns = []) {
  const dimName = DIM_NAME[dimId] ?? dimId;
  const isFollowUp = turnIndex > 0 && priorCandidateTurns.length > 0;

  const followUpSection = isFollowUp
    ? `\n\nPrior candidate response:\n"${priorCandidateTurns[priorCandidateTurns.length - 1]}"\n\nAsk ONE targeted follow-up question that probes a specific aspect they mentioned — seek concrete detail about what they did, why, and what resulted.`
    : '';

  return `You are a structured interviewer assessing a candidate's experience and practice in volunteer management.

Topic area: ${dimName}

Generate ONE open-ended behavioral interview question that:
- Invites the candidate to share a specific real-world example from their experience
- Uses framing like "Tell me about a time when..." or "Describe how you..."
- Is answerable in a few sentences without requiring yes/no
- Avoids evaluative language or hints about what a good answer looks like${followUpSection}

Respond with ONLY the question text. No preamble, no numbering, no explanation.`;
}

/**
 * Assert that a prompt contains none of the rubric anchor strings.
 * Throws immediately on the first violation found.
 *
 * Used as a structural check in tests; may also be called at runtime
 * before sending a prompt if desired.
 *
 * @param {string} prompt   - Assembled prompt text to check
 * @param {string} [label]  - Human-readable label for the error message
 * @throws {Error} if any RUBRIC_ANCHOR_STRINGS entry is found in prompt
 */
export function assertNoRubricLeakage(prompt, label = 'prompt') {
  for (const anchor of RUBRIC_ANCHOR_STRINGS) {
    if (prompt.includes(anchor)) {
      throw new Error(
        `Rubric leakage detected in ${label}: ` +
        `found "${anchor}". Interviewer prompts must not contain ` +
        'rubric signal-type codes or §3 anchor definitions.',
      );
    }
  }
}

// ── Coverage heuristic ────────────────────────────────────────────────

/**
 * Deterministic coverage check: is this candidate response substantive
 * enough to count as evidence for a dimension?
 *
 * @param {string} response
 * @returns {boolean}
 */
function isSubstantiveResponse(response) {
  return typeof response === 'string' && response.trim().length >= MIN_SUBSTANTIVE_LENGTH;
}

// ── Interview orchestrator ─────────────────────────────────────────────

/**
 * Run a complete modality-agnostic structured interview.
 *
 * Flow per dimension:
 *   1. LLM proposes a question (may be initial or follow-up)
 *   2. Orchestrator records it (deterministic)
 *   3. Caller delivers question to candidate and returns response
 *      (transport is the caller's concern — chat socket, form, test fixture)
 *   4. Orchestrator records response and updates coverage (deterministic)
 *   5. Stop conditions checked (deterministic):
 *      (a) coverage met → advance to next dimension
 *      (b) turn budget exhausted → advance to next dimension
 *      (c) candidate returns null → abandon and return immediately
 *
 * @param {AssessmentSession} session
 *   Must already be in 'in_progress' state.
 * @param {import('./llm-adapter.js').LlmAdapter} llmAdapter
 *   Used only for question generation; no rubric content in prompts.
 * @param {(question: string, dimId: string) => Promise<string|null>} getCandidateResponse
 *   Caller-supplied function; return null to signal candidate ended the interview.
 *   - Interactive chat: read next message from socket/stdin
 *   - Async written: deliver prompt and await submission
 *   - Tests: return scripted fixture string
 * @param {object}   [opts]
 * @param {number}   [opts.maxTurnsPerDimension=2]
 *   Maximum candidate-response turns before advancing to the next dimension.
 * @param {string[]} [opts.dimensionOrder]
 *   Defaults to DIMENSION_IDS (D1–D6).
 * @returns {Promise<AssessmentSession>}
 *   The same session object, now in 'completed' or 'abandoned' state.
 */
export async function runInterview(session, llmAdapter, getCandidateResponse, opts = {}) {
  if (!(session instanceof AssessmentSession)) {
    throw new Error('session must be an AssessmentSession instance');
  }
  if (session.status !== 'in_progress') {
    throw new Error(`Session must be in_progress to run interview, got: ${session.status}`);
  }

  const maxTurns = typeof opts.maxTurnsPerDimension === 'number'
    ? opts.maxTurnsPerDimension
    : DEFAULT_MAX_TURNS_PER_DIM;
  const dimensions = Array.isArray(opts.dimensionOrder) ? opts.dimensionOrder : DIMENSION_IDS;

  for (const dimId of dimensions) {
    const priorCandidateTurns = [];

    for (let turn = 0; turn < maxTurns; turn++) {
      // ── 1. LLM proposes question ───────────────────────────────────
      const systemPrompt = buildInterviewerSystemPrompt(dimId, turn, priorCandidateTurns);
      // Defense-in-depth: verify no rubric codes leaked into the outbound prompt.
      assertNoRubricLeakage(systemPrompt, `interviewer-system-prompt[${dimId}:${turn}]`);
      const llmResult = await llmAdapter.complete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: `Generate the next question for topic: ${DIM_NAME[dimId] ?? dimId}` },
        ],
        { temperature: 0.7, maxTokens: 256 },
      );
      const question = llmResult.text.trim();

      // ── 2. Record interviewer turn (append-only) ───────────────────
      session.appendTurn({ role: 'interviewer', content: question, dimension: dimId });

      // ── 3. Get candidate response (modality-agnostic) ─────────────
      const response = await getCandidateResponse(question, dimId);

      // ── Stop condition: candidate ended the interview ──────────────
      if (response === null) {
        session.abandon('candidate_ended');
        return session;
      }

      // ── 4. Record candidate turn (append-only) ────────────────────
      session.appendTurn({ role: 'candidate', content: response, dimension: dimId });
      priorCandidateTurns.push(response);
      session.incrementDimensionTurns(dimId);

      // ── 5. Coverage check (deterministic) ─────────────────────────
      if (isSubstantiveResponse(response)) {
        session.markDimensionCovered(dimId);
      }

      // ── Stop conditions for this dimension (deterministic) ─────────
      // (a) coverage met → advance after this turn (follow-ups are done above
      //     via the loop; if we want ≥1 follow-up, maxTurns should be ≥2)
      // (b) loop exhausts maxTurns naturally
      const progress = session.getDimensionProgress(dimId);
      if (progress.covered) {
        break; // coverage met → no more turns for this dimension
      }
    }
  }

  // All dimensions traversed → complete the session
  session.complete();
  return session;
}
