# AE-P4 Pre-Launch Validation — Assessment Engine v1

**Issue:** GIV-594 (AE-P4) · **Epic:** GIV-583 · **Validator:** Head of Data (independent)
**Date:** 2026-07-11 · **Verdict:** **PASS**
**Harness:** `scripts/validate-ae-p4.mjs` — deterministic, **no live API** (MockLlmAdapter / stubbed transport). 57/57 checks pass.

## Purpose

Final pre-launch step in the gate-flip protocol for epic GIV-583:

> QA sign-off → **Head of Data validation** → CTO flips `ASSESSMENT_ENGINE_ENABLED`.

QA has signed off (309/309 tests at `dd41f7f`). This report is the independent,
rubric-§9-style validation of the assessment pipeline by the Head of Data — the
assessment-engine analogue of `scripts/revalidate-v1.1.mjs` for the scoring
engine. The harness's golden transcript, hand-labelled signals, malformed
payloads and expected values are authored from scratch; it is **not** a re-run of
the engineer/QA suites nor of the P3 harness (`validate-extractor-p3.mjs`).

Guiding invariant: **LLMs propose, deterministic code disposes.** The check
targets the empirical guardrails between an LLM's proposals and a published score.

## Scope & Results (mapped to GIV-594 acceptance criteria)

### 1. extractor → validator → scoring path (golden + red-team)

- **1(a) evidenceRef integrity (auditability, §9).** Independently of the
  extractor's own gate, every accepted signal was re-checked against the
  transcript: its `evidenceRef` is well-formed (integer `turnIndex ≥ 0`,
  non-empty `spanText`) and resolves **verbatim** into the exact **candidate**
  turn it cites. All 18 accepted golden signals are auditable. **PASS**
- **1(b) malformed output never reaches the scorer.** A batch mixing the golden
  set with six malformed proposals — out-of-transcript span, out-of-bounds
  `turnIndex`, strength/label mismatch, tier/type gate violation (S5 anchored
  `developing`), missing `evidenceRef`, and unknown dimension `D9` — was fed
  through `extractSignals`. Every malformed proposal was rejected by either the
  anti-hallucination gate or the deterministic validator; none survived into the
  scored set. The score computed from the pipeline output is **identical** to the
  score from the clean golden set (overall score + tier), proving zero influence
  from the malformed input. No dimension flagged insufficient-evidence. **PASS**
- **1 red-team.** Prompt-injection candidate content (instruction override,
  rubric-code name-drop, embedded JSON payload) yields 0 signals with a faithful
  extractor; a *fooled* adapter that fabricates an expert span absent from the
  turn is still blocked by the verbatim-span gate (recorded in `dropped`). The
  defence does **not** depend on the LLM obeying instructions. **PASS**

### 2. D5 spot-check plumbing + gate-off invariant

- Gate default-off: `ASSESSMENT_ENGINE_ENABLED === false` — no live serving path. **PASS**
- A fresh `PublicationQueue` holds every result as `pending_review`; nothing
  publishes pre-flip (`publishedCount === 0`, `pendingCount` tracks holds). **PASS**
- Auto-publish threshold computed as specified — flip requires **BOTH** ≥50
  reviews **AND** ≥95% extractor agreement:
  - 50 reviews @ 47 agree = 0.94 → **no flip**.
  - 50 reviews @ 48 agree = 0.96 → **flip**; the next entry auto-publishes.
  - 100 reviews @ 90% → **never flips** (AND, not OR — volume alone insufficient).
  - JSON round-trip (`toJSON`/`fromJSON`) preserves counters and the flip decision. **PASS**

### 3. D4 consent gate

- No transcript persists without `consentGiven === true`. Consent absent /
  `false` / `'true'` (string) / `1` (number) are all rejected and **nothing** is
  written (in-memory `size` unchanged; file store leaves an empty dir). **PASS**
- File store additionally sanitises `sessionId` to prevent path traversal — a
  `../../etc/passwd` id does not escape the store directory. **PASS**

## Findings (non-blocking)

1. **The `≥95%` number accrues at RUNTIME, not in CI.** The live
   LLM-vs-human extraction-agreement rate can only be measured over real
   assessments. This harness proves the collection machinery is arithmetically
   correct and the guardrails are sound; the `PublicationQueue` holds the first
   50 public results in `pending_review` regardless. The gate stays off until QA
   observes that runtime number.
2. **Two independent gates guard a public result.** The global
   `ASSESSMENT_ENGINE_ENABLED` flag (CTO-owned, currently off) gates whether the
   assessment path is served at all; the `PublicationQueue` auto-publish flip is
   a separate, per-deployment latch. Both must be satisfied before any
   machine-scored result reaches the public. Flipping the global gate does **not**
   bypass the spot-check hold.
3. **Consistent with the P3 finding (carried forward):** the auto-publish latch
   is incremental on the running count+rate and never un-latches, so QA must
   sequence the first-50 spot-checks representatively. This is correct behavior;
   op note only, no code change.

## Verdict

**PASS.** The deterministic guardrails are sound: accepted signals are auditable
to verbatim transcript evidence, malformed/injected LLM output never reaches the
scorer, the D5 auto-publish math is correct and gated, and the D4 consent
invariant holds. Recommend the CTO flip `ASSESSMENT_ENGINE_ENABLED` and close
epic GIV-583.

Reproduce: `node scripts/validate-ae-p4.mjs`
