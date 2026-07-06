# Volo Index — AI Assessment Engine: Architecture Plan (v0.1 draft)

Status: DRAFT — pending board decisions (see §6). Author: CTO, 2026-07-05.

## 1. Purpose

The scoring engine (`src/scoring/`, rubric v1.2) is pure and deterministic:
**signals in → scores out**. It deliberately has no opinion on where signals
come from. The AI assessment engine is the upstream component that *produces*
those signals: it conducts a structured assessment with a candidate and
extracts rubric-grade evidence signals from the interaction.

```
Candidate ⇄ [Interviewer (LLM)] → transcript
             transcript → [Signal Extractor (LLM)] → candidate signals
             candidate signals → [Validator (deterministic)] → recorded signals
             recorded signals → [Scoring Engine (existing, v1.2)] → score + tier
```

## 2. Components

| Component | Nature | Responsibility |
|---|---|---|
| Session Manager | deterministic service | assessment lifecycle, state, persistence, resumability |
| Interviewer | LLM-driven | conducts the structured interview per dimension; adaptive follow-ups to elicit S2–S6 evidence; never scores |
| Signal Extractor | LLM-driven | maps transcript spans → candidate signals `{dimension, type S1–S6|N, strength weak|clear|strong, anchorTier, corrected, evidenceRef}` |
| Validator | deterministic | schema validation, §3/§5 consistency checks, evidence-span traceability, dedup; rejects malformed signals before they reach scoring |
| Scoring adapter | deterministic | feeds recorded signals to `scoreAssessment()`; stamps `RUBRIC_VERSION` |

Key invariant: **LLMs propose, deterministic code disposes.** No LLM output
reaches a published score without passing the validator and the existing
scoring engine. Every extracted signal must carry an `evidenceRef` back to
transcript spans (auditability, §9 re-validation, appeals).

## 3. Provider strategy

Single `LlmAdapter` interface (`complete(messages, opts) → {text, usage}`),
provider-agnostic. v1 ships one concrete adapter (provider = board decision
D1). Model IDs, temperature, and max tokens live in config, not code.
Extraction runs at temperature ~0 with JSON-schema-constrained output;
interviewing runs at moderate temperature.

## 4. Delivery phases

- **P0 — Contracts & scaffold (no external deps, can start now):**
  transcript + candidate-signal JSON schemas, `LlmAdapter` interface, mock
  adapter, Validator, end-to-end dry run with fixture transcripts through
  the real scoring engine. Tests in the existing `node --test` layers.
- **P1 — Signal Extractor (first LLM integration):** prompt suite +
  golden-transcript eval set; measure extraction agreement vs. hand-labeled
  signals (fixtures 01–11 style). Gate: ≥90% signal-type agreement on the
  golden set before P2.
- **P2 — Interviewer:** dimension-by-dimension structured interview flow,
  anti-gaming guardrails (no rubric leakage in prompts), session manager.
- **P3 — Hardening & go-live:** cost/latency budget enforcement, red-team
  pass (prompt injection via candidate answers), QA sign-off, Head of Data
  §9-style validation of the extractor, human-in-the-loop policy (D5),
  gated behind a go-live flag exactly like `PUBLIC_SCORING_ENABLED`.

## 5. Security & integrity notes

- Candidate input is hostile input: prompt-injection hardening on both LLM
  stages; extractor sees transcript as data, never as instructions.
- API keys via env only; never committed. Per-session spend cap enforced in
  the adapter.
- Transcripts contain PII → retention & consent policy is board decision D4.

## 6. Open board decisions (blocking P1+; P0 is unblocked)

- **D1 — LLM provider/model.** CTO recommendation: Anthropic Claude
  (Sonnet 4.6 for interviewer, and for extraction), one adapter, keys via env.
- **D2 — v1 modality.** Interactive chat interview (recommended) vs. async
  written scenario responses.
- **D3 — Cost ceiling.** Per-assessment API spend cap (recommend ≤ $0.50
  target, hard cap $2.00) and monthly budget.
- **D4 — Transcript retention.** Retain full transcripts with consent
  (recommended — required for audit/appeals/re-scoring) vs. signals-only.
- **D5 — Human-in-the-loop.** Recommend: first N=50 public assessments get
  QA spot-check before score release; auto-publish after agreement ≥95%.
