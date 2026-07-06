/**
 * Volo Index — Signal Extractor (P1)
 *
 * extractSignals(transcript, adapter, opts) -> ExtractionResult
 *
 * Pipeline:
 *   1. Build rubric-v1.2 §3-encoded prompt from transcript
 *   2. Call adapter.complete() (one LLM pass)
 *   3. Parse JSON; one structured re-ask on parse failure, then typed error
 *   4. Anti-hallucination gate: drop signals whose evidenceRef.spanText does
 *      not appear verbatim in transcript.turns[turnIndex].content
 *   5. Deterministic disposal: run P0 validateSignals() on surviving signals
 *
 * Invariant: LLMs propose, deterministic code disposes.
 */

import { validateSignals } from './validator.js';
import { SIGNAL_TYPES } from './schemas.js';
import { TIER_ORDER } from '../scoring/config.js';

// ── Error types ──────────────────────────────────────────────────────

export const ExtractionErrorCodes = {
  INVALID_TRANSCRIPT: 'INVALID_TRANSCRIPT',
  JSON_PARSE_FAILED:  'JSON_PARSE_FAILED',
  REPAIR_FAILED:      'REPAIR_FAILED',
  ADAPTER_ERROR:      'ADAPTER_ERROR',
};

export class ExtractionError extends Error {
  constructor(message, { code = 'EXTRACTION_FAILED', cause, partialSignals = [] } = {}) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    this.cause = cause;
    this.partialSignals = partialSignals;
  }
}

// ── §3 taxonomy descriptions for system prompt ───────────────────────

const SIGNAL_TYPE_DESCRIPTIONS = {
  S1: 'Recall/Recognition — names, recalls, or identifies concepts, frameworks, or practices (no tier gate; any anchorTier)',
  S2: 'Applied Practice — describes applying a concept or practice in a real situation (gate: developing+)',
  S3: 'Reflective Practice — reflects on why something worked, what was learned, or how they adapted (gate: proficient+)',
  S4: 'System-Level Thinking — connects practice to broader systems or patterns across situations (gate: proficient+)',
  S5: 'Strategic Design/Leadership — describes designing programs, strategies, or roles from principles (gate: expert+)',
  S6: 'Field-Level Expertise/Advocacy — demonstrates field-level knowledge or contribution beyond their organization (gate: expert+)',
  N:  'Negative/Misconception — clear misconception, harmful framing, or serious gap (any tier; corrected:true if candidate immediately self-corrects)',
};

// ── Prompt builders ──────────────────────────────────────────────────

function buildSystemPrompt() {
  return `You are a volunteer management competency assessor for the Volo Index rubric v1.2.

Extract candidate competency signals from the interview transcript.

## Signal taxonomy (§3)
${SIGNAL_TYPES.map(t => `- **${t}**: ${SIGNAL_TYPE_DESCRIPTIONS[t]}`).join('\n')}

## Strength levels
- **weak** (0.5): vague, partial, or implicit evidence
- **clear** (1.0): explicit, concrete evidence
- **strong** (1.5): detailed, specific, contextually rich evidence

## Anchor tiers (lowest to highest)
${TIER_ORDER.map(t => `- ${t}`).join('\n')}

## Dimensions
D1: Strategic Engagement Design | D2: Recruitment, Matching & Onboarding
D3: Training, Development & Role Support | D4: Performance, Impact & Accountability
D5: Recognition, Retention & Culture | D6: Ethics, Equity & Advocacy

## Critical rules
1. Only emit signals for CANDIDATE turns (role: "candidate").
2. evidenceRef.spanText MUST be the EXACT verbatim text from transcript.turns[turnIndex].content — no paraphrase, no ellipsis.
3. strengthLabel and strength MUST be consistent: weak→0.5, clear→1.0, strong→1.5.
4. Assign dimension D1–D6 based on the nearest preceding interviewer turn's dimension field.
5. corrected:true only on N signals where the candidate explicitly self-corrects in the same turn.
6. Do NOT invent or paraphrase evidence. If uncertain, omit the signal.

## Output format
Respond with ONLY valid JSON, no markdown fences, no commentary:
{"signals":[{"id":"sig-D1-001","dimension":"D1","type":"S2","strengthLabel":"clear","strength":1.0,"anchorTier":"developing","corrected":false,"evidenceRef":{"turnIndex":1,"spanText":"exact verbatim text"},"excerpt":"exact verbatim text","hasFirstPersonSpecificity":true}]}`;
}

function buildUserPrompt(transcript) {
  const annotated = transcript.turns.map((turn, i) => ({
    turnIndex: i,
    role: turn.role,
    ...(turn.dimension ? { dimension: turn.dimension } : {}),
    content: turn.content,
  }));
  return `Assessment: ${transcript.id} | Candidate: ${transcript.candidateId}\n\n${JSON.stringify(annotated, null, 2)}\n\nExtract all candidate signals.`;
}

function buildRepairMessage(badText, parseError) {
  return `Your previous response could not be parsed as valid JSON.\nError: ${parseError.message}\n\nRespond with ONLY the corrected JSON object — no prose, no markdown. Required shape: {"signals":[...]}`;
}

// ── JSON parsing ─────────────────────────────────────────────────────

function tryParseSignals(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e };
  }
  if (!parsed || !Array.isArray(parsed.signals)) {
    return { ok: false, error: new Error('Response must be a JSON object with a "signals" array') };
  }
  return { ok: true, signals: parsed.signals };
}

// ── Anti-hallucination gate ──────────────────────────────────────────

/**
 * Reject any signal whose evidenceRef.spanText does not appear verbatim
 * in transcript.turns[evidenceRef.turnIndex].content.
 *
 * @param {object[]} signals
 * @param {import('./schemas.js').AssessmentTranscript} transcript
 * @returns {{ kept: object[], dropped: Array<{signal: object, reason: string}> }}
 */
function applyAntiHallucinationGate(signals, transcript) {
  const kept = [];
  const dropped = [];

  for (const sig of signals) {
    const ref = sig?.evidenceRef;
    if (!ref || typeof ref.turnIndex !== 'number' || typeof ref.spanText !== 'string' || ref.spanText.length === 0) {
      dropped.push({ signal: sig, reason: 'evidenceRef missing or malformed' });
      continue;
    }
    const turn = transcript.turns[ref.turnIndex];
    if (!turn) {
      dropped.push({ signal: sig, reason: `evidenceRef.turnIndex ${ref.turnIndex} is out of bounds` });
      continue;
    }
    if (!turn.content.includes(ref.spanText)) {
      dropped.push({ signal: sig, reason: `evidenceRef.spanText not found verbatim in turn ${ref.turnIndex}` });
      continue;
    }
    kept.push(sig);
  }

  return { kept, dropped };
}

// ── Main export ──────────────────────────────────────────────────────

/**
 * Extract validated CandidateSignal[] from an assessment transcript.
 *
 * @param {import('./schemas.js').AssessmentTranscript} transcript
 * @param {import('./llm-adapter.js').LlmAdapter} adapter
 * @param {{ temperature?: number, maxTokens?: number }} [opts]
 * @returns {Promise<{
 *   transcriptId: string,
 *   signals: import('./schemas.js').CandidateSignal[],
 *   dropped: Array<{signal: object, reason: string}>,
 *   validationErrors: import('./validator.js').ValidationError[],
 *   usage: { promptTokens: number, completionTokens: number },
 * }>}
 * @throws {ExtractionError} on JSON parse failure after repair, adapter error, or invalid transcript
 */
export async function extractSignals(transcript, adapter, opts = {}) {
  // Basic transcript guard
  if (!transcript || typeof transcript !== 'object') {
    throw new ExtractionError('Transcript must be an object', { code: ExtractionErrorCodes.INVALID_TRANSCRIPT });
  }
  if (!Array.isArray(transcript.turns) || transcript.turns.length === 0) {
    throw new ExtractionError('Transcript must have at least one turn', { code: ExtractionErrorCodes.INVALID_TRANSCRIPT });
  }

  const completionOpts = {
    temperature: opts.temperature ?? 0,
    maxTokens: opts.maxTokens ?? 4096,
  };

  const systemMsg = { role: 'system', content: buildSystemPrompt() };
  const userMsg   = { role: 'user',   content: buildUserPrompt(transcript) };

  const usage = { promptTokens: 0, completionTokens: 0 };

  // ── First LLM call ───────────────────────────────────────────────
  let firstResult;
  try {
    firstResult = await adapter.complete([systemMsg, userMsg], completionOpts);
  } catch (e) {
    throw new ExtractionError(`Adapter error: ${e.message}`, { code: ExtractionErrorCodes.ADAPTER_ERROR, cause: e });
  }
  usage.promptTokens     += firstResult.usage.promptTokens;
  usage.completionTokens += firstResult.usage.completionTokens;

  let parsed = tryParseSignals(firstResult.text);

  // ── Bounded repair loop: exactly one re-ask ───────────────────────
  if (!parsed.ok) {
    const repairMsg = {
      role: 'user',
      content: buildRepairMessage(firstResult.text, parsed.error),
    };
    let repairResult;
    try {
      repairResult = await adapter.complete(
        [systemMsg, userMsg, { role: 'assistant', content: firstResult.text }, repairMsg],
        completionOpts,
      );
    } catch (e) {
      throw new ExtractionError(`Adapter error during repair: ${e.message}`, { code: ExtractionErrorCodes.ADAPTER_ERROR, cause: e });
    }
    usage.promptTokens     += repairResult.usage.promptTokens;
    usage.completionTokens += repairResult.usage.completionTokens;

    parsed = tryParseSignals(repairResult.text);
    if (!parsed.ok) {
      throw new ExtractionError(
        `Signal extraction failed: could not parse LLM output as valid JSON after repair attempt (${parsed.error.message})`,
        { code: ExtractionErrorCodes.REPAIR_FAILED, cause: parsed.error },
      );
    }
  }

  // ── Anti-hallucination gate ───────────────────────────────────────
  const { kept, dropped } = applyAntiHallucinationGate(parsed.signals, transcript);

  // ── Deterministic validation (LLMs propose, deterministic code disposes) ─
  const { valid, errors: validationErrors } = validateSignals(kept, transcript);

  return {
    transcriptId: transcript.id,
    signals: valid,
    dropped,
    validationErrors,
    usage,
  };
}
